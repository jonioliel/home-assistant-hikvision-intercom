import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
import type { Hass, Station } from "./types";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
interface Period {
  start: string;
  end: string;
}
interface Holiday {
  name: string;
  start: string;
  end: string;
  periods: Period[];
}
interface Schedule {
  id?: string;
  revision?: number;
  name: string;
  weekly: Record<string, Period[]>;
  holidays: Holiday[];
  updated_at?: string;
}
interface Preview {
  within_window: boolean;
  source: string;
  holiday: string | null;
  periods: Period[];
  date: string;
  time: string;
}
interface Readiness {
  checked_at: string;
  can_apply: false;
  checks: {
    kind: string;
    advertised: boolean | null;
    capabilities: { ids: number[]; max_periods?: number; precision?: string } | null;
    sample_id: number | null;
    read_state: string;
    error: string | null;
  }[];
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class IntercomSchedules extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        height: auto;
        overflow: visible;
      }
      .layout {
        display: grid;
        grid-template-columns: 230px minmax(0, 1fr);
        gap: 20px;
        align-items: start;
      }
      .library,
      .editor,
      .check {
        background: var(--surface);
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 14px;
        padding: 16px;
        min-width: 0;
      }
      .library button {
        display: block;
        width: 100%;
        margin-block: 8px;
        text-align: start;
        overflow-wrap: anywhere;
      }
      .toolbar,
      .period {
        display: flex;
        gap: 8px;
        align-items: end;
        flex-wrap: wrap;
        margin-block: 8px;
      }
      fieldset {
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 10px;
        margin: 12px 0;
        min-width: 0;
        padding: 12px;
      }
      .period label {
        width: 110px;
      }
      label {
        display: grid;
        gap: 6px;
        margin-block: 8px;
        min-width: 0;
      }
      input,
      select {
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      h3 {
        margin: 4px 0 12px;
      }
      .check {
        margin-block: 16px;
      }
      .check-row {
        border-top: 1px solid var(--divider-color, #dce5e6);
        padding-block: 10px;
        overflow-wrap: anywhere;
      }
      .hint {
        line-height: 1.6;
        overflow-wrap: anywhere;
      }
      @media (max-width: 700px) {
        .layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .period label {
          width: 100px;
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    _items: { state: true },
    _draft: { state: true },
    _busy: { state: true },
    _reading: { state: true },
    _error: { state: true },
    _notice: { state: true },
    _preview: { state: true },
    _readiness: { state: true },
    _uncertain: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  private _items: Schedule[] = [];
  private _draft?: Schedule;
  private _busy = false;
  private _reading = false;
  private _uncertain = false;
  private _error = "";
  private _notice = "";
  private _dirty = false;
  private _preview?: Preview;
  private _readiness?: Readiness;
  private _station = "";
  private _checkStation = "";
  private _date = today();
  private _time = "12:00";
  private _epoch = 0;
  private _loaded = false;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (changed.has("hass") && !this.hass?.user?.is_admin) this.clear();
    else if (!this._loaded && this.hass?.user?.is_admin) {
      this._loaded = true;
      void this.load();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clear();
  }
  private clear() {
    this._epoch++;
    this._items = [];
    this._draft = undefined;
    this._readiness = undefined;
    this._preview = undefined;
    this._loaded = false;
    this._busy = false;
    this._reading = false;
    this._dirty = false;
    this._uncertain = false;
    this._error = "";
    this._notice = "";
  }
  private current(epoch: number) {
    return epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin;
  }
  private api<T>(command: string, data: Record<string, unknown> = {}) {
    return this.hass!.callWS<T>({ type: `hikvision_intercom/schedules/${command}`, ...data });
  }
  canLeave() {
    return !this._busy && this.discard();
  }
  private discard() {
    return !this._dirty || window.confirm(this.t("schedule_discard"));
  }
  private async load() {
    if (this._busy || !this.discard()) return;
    const epoch = this._epoch;
    this._busy = true;
    this._error = "";
    try {
      const items = await this.api<Schedule[]>("list");
      if (this.current(epoch)) {
        this._items = items;
        this._draft = undefined;
        this._dirty = false;
        this._uncertain = false;
        this._preview = undefined;
      }
    } catch (e) {
      if (this.current(epoch)) this._error = this.t((e as { code?: string }).code ?? "failed");
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private edit(item?: Schedule) {
    if (this._busy || this._uncertain || !this.discard()) return;
    this._draft = item
      ? structuredClone(item)
      : { name: "", weekly: Object.fromEntries(days.map((day) => [day, []])), holidays: [] };
    this._dirty = false;
    this._preview = undefined;
    this._error = "";
    this._notice = "";
  }
  private change(action: () => void) {
    action();
    this._dirty = true;
    this._preview = undefined;
    this._notice = "";
    this.requestUpdate();
  }
  private data() {
    const d = this._draft!;
    return structuredClone({ name: d.name, weekly: d.weekly, holidays: d.holidays });
  }
  private async save(event: SubmitEvent) {
    event.preventDefault();
    if (this._busy || this._uncertain || !this._draft) return;
    const d = this._draft,
      epoch = this._epoch;
    this._busy = true;
    this._error = "";
    try {
      const item = await this.api<Schedule>(d.id ? "update" : "create", {
        data: this.data(),
        ...(d.id ? { schedule_id: d.id, revision: d.revision } : {}),
      });
      if (this.current(epoch)) {
        this._items = [...this._items.filter((s) => s.id !== item.id), item];
        this._draft = structuredClone(item);
        this._dirty = false;
        this._notice = this.t("schedule_saved");
      }
    } catch (e) {
      if (this.current(epoch)) this.mutationError(e);
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private mutationError(e: unknown) {
    const code = (e as { code?: string })?.code;
    this._error = this.t(code ?? "schedule_save_unknown");
    // Lost acknowledgement or generic server failure may follow a durable commit.
    if (!code || ["action_failed", "unknown_error", "timeout"].includes(code)) {
      this._uncertain = true;
      this._error = this.t("schedule_save_unknown");
    }
  }
  private async deleteDraft() {
    if (
      this._busy ||
      this._uncertain ||
      !this._draft?.id ||
      !window.confirm(this.t("schedule_delete_confirm"))
    )
      return;
    const epoch = this._epoch,
      d = this._draft;
    this._busy = true;
    this._error = "";
    try {
      await this.api("delete", { schedule_id: d.id, revision: d.revision });
      if (this.current(epoch)) {
        this._items = this._items.filter((s) => s.id !== d.id);
        this._draft = undefined;
        this._dirty = false;
        this._preview = undefined;
        this._notice = this.t("schedule_deleted");
      }
    } catch (e) {
      if (this.current(epoch)) this.mutationError(e);
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private async preview() {
    if (this._busy || !this._draft) return;
    const epoch = this._epoch;
    this._busy = true;
    this._error = "";
    this._preview = undefined;
    try {
      const result = await this.api<Preview>("preview", {
        data: this.data(),
        date: this._date,
        time: this._time,
      });
      if (this.current(epoch)) this._preview = result;
    } catch (e) {
      if (this.current(epoch)) this._error = this.t((e as { code?: string }).code ?? "failed");
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private async readiness() {
    if (this._reading || !this._station) return;
    const epoch = this._epoch,
      station = this._station;
    this._reading = true;
    this._error = "";
    this._readiness = undefined;
    try {
      const report = await this.api<Readiness>("readiness", { station_id: station });
      if (this.current(epoch)) {
        this._checkStation = station;
        this._readiness = report;
      }
    } catch (e) {
      if (this.current(epoch)) this._error = this.t((e as { code?: string }).code ?? "failed");
    } finally {
      if (this.current(epoch)) this._reading = false;
    }
  }
  private periodRows(items: Period[]) {
    return html`${items.map(
        (p, index) =>
          html`<div class="period">
            <label
              >${this.t("schedule_start")}<input
                aria-label=${this.t("schedule_start")}
                dir="ltr"
                placeholder="09:00"
                required
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                .value=${p.start}
                @input=${(e: Event) => this.change(() => (p.start = (e.target as HTMLInputElement).value))}
            /></label>
            <label
              >${this.t("schedule_end")}<input
                aria-label=${this.t("schedule_end")}
                dir="ltr"
                placeholder="17:00"
                required
                pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)"
                .value=${p.end}
                @input=${(e: Event) => this.change(() => (p.end = (e.target as HTMLInputElement).value))}
            /></label>
            <button type="button" @click=${() => this.change(() => items.splice(index, 1))}>
              ${this.t("remove")}
            </button>
          </div>`,
      )}${!items.length ? html`<p class="sub">${this.t("schedule_closed_day")}</p>` : nothing}
      <button
        type="button"
        ?disabled=${items.length >= 8}
        @click=${() => this.change(() => items.push({ start: "09:00", end: "17:00" }))}
      >
        ${this.t("schedule_add_period")}
      </button>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const d = this._draft;
    return html`<h2>${this.t("schedules")}</h2>
      <p class="hint">${this.t("schedule_intro")}</p>
      ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
      ${this._notice ? html`<p class="notice" role="status">${this._notice}</p>` : nothing}
      <div class="layout">
        <aside class="library">
          <h3>${this.t("schedule_library")}</h3>
          <button ?disabled=${this._busy} @click=${() => this.load()}>
            ${this.t("schedule_reload")}
          </button>
          <button
            class="primary"
            ?disabled=${this._busy || this._uncertain}
            @click=${() => this.edit()}
          >
            ${this.t("schedule_new")}
          </button>
          ${this._items.map((item) => html`<button ?disabled=${this._busy || this._uncertain} aria-current=${d?.id === item.id ? "true" : nothing} @click=${() => this.edit(item)}>${item.name}</button>`)}
          ${!this._items.length ? html`<p>${this.t("schedule_empty")}</p>` : nothing}
        </aside>
        <section class="editor">
          ${
            d
              ? html`<form @submit=${(e: SubmitEvent) => this.save(e)}>
                    <fieldset ?disabled=${this._busy || this._uncertain}>
                      <legend>${this.t("schedule_draft")}</legend>
                      <label
                        >${this.t("schedule_name")}<input
                          required
                          maxlength="32"
                          .value=${d.name}
                          @input=${(e: Event) => this.change(() => (d.name = (e.target as HTMLInputElement).value))}
                      /></label>
                      <p class="hint">${this.t("schedule_time_hint")}</p>
                      <h3>${this.t("schedule_week")}</h3>
                      ${days.map(
                        (day) =>
                          html`<fieldset aria-label=${this.t("day_" + day)}>
                            <legend>${this.t("day_" + day)}</legend>
                            ${this.periodRows(d.weekly[day])}
                          </fieldset>`,
                      )}
                      <h3>${this.t("schedule_holidays")}</h3>
                      <p class="hint">${this.t("schedule_holiday_hint")}</p>
                      ${d.holidays.map(
                        (h, index) =>
                          html`<fieldset class="holiday">
                            <legend>${this.t("schedule_holiday")} ${index + 1}</legend>
                            <label
                              >${this.t("schedule_holiday_name")}<input
                                required
                                maxlength="32"
                                .value=${h.name}
                                @input=${(e: Event) => this.change(() => (h.name = (e.target as HTMLInputElement).value))}
                            /></label>
                            <label
                              >${this.t("schedule_first_date")}<input
                                type="date"
                                min="2000-01-01"
                                max="2037-12-31"
                                required
                                .value=${h.start}
                                @input=${(e: Event) => this.change(() => (h.start = (e.target as HTMLInputElement).value))}
                            /></label>
                            <label
                              >${this.t("schedule_last_date")}<input
                                type="date"
                                min="2000-01-01"
                                max="2037-12-31"
                                required
                                .value=${h.end}
                                @input=${(e: Event) => this.change(() => (h.end = (e.target as HTMLInputElement).value))}
                            /></label>
                            ${this.periodRows(h.periods)}<button
                              type="button"
                              @click=${() => this.change(() => d.holidays.splice(index, 1))}
                            >
                              ${this.t("schedule_remove_holiday")}
                            </button>
                          </fieldset>`,
                      )}
                      <button
                        type="button"
                        ?disabled=${d.holidays.length >= 64}
                        @click=${() => this.change(() => d.holidays.push({ name: "", start: today(), end: today(), periods: [] }))}
                      >
                        ${this.t("schedule_add_holiday")}
                      </button>
                      <div class="toolbar">
                        <button class="primary" type="submit">${this.t("schedule_save")}</button>
                        ${d.id ? html`<button type="button" @click=${() => this.deleteDraft()}>${this.t("schedule_delete")}</button>` : nothing}
                      </div>
                    </fieldset>
                  </form>
                  <section aria-label=${this.t("schedule_preview")}>
                    <h3>${this.t("schedule_preview")}</h3>
                    <p class="hint">${this.t("schedule_preview_hint")}</p>
                    <div class="toolbar">
                      <label
                        >${this.t("schedule_date")}<input
                          type="date"
                          .value=${this._date}
                          ?disabled=${this._busy}
                          @input=${(e: Event) => {
                            this._date = (e.target as HTMLInputElement).value;
                            this._preview = undefined;
                          }}
                      /></label>
                      <label
                        >${this.t("schedule_time")}<input
                          type="time"
                          .value=${this._time}
                          ?disabled=${this._busy}
                          @input=${(e: Event) => {
                            this._time = (e.target as HTMLInputElement).value;
                            this._preview = undefined;
                          }}
                      /></label>
                      <button ?disabled=${this._busy} @click=${() => this.preview()}>
                        ${this.t("schedule_evaluate")}
                      </button>
                    </div>
                    ${
                      this._preview
                        ? html`<div class="notice" role="status">
                            <div>
                              <strong
                                >${this.t(this._preview.within_window ? "schedule_inside" : "schedule_outside")}</strong
                              >
                              <p>
                                ${this.t("schedule_source_" + this._preview.source)}
                                ${this._preview.holiday ?? ""}
                              </p>
                              <bdi
                                >${this._preview.periods.map((p) => `${p.start}–${p.end}`).join(", ") || this.t("schedule_closed_day")}</bdi
                              >
                            </div>
                          </div>`
                        : nothing
                    }
                  </section>`
              : html`<p>${this.t("schedule_select")}</p>`
          }
        </section>
      </div>
      <section class="check">
        <h3>${this.t("schedule_readiness")}</h3>
        <p class="hint">${this.t("schedule_readiness_hint")}</p>
        <div class="toolbar">
          <label
            >${this.t("station")}<select
              aria-label=${this.t("station")}
              .value=${this._station}
              ?disabled=${this._reading}
              @change=${(e: Event) => {
                this._station = (e.target as HTMLSelectElement).value;
                this._readiness = undefined;
                this.requestUpdate();
              }}
            >
              <option value="">${this.t("select_station")}</option>
              ${this.stations.filter((s) => s.lock_enabled).map((s) => html`<option value=${s.id} ?disabled=${!s.online}>${s.name}</option>`)}
            </select></label
          >
          <button
            ?disabled=${this._reading || !this.stations.some((s) => s.id === this._station && s.online && s.lock_enabled)}
            @click=${() => this.readiness()}
          >
            ${this.t(this._reading ? "loading" : "schedule_check")}
          </button>
        </div>
        ${
          this._readiness
            ? html`<p>
                  <strong>${this.stations.find((s) => s.id === this._checkStation)?.name}</strong> ·
                  <bdi
                    >${new Date(this._readiness.checked_at).toLocaleString(this.hass.language)}</bdi
                  >
                </p>
                ${this._readiness.checks.map(
                  (c) =>
                    html`<div class="check-row">
                      <strong>${this.t("schedule_kind_" + c.kind)}</strong> ·
                      ${this.t("schedule_read_" + c.read_state)}
                      ${c.capabilities ? html`<p>${this.t("schedule_ids")}: <bdi>${c.capabilities.ids.join("–")}</bdi> · ${this.t("schedule_sample")}: ${c.sample_id}</p>` : nothing}
                      ${c.error ? html`<p>${this.t(c.error)}</p>` : nothing}
                    </div>`,
                )}
                <button
                  @click=${() => downloadText(JSON.stringify(this._readiness, null, 2), "hikvision-schedule-readiness.json", "application/json")}
                >
                  ${this.t("schedule_export_check")}
                </button>`
            : nothing
        }
        <p class="hint">${this.t("schedule_apply_blocked")}</p>
      </section>`;
  }
}
customElements.define("hikvision-intercom-schedules", IntercomSchedules);
