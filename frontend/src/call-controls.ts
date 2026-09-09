import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { formatTime, UTC_ZONE } from "./time";
import type { Hass, Station } from "./types";

export interface CallResult {
  command: string;
  acknowledged: boolean | null;
  observed_state: string | null;
  observation: string;
  checked_at: string;
  physical_result: "unverified";
}
interface CallContext {
  call_commands: string[];
  state: string;
  checked_at: string;
  busy: boolean;
  last_result: CallResult | null;
}
export function callResultText(result: CallResult, t: (key: string) => string): string {
  const ack = t(result.acknowledged === true ? "call_acknowledged" : "call_delivery_unknown");
  const observation = t("call_observation_" + result.observation);
  const state = result.observed_state ? t(result.observed_state) : t("unknown");
  return `${ack} · ${observation} · ${t("call_observed_state")}: ${state}`;
}

/** Commands are explicit; capability and state reads cannot open a call. */
export class IntercomCallControls extends LitElement {
  static styles = [
    styles,
    css`
      .call-controls.compact {
        padding: 0;
        margin: 0 0 10px;
        border: 0;
        background: transparent;
      }
      .compact p {
        margin: 5px 0 10px;
        font-size: 11px;
        color: var(--secondary-text-color);
      }
      .compact .toolbar {
        margin: 0;
        gap: 6px;
      }
      .compact button {
        padding: 7px 10px;
        min-height: 34px;
        font-size: 12px;
      }

      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      .call-controls {
        margin-block: 12px;
        padding: 12px;
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      p {
        overflow-wrap: anywhere;
      }
    `,
  ];
  static properties = {
    onBusy: { attribute: false },
    hass: { attribute: false },
    station: { attribute: false },
    compact: { type: Boolean },
    blocked: { type: Boolean },
    _context: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _result: { state: true },
    _refreshRequired: { state: true },
    _haConnected: { state: true },
  };
  onBusy?: (station: string, busy: boolean) => void;
  hass?: Hass;
  station?: Station;
  compact = false;
  blocked = false;
  private _context?: CallContext;
  private _busy = false;
  private _error = "";
  private _result?: CallResult;
  private _refreshRequired = false;
  private epoch = 0;
  private stationId = "";
  private operation?: "read" | "signal";
  private cancelRead?: () => void;
  private cancelSignal?: () => void;
  private connection?: Hass["connection"];
  private _haConnected = true;
  private haDisconnected = () => {
    this._haConnected = false;
    const operation = this.operation;
    this.epoch++;
    this.cancelRead?.();
    this.cancelSignal?.();
    this._context = undefined;
    this._result = undefined;
    this._busy = false;
    this.operation = undefined;
    this.contextKey = "";
    if (operation)
      this._error = this.t(operation === "signal" ? "call_command_unknown" : "call_read_failed");
    if (operation === "signal") this._refreshRequired = true;
  };
  private haReady = () => {
    this._haConnected = true;
  };
  private contextKey = "";
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    if (!this.hass?.user?.is_admin) {
      if (this.contextKey || this._context || this._result || this._busy || this.connection) {
        this.clear();
        this.bindConnection(undefined);
      }
      return;
    }
    if (this.connection !== this.hass.connection) {
      this.clear();
      this.bindConnection(this.hass.connection);
    }
    const s = this.station;
    if (this.stationId !== (s?.id ?? "")) {
      this.clear();
      this.stationId = s?.id ?? "";
    }
    if (
      changed.get("blocked") === true &&
      !this.blocked &&
      this.operation !== "signal" &&
      !this._refreshRequired
    )
      this.contextKey = "";
    const key = s ? `${s.id}:${s.online}:${s.call_state}:${this.compact}:${this._haConnected}` : "";
    if (key !== this.contextKey) {
      this.contextKey = key;
      this._context = undefined;
      // State reads become stale on a station/state change. A submitted command
      // keeps its own station ownership until its result or bounded deadline.
      if (this.operation !== "signal") {
        this.epoch++;
        this.cancelRead?.();
        this._busy = false;
        this.operation = undefined;
        if (
          s?.online &&
          this._haConnected &&
          !this._refreshRequired &&
          (!this.compact || ["ringing", "in_call"].includes(s.call_state))
        )
          void this.refresh();
      }
    }
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
    this.cancelRead?.();
    // Closing a view cannot cancel a device command already submitted. Keep its
    // parent station lock until completion/timeout, without displaying late data.
    this.cancelSignal = undefined;
    this.contextKey = "";
    this._context = undefined;
    this._result = undefined;
    this._error = "";
    this._busy = false;
    this.operation = undefined;
    this._refreshRequired = false;
  }
  private valid(epoch: number, station: string) {
    return (
      this.isConnected &&
      epoch === this.epoch &&
      this.station?.id === station &&
      !!this.hass?.user?.is_admin
    );
  }
  private request<T>(kind: "read" | "signal", message: Record<string, unknown>): Promise<T> {
    const property = kind === "read" ? "cancelRead" : "cancelSignal";
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        if (this[property] === cancel) this[property] = undefined;
      };
      const cancel = () => {
        cleanup();
        reject(new Error("call_connection_lost"));
      };
      // Server budgets are 15s for a read and 30s for signaling + observation.
      const timer = setTimeout(cancel, kind === "read" ? 20000 : 40000);
      this[property] = cancel;
      try {
        this.hass!.callWS<T>(message).then(
          (value) => {
            cleanup();
            resolve(value);
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  private async refresh() {
    if (
      this._busy ||
      !this.station?.online ||
      !this.hass?.user?.is_admin ||
      !this._haConnected ||
      this.hass.connection.connected === false
    )
      return;
    const epoch = this.epoch,
      station = this.station.id;
    this._busy = true;
    this.operation = "read";
    this._error = "";
    try {
      const context = await this.request<CallContext>("read", {
        type: "hikvision_intercom/media/call",
        station_id: station,
      });
      if (this.valid(epoch, station)) {
        this._context = context;
        this._result = context.last_result ?? undefined;
        this._refreshRequired = false;
      }
    } catch {
      if (this.valid(epoch, station)) {
        this._context = undefined;
        this._error = this.t("call_read_failed");
      }
    } finally {
      if (this.valid(epoch, station)) {
        this._busy = false;
        this.operation = undefined;
      }
    }
  }
  private allowed(command: string) {
    const state = this._context?.state;
    return (
      !!this.hass?.user?.is_admin &&
      !!this.station?.online &&
      this._haConnected &&
      this.hass.connection.connected !== false &&
      !this._busy &&
      !this.blocked &&
      !this._refreshRequired &&
      !this._context?.busy &&
      !!this._context?.call_commands.includes(command) &&
      this.station.call_state === state &&
      (command === "hangUp" ? state === "in_call" : state === "ringing")
    );
  }
  private async signal(command: string) {
    if (!this.allowed(command) || !this.station) return;
    if (command !== "answer")
      this.dispatchEvent(
        new CustomEvent("hikvision-call-ending", {
          detail: { station: this.station.id },
          bubbles: true,
          composed: true,
        }),
      );
    const epoch = this.epoch,
      station = this.station.id;
    this._busy = true;
    this.operation = "signal";
    this._error = "";
    this._result = undefined;
    const notify = this.onBusy;
    notify?.(station, true);
    try {
      const result = await this.request<CallResult>("signal", {
        type: "hikvision_intercom/media/signal",
        station_id: station,
        command,
      });
      if (this.valid(epoch, station)) {
        this._result = result;
        this._refreshRequired = true;
        this._context = undefined;
      }
    } catch {
      if (this.valid(epoch, station)) {
        this._error = this.t("call_command_unknown");
        this._refreshRequired = true;
        this._context = undefined;
      }
    } finally {
      // Release the parent's station lock even if the camera was closed meanwhile.
      notify?.(station, false);
      if (this.valid(epoch, station)) {
        this._busy = false;
        this.operation = undefined;
      }
    }
  }
  render() {
    const s = this.station;
    if (
      !this.hass?.user?.is_admin ||
      !s ||
      (this.compact &&
        !["ringing", "in_call"].includes(s.call_state) &&
        !this._result &&
        !this._error)
    )
      return nothing;
    return html`<section
      class="call-controls ${this.compact ? "compact" : ""}"
      aria-label=${this.t("media_signals")}
    >
      <p>${this.t(this.compact ? "call_compact_hint" : "media_signal_hint")}</p>
      <div class="toolbar">
        ${["answer", "reject", "hangUp"].filter((command) => this._context?.call_commands.includes(command) && (!this.compact || (command === "hangUp" ? s.call_state === "in_call" : s.call_state === "ringing"))).map((command) => html`<button aria-label=${this.t("media_" + command)} ?disabled=${!this.allowed(command)} @click=${() => this.signal(command)}>${this.t(this.compact ? "call_action_" + command : "media_" + command)}</button>`)}
        <button
          ?disabled=${this._busy || !s.online || !this._haConnected}
          @click=${() => this.refresh()}
        >
          ${this.t("call_refresh")}
        </button>
      </div>
      ${!this._haConnected ? html`<p role="status">${this.t("call_connection_lost")}</p>` : nothing}
      ${this._busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}
      ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
      ${this._result ? html`<p role="status">${callResultText(this._result, this.t)}<br /><small>${formatTime(this._result.checked_at, this.hass?.language, s.clock?.zone ?? UTC_ZONE)}</small></p>` : nothing}
      ${this._refreshRequired ? html`<p>${this.t("call_refresh_required")}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-intercom-call-controls", IntercomCallControls);
