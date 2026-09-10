import "./schedule-operations";
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { ScopedRequests } from "./request";
import { styles } from "./styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
import { formatTime, UTC_ZONE } from "./time";
import type { Hass, Station } from "./types";

interface Source {
  id?: string;
  revision?: number;
  name: string;
  holidays: { name: string; start: string; end: string }[];
}
interface Proposal {
  id: string;
  revision: number;
  station_id: string;
  draft_id: string;
  draft_revision: number;
  name: string;
  token?: string;
  source_state: string;
  drifted_resources: string[];
  bindings: { template: number; weekly: number; holiday_group: number | null; holidays: number[] };
  report: {
    checked_at: string;
    can_apply: false;
    blockers: string[];
    resources: {
      kind: string;
      id: number;
      coverage: string;
      state: string;
      fields: string[];
      active: boolean | null;
      externally_referenced: boolean | null;
    }[];
  };
}

export class DeploymentPlans extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        height: auto;
        overflow: visible;
        display: block;
        margin-block: 20px;
      }
      section,
      details {
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        padding: 16px;
        margin-block: 12px;
        background: var(--surface);
        min-width: 0;
      }
      label {
        display: grid;
        gap: 6px;
        margin-block: 8px;
        min-width: 0;
      }
      input,
      select {
        width: 100%;
        box-sizing: border-box;
        min-width: 0;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-block: 12px;
      }
      .row {
        border-top: 1px solid var(--divider-color, #dce5e6);
        padding-block: 8px;
        overflow-wrap: anywhere;
      }
      p {
        line-height: 1.6;
        overflow-wrap: anywhere;
      }
      summary {
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      @container intercom-panel (max-width: 600px) {
        .fields {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    source: { attribute: false },
    _items: { state: true },
    _preview: { state: true },
    _busy: { state: true },
    _reading: { state: true },
    _error: { state: true },
    _notice: { state: true },
    _uncertain: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  source?: Source;
  private _items: Proposal[] = [];
  private _preview?: Proposal;
  private _busy = false;
  private _reading = false;
  private _uncertain = false;
  private _loaded = false;
  private _error = "";
  private _notice = "";
  private _station = "";
  private _template = "";
  private _weekly = "";
  private _group = "";
  private _holidays: string[] = [];
  private requests = new ScopedRequests(() => this.hass);
  private connection?: Hass["connection"];
  private actor?: string;
  private _epoch = 0;
  private _sequence = 0;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected willUpdate(changed: PropertyValues) {
    if (changed.has("source")) {
      this._preview = undefined;
      this._sequence++;
      this._holidays = [];
    }
  }
  connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    const connection = this.hass?.user?.is_admin ? this.hass.connection : undefined;
    const actor = this.hass?.user?.id;
    if (connection !== this.connection || actor !== this.actor) {
      this.clear();
      this.connection = connection;
      this.actor = actor;
    }
    if (!this.hass?.user?.is_admin) {
      if (changed.has("hass") || this._loaded) this.clear();
      return;
    }
    if (!this._loaded) {
      this._loaded = true;
      void this.load();
    } else if (changed.has("source") && !this._busy) void this.load();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clear();
  }
  private clear() {
    this._epoch++;
    this.requests.cancel();
    this._sequence++;
    this._items = [];
    this._preview = undefined;
    this._loaded = false;
    this._reading = false;
    this.busy(false);
    this._uncertain = false;
    this._error = "";
    this._notice = "";
  }
  private current(epoch: number) {
    return epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin;
  }
  private busy(value: boolean) {
    this._busy = value;
    this.dispatchEvent(
      new CustomEvent("plan-busy", { detail: value, bubbles: true, composed: true }),
    );
  }
  private api<T>(command: string, data: Record<string, unknown> = {}) {
    return this.requests.run<T>(
      { type: `hikvision_intercom/schedules/plan_${command}`, ...data },
      ["preview", "recheck"].includes(command) ? 120000 : 60000,
    );
  }
  private error(e: unknown) {
    return this.t((e as { code?: string })?.code ?? "failed");
  }
  private invalidate() {
    this._sequence++;
    this._preview = undefined;
    this._notice = "";
    this.requestUpdate();
  }
  private async load() {
    if (this._busy) return;
    const epoch = this._epoch;
    this.busy(true);
    this._error = "";
    try {
      const items = await this.api<Proposal[]>("list");
      if (this.current(epoch)) {
        this._items = items;
        this._uncertain = false;
        this.invalidate();
      }
    } catch (e) {
      if (this.current(epoch)) this._error = this.error(e);
    } finally {
      if (this.current(epoch)) this.busy(false);
    }
  }
  private parseId(value: string) {
    if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65535)
      throw { code: "schedule_binding_invalid" };
    return Number(value);
  }
  private async prepare(event: SubmitEvent) {
    event.preventDefault();
    if (this._reading || this._busy || this._uncertain || !this.source?.id || !this._station)
      return;
    this.invalidate();
    const epoch = this._epoch,
      sequence = this._sequence,
      source = this.source;
    this._reading = true;
    this._error = "";
    try {
      const bindings = {
        template: this.parseId(this._template),
        weekly: this.parseId(this._weekly),
        holiday_group: source.holidays.length ? this.parseId(this._group) : null,
        holidays: source.holidays.map((_, i) => this.parseId(this._holidays[i] ?? "")),
      };
      const result = await this.api<Proposal>("preview", {
        station_id: this._station,
        schedule_id: source.id,
        revision: source.revision,
        bindings,
      });
      if (this.current(epoch) && sequence === this._sequence) this._preview = result;
    } catch (e) {
      if (this.current(epoch) && sequence === this._sequence) this._error = this.error(e);
    } finally {
      if (this.current(epoch)) this._reading = false;
    }
  }
  private async action(command: "save" | "recheck" | "delete", item: Proposal) {
    if (this._busy || this._reading || this._uncertain) return;
    if (command === "delete" && !window.confirm(this.t("plan_delete_confirm"))) return;
    const epoch = this._epoch;
    if (command === "recheck") this._reading = true;
    else this.busy(true);
    this._error = "";
    if (command === "save") this._preview = undefined;
    try {
      const result = await this.api<Proposal>(
        command,
        command === "save" ? { token: item.token } : { plan_id: item.id, revision: item.revision },
      );
      if (this.current(epoch)) {
        this._items = this._items.filter((p) => p.id !== item.id);
        if (command !== "delete") this._items = [...this._items, result];
        this._notice = this.t(
          command === "delete"
            ? "plan_deleted"
            : command === "save"
              ? "plan_saved"
              : "plan_rechecked",
        );
      }
    } catch (e) {
      if (this.current(epoch)) {
        const code = (e as { code?: string })?.code;
        const known = [
          "revision_conflict",
          "schedule_plan_not_found",
          "schedule_not_found",
          "schedule_plan_expired",
          "schedule_plan_device_changed",
          "schedule_plan_resource_reserved",
          "schedule_plan_limit",
          "schedule_plan_storage_unavailable",
          "station_offline",
          "station_unloaded",
          "connection_failed",
          "schedule_read_busy",
          "storage_write_failed",
          "storage_stopping",
          "schedule_binding_out_of_range",
          "schedule_compilation_unknown",
          "schedule_compilation_limit",
          "invalid_storage",
          "rate_limited",
          "unauthorized",
        ];
        this._uncertain = !code || !known.includes(code);
        this._error = this._uncertain ? this.t("plan_unknown") : this.error(e);
      }
    } finally {
      if (this.current(epoch)) {
        this._reading = false;
        this.busy(false);
      }
    }
  }
  private async exportPlan(item: Proposal) {
    if (this._busy || this._uncertain) return;
    const epoch = this._epoch;
    this.busy(true);
    try {
      const result = await this.api("export", { plan_id: item.id, revision: item.revision });
      if (this.current(epoch))
        downloadText(
          JSON.stringify(result, null, 2),
          "hikvision-deployment-proposal.json",
          "application/json",
        );
    } catch (e) {
      if (this.current(epoch)) this._error = this.error(e);
    } finally {
      if (this.current(epoch)) this.busy(false);
    }
  }
  private report(item: Proposal) {
    const station = this.stations.find((s) => s.id === item.station_id);
    return html`<p>
        ${station?.name ?? this.t("plan_station_missing")} ·
        <bdi
          >${formatTime(item.report.checked_at, this.hass?.language, station?.clock?.zone ?? UTC_ZONE)}</bdi
        >
      </p>
      <p>
        ${this.t("plan_source_" + item.source_state)} · ${this.t("plan_source_revision")}:
        ${item.draft_revision}
      </p>
      ${item.drifted_resources.length ? html`<p class="danger">${this.t("plan_drift")}: <bdi>${item.drifted_resources.join(", ")}</bdi></p>` : nothing}
      ${item.report.resources.map(
        (row) =>
          html`<div class="row">
            <strong>${this.t("schedule_kind_" + row.kind)} <bdi>#${row.id}</bdi></strong> ·
            ${this.t("plan_state_" + row.state)}
            <p>
              ${this.t("schedule_inventory_" + row.coverage)} · ${this.t("plan_external")}:
              ${row.externally_referenced === null ? "—" : this.t(row.externally_referenced ? "plan_yes" : "plan_no")}
            </p>
            ${row.fields.length ? html`<p>${this.t("plan_changed_fields")}: ${row.fields.map((field) => this.t("plan_field_" + field)).join(", ")}</p>` : nothing}
          </div>`,
      )}
      <p class="notice">${this.t("plan_not_applied")}</p>
      <ul>
        ${item.report.blockers.map((blocker) => html`<li>${this.t(blocker)}</li>`)}
      </ul>`;
  }
  private renderPlans() {
    if (!this.hass?.user?.is_admin) return nothing;
    const source = this.source;
    return html`<section aria-label=${this.t("plan_title")}>
      <h3>${this.t("plan_title")}</h3>
      <p>${this.t("plan_intro")}</p>
      ${this._error ? html`<p role="alert" class="notice error">${this._error}</p>` : nothing}
      ${this._notice ? html`<p role="status" class="notice">${this._notice}</p>` : nothing}
      <button ?disabled=${this._busy} @click=${() => this.load()}>${this.t("plan_reload")}</button>
      ${
        source?.id
          ? html`<form @submit=${(e: SubmitEvent) => this.prepare(e)}>
              <fieldset ?disabled=${this._busy || this._uncertain}>
                <legend>${source.name}</legend>
                <label
                  >${this.t("plan_station")}<select
                    required
                    aria-label=${this.t("plan_station")}
                    .value=${this._station}
                    @change=${(e: Event) => {
                      this._station = (e.target as HTMLSelectElement).value;
                      this.invalidate();
                    }}
                  >
                    <option value="">${this.t("select_station")}</option>
                    ${this.stations.filter((s) => s.lock_enabled).map((s) => html`<option value=${s.id} ?disabled=${!s.online}>${s.name}</option>`)}
                  </select></label
                >
                <p>${this.t("plan_binding_hint")}</p>
                <div class="fields">
                  <label
                    >${this.t("plan_template_id")}<input
                      required
                      type="number"
                      min="1"
                      max="65535"
                      step="1"
                      .value=${this._template}
                      @input=${(e: Event) => {
                        this._template = (e.target as HTMLInputElement).value;
                        this.invalidate();
                      }}
                  /></label>
                  <label
                    >${this.t("plan_weekly_id")}<input
                      required
                      type="number"
                      min="1"
                      max="65535"
                      step="1"
                      .value=${this._weekly}
                      @input=${(e: Event) => {
                        this._weekly = (e.target as HTMLInputElement).value;
                        this.invalidate();
                      }}
                  /></label>
                  ${
                    source.holidays.length
                      ? html`<label
                          >${this.t("plan_group_id")}<input
                            required
                            type="number"
                            min="1"
                            max="65535"
                            step="1"
                            .value=${this._group}
                            @input=${(e: Event) => {
                              this._group = (e.target as HTMLInputElement).value;
                              this.invalidate();
                            }}
                        /></label>`
                      : nothing
                  }
                  ${source.holidays.map(
                    (holiday, index) =>
                      html`<label
                        >${this.t("plan_holiday_id")} ${index + 1} — ${holiday.name}
                        (${holiday.start})<input
                          required
                          type="number"
                          min="1"
                          max="65535"
                          step="1"
                          .value=${this._holidays[index] ?? ""}
                          @input=${(e: Event) => {
                            this._holidays[index] = (e.target as HTMLInputElement).value;
                            this.invalidate();
                          }}
                      /></label>`,
                  )}
                </div>
                <button type="submit" ?disabled=${this._reading}>
                  ${this.t(this._reading ? "loading" : "plan_prepare")}
                </button>
              </fieldset>
            </form>`
          : html`<p>${this.t("plan_save_source")}</p>`
      }
      ${
        this._preview
          ? html`<section aria-label=${this.t("plan_review")}>
              <h4>${this.t("plan_review")}</h4>
              ${this.report(this._preview)}<button
                ?disabled=${this._busy || this._reading || this._uncertain}
                @click=${() => this.action("save", this._preview!)}
              >
                ${this.t("plan_save")}
              </button>
            </section>`
          : nothing
      }
      <h4>${this.t("plan_saved_list")}</h4>
      ${!this._items.length ? html`<p>${this.t("plan_empty")}</p>` : nothing}
      ${this._items.map(
        (item) =>
          html`<details>
            <summary>
              ${item.name} ·
              ${this.stations.find((s) => s.id === item.station_id)?.name ?? this.t("plan_station_missing")}
            </summary>
            ${this.report(item)}
            <div class="toolbar">
              <button
                ?disabled=${this._busy || this._reading || this._uncertain || !this.stations.some((s) => s.id === item.station_id && s.online && s.lock_enabled)}
                @click=${() => this.action("recheck", item)}
              >
                ${this.t("plan_recheck")}</button
              ><button
                ?disabled=${this._busy || this._uncertain}
                @click=${() => this.exportPlan(item)}
              >
                ${this.t("plan_export")}</button
              ><button
                ?disabled=${this._busy || this._reading || this._uncertain}
                @click=${() => this.action("delete", item)}
              >
                ${this.t("plan_delete_local")}
              </button>
            </div>
          </details>`,
      )}
    </section>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`
      ${this.renderPlans()}
      <hikvision-schedule-operations
        .hass=${this.hass}
        .stations=${this.stations}
        .plans=${this._items}
      ></hikvision-schedule-operations>
    `;
  }
}
customElements.define("hikvision-deployment-plans", DeploymentPlans);
