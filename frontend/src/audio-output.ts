import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { translate } from "./i18n";
import type { Hass } from "./types";

type SinkTarget = { setSinkId?: (id: string) => Promise<void> };
type OutputDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };

export function outputSelectionSupported() {
  return (
    window.isSecureContext &&
    typeof AudioContext !== "undefined" &&
    typeof (AudioContext.prototype as SinkTarget).setSinkId === "function" &&
    typeof (HTMLMediaElement.prototype as SinkTarget).setSinkId === "function"
  );
}
export async function routeOutput(target: AudioContext | HTMLMediaElement | undefined, id: string) {
  if (!target) return;
  const sink = target as SinkTarget;
  if (!sink.setSinkId) {
    if (id) throw { code: "audio_output_unsupported" };
    return;
  }
  await sink.setSinkId(id);
}

/** Browser-local output selection. Never requests a microphone or emits device commands. */
export class AudioOutput extends LitElement {
  static styles = css`
    :host {
      display: block;
      margin-block: 12px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 8px;
    }
    label {
      display: grid;
      gap: 4px;
      min-width: 0;
      max-width: 100%;
    }
    select,
    button {
      font: inherit;
      min-height: 40px;
      max-width: 100%;
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 8px;
      padding: 8px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
    }
    p {
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .error {
      color: var(--error-color, #bd4350);
    }
  `;
  static properties = {
    hass: { attribute: false },
    locked: { attribute: false },
    apply: { attribute: false },
    devices: { state: true },
    selected: { state: true },
    busy: { state: true },
    error: { state: true },
    message: { state: true },
  };
  hass?: Hass;
  locked = false;
  apply?: (id: string) => Promise<void>;
  private devices: MediaDeviceInfo[] = [];
  private selected = "";
  private busy = false;
  private error = "";
  private message = "";
  private epoch = 0;
  private enumeration = 0;
  private actor?: string;
  private authorized = false;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private changed = () => {
    if (this.isConnected && !document.hidden) void this.refresh();
  };
  private hide = () => {
    if (document.hidden) {
      this.epoch++;
      this.busy = false;
      this.restoreChoice();
    }
  };
  connectedCallback() {
    super.connectedCallback();
    navigator.mediaDevices?.addEventListener?.("devicechange", this.changed);
    document.addEventListener("visibilitychange", this.hide);
  }
  disconnectedCallback() {
    this.epoch++;
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.changed);
    document.removeEventListener("visibilitychange", this.hide);
    super.disconnectedCallback();
  }
  protected updated(_changes: PropertyValues) {
    if (this.actor !== this.hass?.user?.id || this.authorized !== !!this.hass?.user?.is_admin) {
      this.epoch++;
      this.actor = this.hass?.user?.id;
      this.authorized = !!this.hass?.user?.is_admin;
      this.devices = [];
      this.selected = "";
      this.busy = false;
      this.error = this.message = "";
    }
  }
  private valid(epoch: number) {
    return epoch === this.epoch && this.isConnected && this.authorized && !document.hidden;
  }
  private restoreChoice() {
    const select = this.renderRoot.querySelector("select");
    if (select) select.value = this.selected;
  }
  private async refresh() {
    if (
      !this.authorized ||
      this.busy ||
      !outputSelectionSupported() ||
      !navigator.mediaDevices?.enumerateDevices
    )
      return;
    const epoch = this.epoch;
    const enumeration = ++this.enumeration;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!this.valid(epoch) || enumeration !== this.enumeration) return;
      this.devices = devices
        .filter(
          (item) => item.kind === "audiooutput" && item.deviceId !== "default" && item.deviceId,
        )
        .slice(0, 64);
      if (this.selected && !this.devices.some((item) => item.deviceId === this.selected))
        this.error = this.t("audio_output_missing");
      else this.error = "";
    } catch {
      if (this.valid(epoch)) this.error = this.t("audio_output_failed");
    }
  }
  private async choose(id: string) {
    if (!this.authorized || this.locked || this.busy || !this.apply || id.length > 1024) return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = this.message = "";
    try {
      await this.apply(id);
      if (this.valid(epoch)) {
        this.selected = id;
        this.message = this.t("audio_output_selected");
      }
    } catch {
      if (this.valid(epoch)) this.error = this.t("audio_output_failed");
    } finally {
      if (this.valid(epoch)) {
        this.busy = false;
      }
      if (this.isConnected) this.restoreChoice();
    }
  }
  private async requestPermission() {
    const devices = navigator.mediaDevices as OutputDevices | undefined;
    if (!devices?.selectAudioOutput || !this.authorized || this.locked || this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = this.message = "";
    try {
      const device = await devices.selectAudioOutput();
      if (!this.valid(epoch)) return;
      this.devices = [
        ...this.devices.filter((item) => item.deviceId !== device.deviceId),
        device,
      ].slice(0, 64);
      this.busy = false;
      await this.choose(device.deviceId);
    } catch {
      if (this.valid(epoch)) this.error = this.t("audio_output_permission");
    } finally {
      if (this.valid(epoch)) this.busy = false;
    }
  }
  render() {
    if (!this.authorized) return nothing;
    const supported = outputSelectionSupported();
    return html`<section aria-label=${this.t("audio_output_title")}>
      <div class="row">
        <label
          >${this.t("audio_output_title")}<select
            .value=${this.selected}
            ?disabled=${!supported || this.busy || this.locked}
            @change=${(e: Event) => void this.choose((e.target as HTMLSelectElement).value)}
          >
            <option value="" ?selected=${!this.selected}>${this.t("audio_output_default")}</option>
            ${this.selected && !this.devices.some((item) => item.deviceId === this.selected) ? html`<option value=${this.selected} selected>${this.t("audio_output_missing_label")}</option>` : nothing}
            ${this.devices.map((device, index) => html`<option value=${device.deviceId} ?selected=${device.deviceId === this.selected}>${device.label || `${this.t("audio_output_device")} ${index + 1}`}</option>`)}
          </select></label
        >${supported ? html`<button type="button" ?disabled=${this.busy || this.locked} @click=${() => void this.refresh()}>${this.t("audio_output_refresh")}</button>${(navigator.mediaDevices as OutputDevices | undefined)?.selectAudioOutput ? html`<button type="button" ?disabled=${this.busy || this.locked} @click=${() => void this.requestPermission()}>${this.t("audio_output_allow")}</button>` : nothing}` : nothing}
      </div>
      <p>${this.t(supported ? "audio_output_scope" : "audio_output_unsupported")}</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.message ? html`<p role="status">${this.message}</p>` : nothing}
    </section>`;
  }
}
customElements.define("wiskey-audio-output", AudioOutput);
