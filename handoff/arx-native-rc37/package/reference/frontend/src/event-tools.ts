import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
import { boundedRequest } from "./request";
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
    zone: { state: true },
    _trace: { state: true },
    _history: { state: true },
    _start: { state: true },
    _end: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _haConnected: { state: true },
    _traceNeedsRefresh: { state: true },
  };
  hass?: Hass;
  station?: Station;
  private _trace?: Trace;
  private _history?: Inspection;
  private _busy = false;
  private _error = "";
  private epoch = 0;
  private connection?: Hass["connection"];
  private pending?: AbortController;
  private operation = "";
  private _haConnected = true;
  private _traceNeedsRefresh = false;
  private haDisconnected = () => {
    this._haConnected = false;
    if (["trace_start", "trace_stop"].includes(this.operation)) this._traceNeedsRefresh = true;
    if (this.operation) this._error = this.t("event_tools_failed");
    this.epoch++;
    this.pending?.abort();
    this.pending = undefined;
    this.operation = "";
    this._busy = false;
  };
  private haReady = () => {
    this._haConnected = true;
  };
  private stationId = "";
  private _start = "";
  private _end = "";
  private zone: DisplayZone = UTC_ZONE;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    if (!this.hass?.user?.is_admin) {
      this.clear();
      this.bindConnection(undefined);
      return;
    }
    const replaced = this.connection !== this.hass.connection;
    if (replaced || (this.station?.id ?? "") !== this.stationId) {
      this.clear();
      this.bindConnection(this.hass.connection);
      this.stationId = this.station?.id ?? "";
      this.zone = this.station?.clock?.zone ?? UTC_ZONE;
      this._start = localInput(new Date(Date.now() - 7200000).toISOString(), this.zone);
      this._end = localInput(new Date().toISOString(), this.zone);
    } else if (changed.has("station")) {
      const zone = this.station?.clock?.zone ?? UTC_ZONE;
      if (JSON.stringify(zone) !== JSON.stringify(this.zone)) {
        try {
          // Keep the selected instants when a delayed device clock read or manual
          // zone selection changes the display; never reinterpret old wall time.
          const start = fromLocalInput(this._start, this.zone);
          const end = fromLocalInput(this._end, this.zone);
          this._start = localInput(start, zone);
          this._end = localInput(end, zone);
        } catch {
          this._start = "";
          this._end = "";
          this._error = this.t("event_tools_zone_reset");
        }
        this.zone = zone;
      }
    }
  }
  connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated) this.requestUpdate();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clear();
    this.bindConnection(undefined);
  }
  private bindConnection(connection?: Hass["connection"]) {
    this.connection?.removeEventListener?.("disconnected", this.haDisconnected);
    this.connection?.removeEventListener?.("ready", this.haReady);
    this.connection = connection;
    this._haConnected = connection?.connected !== false;
    connection?.addEventListener?.("disconnected", this.haDisconnected);
    connection?.addEventListener?.("ready", this.haReady);
  }
  private clear() {
    this.epoch++;
    this.pending?.abort();
    this.pending = undefined;
    this.operation = "";
    this._trace = undefined;
    this._history = undefined;
    this._error = "";
    this._busy = false;
    this._traceNeedsRefresh = false;
    this.stationId = "";
  }
  private valid(epoch: number, station: string, hass: Hass) {
    return (
      epoch === this.epoch &&
      this.isConnected &&
      !!this.hass?.user?.is_admin &&
      this.station?.id === station &&
      this.hass.connection === hass.connection &&
      this._haConnected &&
      hass.connection.connected !== false
    );
  }
  private async request(action: string, data: Record<string, unknown> = {}) {
    const mutation = ["trace_start", "trace_stop"].includes(action);
    if (
      this._busy ||
      !this.station ||
      !this.hass?.user?.is_admin ||
      !this.valid(this.epoch, this.station.id, this.hass) ||
      (mutation && this._traceNeedsRefresh)
    )
      return;
    const epoch = this.epoch,
      station = this.station.id,
      hass = this.hass;
    const controller = new AbortController();
    this.pending = controller;
    this.operation = action;
    this._busy = true;
    this._error = "";
    try {
      // The history inspector has a 45s server budget. Trace status is local HA data.
      const result = await boundedRequest(
        () =>
          hass.callWS<Trace | Inspection>({
            type: "hikvision_intercom/events/" + action,
            station_id: station,
            ...data,
          }),
        action === "history_inspect" ? 60000 : 20000,
        controller.signal,
      );
      if (!this.valid(epoch, station, hass)) return;
      if (action === "history_inspect") this._history = result as Inspection;
      else {
        this._trace = result as Trace;
        this._traceNeedsRefresh = false;
      }
    } catch {
      if (this.valid(epoch, station, hass)) {
        this._error = this.t("event_tools_failed");
        if (mutation) this._traceNeedsRefresh = true;
      }
    } finally {
      if (epoch === this.epoch) {
        this._busy = false;
        this.pending = undefined;
        this.operation = "";
      }
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
      ${!this._haConnected ? html`<p role="status">${this.t("events_connection_lost")}</p>` : nothing}
      ${this._traceNeedsRefresh ? html`<p role="alert" class="notice error">${this.t("event_trace_unknown")}</p>` : nothing}
      <div class="toolbar">
        <button
          ?disabled=${this._busy || !this._haConnected || this._traceNeedsRefresh || this._trace?.capture?.state === "recording"}
          @click=${() => this.request("trace_start")}
        >
          ${this.t("event_trace_start")}
        </button>
        <button
          ?disabled=${this._busy || !this._haConnected}
          @click=${() => this.request("trace_get")}
        >
          ${this.t("event_trace_status")}
        </button>
        <button
          ?disabled=${this._busy || !this._haConnected || this._traceNeedsRefresh || this._trace?.capture?.state !== "recording"}
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
        <p class="sub">${this.t("clock_filter_basis")}: <bdi>${this.zone.name}</bdi></p>
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
        <button ?disabled=${this._busy || !this._haConnected || !this.station.online}>
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
