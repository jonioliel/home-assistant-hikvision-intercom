import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
import { formatTime, localInput, fromLocalInput, UTC_ZONE, type DisplayZone } from "./time";
import type { Hass, Station } from "./types";
interface Trace {
  capture: { capture_id: string; state: string; records: unknown[]; dropped: number } | null;
  remaining_seconds: number;
}
interface Inspection {
  complete: boolean;
  filter_honored: boolean | null;
  records: number;
  error?: string;
  start: string;
  end: string;
}
export class IntercomEventTools extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      label {
        display: block;
        min-width: 0;
      }
      input {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      p {
        overflow-wrap: anywhere;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    station: { attribute: false },
    _trace: { state: true },
    _history: { state: true },
    _start: { state: true },
    _end: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };
  hass?: Hass;
  station?: Station;
  private _trace?: Trace;
  private _history?: Inspection;
  private _busy = false;
  private _error = "";
  private epoch = 0;
  private stationId = "";
  private _start = "";
  private _end = "";
  private zone: DisplayZone = UTC_ZONE;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (
      (changed.has("hass") && !this.hass?.user?.is_admin) ||
      (this.station?.id ?? "") !== this.stationId
    ) {
      this.epoch++;
      this._trace = undefined;
      this._history = undefined;
      this._error = "";
      this._busy = false;
      this.stationId = this.station?.id ?? "";
      this.zone = this.station?.clock?.zone ?? UTC_ZONE;
      this._start = localInput(new Date(Date.now() - 7200000).toISOString(), this.zone);
      this._end = localInput(new Date().toISOString(), this.zone);
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.epoch++;
  }
  private async request(action: string, data: Record<string, unknown> = {}) {
    if (this._busy || !this.station || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch,
      station = this.station.id;
    this._busy = true;
    this._error = "";
    try {
      const result = await this.hass.callWS<Trace | Inspection>({
        type: "hikvision_intercom/events/" + action,
        station_id: station,
        ...data,
      });
      if (
        epoch !== this.epoch ||
        !this.isConnected ||
        !this.hass.user?.is_admin ||
        this.station?.id !== station
      )
        return;
      if (action === "history_inspect") this._history = result as Inspection;
      else this._trace = result as Trace;
    } catch {
      if (epoch === this.epoch) this._error = this.t("event_tools_failed");
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private history(event: SubmitEvent) {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    try {
      const start = fromLocalInput(String(form.get("start")), this.zone),
        end = fromLocalInput(String(form.get("end")), this.zone);
      if (
        !start ||
        !end ||
        Date.parse(end) <= Date.parse(start) ||
        Date.parse(end) - Date.parse(start) > 86400000
      )
        throw Error();
      void this.request("history_inspect", { start, end });
    } catch {
      this._error = this.t("event_tools_range");
    }
  }
  render() {
    if (!this.hass?.user?.is_admin || !this.station) return nothing;
    return html`<details class="event-tools">
      <summary>${this.t("event_tools")}</summary>
      <p>${this.t("event_trace_hint")}</p>
      <div class="toolbar">
        <button
          ?disabled=${this._busy || this._trace?.capture?.state === "recording"}
          @click=${() => this.request("trace_start")}
        >
          ${this.t("event_trace_start")}
        </button>
        <button ?disabled=${this._busy} @click=${() => this.request("trace_get")}>
          ${this.t("event_trace_status")}
        </button>
        <button
          ?disabled=${this._busy || this._trace?.capture?.state !== "recording"}
          @click=${() => this.request("trace_stop", { capture_id: this._trace!.capture!.capture_id })}
        >
          ${this.t("event_trace_stop")}
        </button>
      </div>
      ${
        this._trace?.capture
          ? html`<p role="status">
                ${this.t("event_trace_" + this._trace.capture.state)} ·
                ${this.t("event_trace_count")}: ${this._trace.capture.records.length} ·
                ${this.t("event_trace_remaining")}: ${this._trace.remaining_seconds}
              </p>
              <button
                @click=${() => downloadText(JSON.stringify(this._trace, null, 2), "hikvision-event-trace.json", "application/json")}
              >
                ${this.t("event_trace_export")}
              </button>`
          : nothing
      }
      <form @submit=${(e: SubmitEvent) => this.history(e)}>
        <p>${this.t("event_history_hint")}</p>
        <label
          >${this.t("event_history_from")}<input
            name="start"
            type="datetime-local"
            step="60"
            required
            .value=${this._start}
            @input=${(e: Event) => {
              this._start = (e.target as HTMLInputElement).value;
            }}
        /></label>
        <label
          >${this.t("event_history_until")}<input
            name="end"
            type="datetime-local"
            step="60"
            required
            .value=${this._end}
            @input=${(e: Event) => {
              this._end = (e.target as HTMLInputElement).value;
            }}
        /></label>
        <button ?disabled=${this._busy || !this.station.online}>
          ${this.t("event_history_inspect")}
        </button>
      </form>
      ${
        this._history
          ? html`<p role="status">
                ${this.t(this._history.complete && this._history.records === 0 ? "event_history_empty" : this._history.complete && this._history.filter_honored ? "event_history_complete" : "event_history_incomplete")}
                · ${this.t("event_trace_count")}: ${this._history.records}<br />${formatTime(this._history.start, this.hass.language, this.zone)}
                — ${formatTime(this._history.end, this.hass.language, this.zone)}
              </p>
              <button
                @click=${() => downloadText(JSON.stringify(this._history, null, 2), "hikvision-history-inspection.json", "application/json")}
              >
                ${this.t("event_history_export")}
              </button>`
          : nothing
      }
      ${this._busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
    </details>`;
  }
}
customElements.define("hikvision-intercom-event-tools", IntercomEventTools);
