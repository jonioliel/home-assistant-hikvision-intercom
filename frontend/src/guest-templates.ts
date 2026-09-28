import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass, Station, UserTimingDraft } from "./types";
import "./user-timing";

export interface GuestTemplateValues {
  label: string;
  access_category: "visitor" | "contractor";
  responsible_person: string;
  access_purpose: string;
  duration_minutes: number;
  doors: Record<string, number[]>;
  weekly_timing: UserTimingDraft | null;
}
export interface GuestTemplate extends GuestTemplateValues {
  id: string;
  updated_at: string;
  updated_by: string;
}
interface TemplateLibrary {
  revision: number;
  items: GuestTemplate[];
}

export function visitTimingSummary(value: UserTimingDraft | null | undefined, language: string) {
  if (!value) return translate(language, "guest_template_no_weekly");
  return `${value.days.map((day) => translate(language, "day_" + day)).join(", ")} · ${value.periods.map((period) => period.start + "–" + period.end).join(", ")} · ${value.timezone}`;
}

export class GuestTemplatesPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    canManage: { attribute: false },
    picker: { type: Boolean },
    timezone: {},
    library: { state: true },
    draft: { state: true },
    selected: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    pendingDelete: { state: true },
    uncertain: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        min-height: 0;
        background: transparent;
        overflow: visible;
      }
      .heading,
      .actions,
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .heading {
        justify-content: space-between;
      }
      .templates {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr));
        gap: 12px;
      }
      article,
      .editor,
      .picker {
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        background: var(--surface, var(--card-background-color, white));
        padding: 14px;
      }
      .editor {
        margin-block: 14px;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr));
        gap: 12px;
      }
      label {
        display: grid;
        gap: 6px;
      }
      input,
      select {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
      }
      input[type="checkbox"] {
        width: 19px;
        height: 19px;
        margin: 0;
      }
      .check {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .doors {
        display: grid;
        gap: 10px;
        margin-block: 12px;
      }
      .door {
        padding: 10px;
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 8px;
      }
      .door .row {
        margin-block-start: 8px;
      }
      .picker select {
        flex: 1 1 200px;
      }
      .picker button {
        flex: 0 0 auto;
      }
      .sub,
      .error,
      p {
        overflow-wrap: anywhere;
      }
      .danger {
        color: var(--error-color, #c83f48);
      }
      .actions {
        justify-content: end;
        margin-block-start: 14px;
      }
      fieldset {
        min-width: 0;
      }
      @media (max-width: 540px) {
        .picker .row {
          align-items: stretch;
        }
        .picker button {
          width: 100%;
        }
      }
    `,
  ];
  hass?: Hass;
  stations: Station[] = [];
  canManage = false;
  picker = false;
  timezone = "UTC";
  private library?: TemplateLibrary;
  private draft?: GuestTemplateValues;
  private editing = "";
  private selected = "";
  private busy = false;
  private error = "";
  private notice = "";
  private pendingDelete = "";
  private uncertain = false;
  private epoch = 0;
  private actor?: string;
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changes: PropertyValues) {
    if (
      this.hass &&
      (this.actor !== this.hass.user?.id || this.connection !== this.hass.connection)
    ) {
      this.epoch++;
      this.requests.cancel();
      this.actor = this.hass.user?.id;
      this.connection = this.hass.connection;
      this.library = this.draft = undefined;
      this.selected = this.pendingDelete = this.error = this.notice = "";
      this.busy = this.uncertain = false;
      void this.load();
    }
    if (changes.has("canManage") && !this.canManage && this.draft) {
      this.epoch++;
      this.requests.cancel();
      this.draft = undefined;
      this.pendingDelete = "";
      this.busy = false;
      void this.load();
    }
  }
  disconnectedCallback() {
    this.epoch++;
    this.requests.cancel();
    super.disconnectedCallback();
  }
  private async load() {
    if (this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      const library = await this.requests.run<TemplateLibrary>(
        { type: "hikvision_intercom/guest_templates/get" },
        10000,
      );
      if (epoch !== this.epoch || !this.isConnected) return;
      this.library = library;
      this.uncertain = false;
      this.error = "";
      this.draft = undefined;
      this.pendingDelete = "";
      if (!library.items.some((item) => item.id === this.selected)) this.selected = "";
    } catch (error) {
      if (epoch === this.epoch) this.error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private edit(item?: GuestTemplate) {
    if (!this.canManage || this.busy || this.uncertain) return;
    this.editing = item?.id ?? "";
    this.draft = item
      ? structuredClone({
          label: item.label,
          access_category: item.access_category,
          responsible_person: item.responsible_person,
          access_purpose: item.access_purpose,
          duration_minutes: item.duration_minutes,
          doors: item.doors,
          weekly_timing: item.weekly_timing,
        })
      : {
          label: "",
          access_category: "visitor",
          responsible_person: "",
          access_purpose: "",
          duration_minutes: 60,
          doors: {},
          weekly_timing: null,
        };
    this.pendingDelete = this.error = this.notice = "";
  }
  private patch<K extends keyof GuestTemplateValues>(key: K, value: GuestTemplateValues[K]) {
    if (this.draft && !this.busy) this.draft = { ...this.draft, [key]: value };
  }
  private toggleDoor(station: Station, physical: number, enabled: boolean) {
    if (!this.draft) return;
    const doors = structuredClone(this.draft.doors),
      locks = doors[station.id] ?? [];
    doors[station.id] = enabled
      ? [...new Set([...locks, physical])].sort()
      : locks.filter((lock) => lock !== physical);
    if (!doors[station.id].length) delete doors[station.id];
    this.patch("doors", doors);
  }
  private missing(item: GuestTemplateValues) {
    return Object.entries(item.doors).some(
      ([id, locks]) =>
        !this.stations.some(
          (station) =>
            station.id === id &&
            station.lock_enabled &&
            locks.every((lock) =>
              station.integrated_locks.some((configured) => configured.physical_index === lock),
            ),
        ),
    );
  }
  private async mutate(action: "upsert" | "delete", templateId: string) {
    if (!this.canManage || this.busy || this.uncertain || !this.library) return;
    if (action === "upsert" && (!this.draft || this.missing(this.draft))) {
      this.error = this.t("guest_template_stale");
      return;
    }
    const epoch = this.epoch;
    this.busy = true;
    this.error = this.notice = "";
    try {
      const library = await this.requests.run<TemplateLibrary>({
        type: "hikvision_intercom/guest_templates/" + action,
        api_contract: 1,
        revision: this.library.revision,
        template_id: templateId,
        ...(action === "upsert" ? { values: structuredClone(this.draft) } : {}),
      });
      if (epoch !== this.epoch || !this.isConnected || !this.canManage) return;
      this.library = library;
      this.draft = undefined;
      this.pendingDelete = "";
      this.notice = this.t(action === "upsert" ? "guest_template_saved" : "guest_template_deleted");
    } catch (error) {
      if (epoch !== this.epoch) return;
      const code = (error as { code?: string }).code ?? "failed";
      this.uncertain = ["connection_lost", "revision_conflict"].includes(code);
      this.error = this.t(code === "connection_lost" ? "panel_operation_unconfirmed" : code);
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private editor() {
    const draft = this.draft;
    if (!draft) return nothing;
    return html`<section class="editor" aria-label=${this.t("guest_template_editor")}>
      <div class="fields">
        <label
          >${this.t("guest_template_name")}<input
            maxlength="80"
            .value=${draft.label}
            @input=${(e: Event) => this.patch("label", (e.target as HTMLInputElement).value)}
            ?disabled=${this.busy}
        /></label>
        <label
          >${this.t("access_category")}<select
            .value=${draft.access_category}
            @change=${(e: Event) => this.patch("access_category", (e.target as HTMLSelectElement).value as "visitor" | "contractor")}
            ?disabled=${this.busy}
          >
            <option value="visitor">${this.t("access_category_visitor")}</option>
            <option value="contractor">${this.t("access_category_contractor")}</option>
          </select></label
        >
        <label
          >${this.t("responsible_person")}<input
            maxlength="64"
            .value=${draft.responsible_person}
            @input=${(e: Event) => this.patch("responsible_person", (e.target as HTMLInputElement).value)}
            ?disabled=${this.busy}
        /></label>
        <label
          >${this.t("access_purpose")}<input
            maxlength="128"
            .value=${draft.access_purpose}
            @input=${(e: Event) => this.patch("access_purpose", (e.target as HTMLInputElement).value)}
            ?disabled=${this.busy}
        /></label>
        <label
          >${this.t("guest_template_duration")}<input
            type="number"
            min="15"
            max="43200"
            step="1"
            .value=${String(draft.duration_minutes)}
            @input=${(e: Event) => this.patch("duration_minutes", Number((e.target as HTMLInputElement).value))}
            ?disabled=${this.busy}
        /></label>
      </div>
      <fieldset ?disabled=${this.busy}>
        <legend>${this.t("guest_doors")}</legend>
        <div class="doors">
          ${this.stations
        .filter((station) => station.lock_enabled)
        .map(
          (station) =>
            html`<div class="door">
              <strong>${station.name}</strong>
              <div class="row">
                ${station.integrated_locks.map((lock) => html`<label class="check"><input type="checkbox" .checked=${draft.doors[station.id]?.includes(lock.physical_index) ?? false} @change=${(e: Event) => this.toggleDoor(station, lock.physical_index, (e.target as HTMLInputElement).checked)} />${lock.name || `${this.t("physical_lock")} ${lock.physical_index}`}</label>`)}
              </div>
            </div>`,
        )}
        </div>
        ${Object.keys(draft.doors)
          .filter(
            (id) => !this.stations.some((station) => station.id === id && station.lock_enabled),
          )
          .map(
            (id) =>
              html`<p class="error">
                ${this.t("guest_template_stale")}
                <button
                  type="button"
                  @click=${() => {
                    const doors = { ...draft.doors };
                    delete doors[id];
                    this.patch("doors", doors);
                  }}
                >
                  ${this.t("remove")}
                </button>
              </p>`,
          )}
      </fieldset>
      <fieldset ?disabled=${this.busy}>
        <legend>${this.t("guest_template_weekly")}</legend>
        <label class="check"
          ><input
            type="checkbox"
            .checked=${!!draft.weekly_timing}
            @change=${(e: Event) => this.patch("weekly_timing", (e.target as HTMLInputElement).checked ? { mode: "weekly", timezone: this.timezone, days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Sunday"], dates: [], periods: [{ start: "09:00", end: "17:00" }] } : null)}
          />${this.t("guest_template_weekly_enabled")}</label
        >
        ${draft.weekly_timing ? html`<hikvision-user-timing .value=${draft.weekly_timing} .language=${this.hass?.language ?? "en"} enforcement="ha" .canEnforce=${true} @timing-change=${(e: CustomEvent<UserTimingDraft>) => this.patch("weekly_timing", e.detail)}></hikvision-user-timing>` : nothing}
      </fieldset>
      <div class="actions">
        <button
          type="button"
          ?disabled=${this.busy}
          @click=${() => {
        this.draft = undefined;
      }}
        >
          ${this.t("cancel")}</button
        ><button
          type="button"
          class="primary"
          ?disabled=${this.busy || this.uncertain || !draft.label.trim() || !draft.responsible_person.trim() || !Object.keys(draft.doors).length || !Number.isInteger(draft.duration_minutes) || draft.duration_minutes < 15 || draft.duration_minutes > 43200 || this.missing(draft)}
          @click=${() => void this.mutate("upsert", this.editing)}
        >
          ${this.t("save")}
        </button>
      </div>
    </section>`;
  }
  render() {
    const item = this.library?.items.find((row) => row.id === this.selected);
    return html`<div dir=${this.hass?.language === "he" ? "rtl" : "ltr"}>
      ${
        this.picker
          ? html`<section class="picker">
              <label
                >${this.t("guest_template_pick")}
                <div class="row">
                  <select
                    .value=${this.selected}
                    ?disabled=${this.busy}
                    @change=${(e: Event) => {
                      this.selected = (e.target as HTMLSelectElement).value;
                    }}
                  >
                    <option value="">${this.t("guest_template_custom")}</option>
                    ${this.library?.items.map((row) => html`<option value=${row.id}>${row.label}</option>`)}</select
                  ><button
                    type="button"
                    ?disabled=${!item || this.busy || !this.canManage || !!(item && this.missing(item))}
                    @click=${() => {
                      if (item && this.canManage && !this.missing(item))
                        this.dispatchEvent(
                          new CustomEvent("guest-template-apply", {
                            detail: structuredClone(item),
                            bubbles: true,
                            composed: true,
                          }),
                        );
                    }}
                  >
                    ${this.t("guest_template_apply")}
                  </button>
                </div></label
              >${
                item
                  ? html`<p class="sub">
                        ${item.duration_minutes} ${this.t("guest_template_minutes")} ·
                        ${item.responsible_person}
                      </p>
                      <p class="sub">
                        ${visitTimingSummary(item.weekly_timing, this.hass?.language ?? "en")}
                      </p>
                      ${this.missing(item) ? html`<p class="error" role="alert">${this.t("guest_template_stale")}</p>` : nothing}`
                  : nothing
              }
            </section>`
          : html` <div class="heading">
                <h2>${this.t("guest_templates")}</h2>
                <div class="row">
                  <button type="button" ?disabled=${this.busy} @click=${() => void this.load()}>
                    ${this.t("refresh")}</button
                  >${this.canManage ? html`<button type="button" class="primary" ?disabled=${this.busy || this.uncertain} @click=${() => this.edit()}>${this.t("guest_template_add")}</button>` : nothing}
                </div>
              </div>
              <p class="sub">${this.t("tools_guest_templates")}</p>
              ${this.editor()}
              <div class="templates">
                ${this.library?.items.map(
        (row) =>
          html`<article>
            <h3>${row.label}</h3>
            <p>${this.t("access_category_" + row.access_category)} · ${row.responsible_person}</p>
            ${row.access_purpose ? html`<p class="sub">${row.access_purpose}</p>` : nothing}
            <p>${row.duration_minutes} ${this.t("guest_template_minutes")}</p>
            <p class="sub">
              ${Object.entries(row.doors)
                .map(
                  ([id, locks]) =>
                    `${this.stations.find((station) => station.id === id)?.name ?? this.t("temporary_unknown_station")} · ${locks.join(", ")}`,
                )
                .join("; ")}
            </p>
            <p class="sub">${visitTimingSummary(row.weekly_timing, this.hass?.language ?? "en")}</p>
            ${this.missing(row) ? html`<p class="error">${this.t("guest_template_stale")}</p>` : nothing}${
              this.canManage
                ? html`<div class="actions">
                      <button
                        type="button"
                        ?disabled=${this.busy || this.uncertain}
                        @click=${() => this.edit(row)}
                      >
                        ${this.t("edit")}</button
                      ><button
                        type="button"
                        class="danger"
                        ?disabled=${this.busy || this.uncertain}
                        @click=${() => {
                          this.pendingDelete = row.id;
                        }}
                      >
                        ${this.t("delete")}
                      </button>
                    </div>
                    ${
                      this.pendingDelete === row.id
                        ? html`<p>${this.t("guest_template_delete_confirm")}</p>
                            <div class="actions">
                              <button
                                type="button"
                                ?disabled=${this.busy}
                                @click=${() => {
                                  this.pendingDelete = "";
                                }}
                              >
                                ${this.t("cancel")}</button
                              ><button
                                type="button"
                                class="danger"
                                ?disabled=${this.busy || this.uncertain}
                                @click=${() => void this.mutate("delete", row.id)}
                              >
                                ${this.t("guest_template_confirm_delete")}
                              </button>
                            </div>`
                        : nothing
                    }`
                : nothing
            }
          </article>`,
      )}
              </div>
              ${this.library && !this.library.items.length ? html`<p class="sub">${this.t("no_records")}</p>` : nothing}`
      }
      ${this.busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.notice ? html`<p role="status">${this.notice}</p>` : nothing}${this.uncertain ? html`<button type="button" ?disabled=${this.busy} @click=${() => void this.load()}>${this.t("refresh")}</button>` : nothing}
    </div>`;
  }
}
customElements.define("wiskey-guest-templates", GuestTemplatesPanel);
