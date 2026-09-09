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
  private contextKey = "";
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (!this.hass?.user?.is_admin) {
      if (this.contextKey || this._context || this._result || this._busy) this.clear();
      return;
    }
    if (changed.has("station") || changed.has("compact") || changed.has("hass")) {
      const s = this.station;
      const key = s ? `${s.id}:${s.online}:${s.call_state}:${this.compact}` : "";
      if (key !== this.contextKey && !this._busy) {
        this.epoch++;
        this.contextKey = key;
        this._context = undefined;
        if (s?.online && (!this.compact || ["ringing", "in_call"].includes(s.call_state)))
          void this.refresh();
      }
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clear();
  }
  private clear() {
    this.epoch++;
    this.contextKey = "";
    this._context = undefined;
    this._result = undefined;
    this._error = "";
    this._busy = false;
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
  private async refresh() {
    if (this._busy || !this.station?.online || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch,
      station = this.station.id;
    this._busy = true;
    this._error = "";
    try {
      const context = await this.hass.callWS<CallContext>({
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
      if (this.valid(epoch, station)) this._busy = false;
    }
  }
  private allowed(command: string) {
    const state = this._context?.state;
    return (
      !!this.hass?.user?.is_admin &&
      !!this.station?.online &&
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
    this._error = "";
    this._result = undefined;
    const notify = this.onBusy;
    notify?.(station, true);
    try {
      const result = await this.hass!.callWS<CallResult>({
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
      if (this.valid(epoch, station)) this._busy = false;
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
        <button ?disabled=${this._busy || !s.online} @click=${() => this.refresh()}>
          ${this.t("call_refresh")}
        </button>
      </div>
      ${this._busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}
      ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
      ${this._result ? html`<p role="status">${callResultText(this._result, this.t)}<br /><small>${formatTime(this._result.checked_at, this.hass?.language, s.clock?.zone ?? UTC_ZONE)}</small></p>` : nothing}
      ${this._refreshRequired ? html`<p>${this.t("call_refresh_required")}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-intercom-call-controls", IntercomCallControls);
