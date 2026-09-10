import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { translate } from "./i18n";
import type { Hass } from "./types";

/** Local input meter only: no network, recording or connection to an audio destination. */
export class MicrophoneInput extends LitElement {
  static styles = css`
    :host {
      display: block;
      margin-block: 12px;
    }
    details {
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 10px;
      padding: 10px;
    }
    summary {
      cursor: pointer;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: end;
      margin-top: 10px;
    }
    select,
    button {
      font: inherit;
      min-height: 44px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, #ddd);
      padding: 8px;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      max-width: 100%;
    }
    label {
      display: grid;
      gap: 4px;
      max-width: 100%;
    }
    meter {
      width: 100%;
    }
    p {
      font-size: 13px;
    }
  `;
  static properties = {
    hass: { attribute: false },
    locked: { type: Boolean },
    testingAllowed: { type: Boolean },
    devices: { state: true },
    selected: { state: true },
    testing: { state: true },
    level: { state: true },
    error: { state: true },
  };
  hass?: Hass;
  locked = false;
  testingAllowed = true;
  private devices: MediaDeviceInfo[] = [];
  private selected = "";
  private testing = false;
  private level = 0;
  private error = "";
  private actor?: string;
  private authorized = false;
  private epoch = 0;
  private enumeration = 0;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private meter?: AnalyserNode;
  private timer?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private hide = () => {
    if (document.hidden) this.stopTest();
  };
  private onBlur = () => this.stopTest();
  private changed = () => {
    this.stopTest();
    void this.refresh();
  };
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.hide);
    window.addEventListener("pagehide", this.onBlur);
    window.addEventListener("blur", this.onBlur);
    navigator.mediaDevices?.addEventListener?.("devicechange", this.changed);
  }
  disconnectedCallback() {
    this.stopTest();
    this.enumeration++;
    document.removeEventListener("visibilitychange", this.hide);
    window.removeEventListener("pagehide", this.onBlur);
    window.removeEventListener("blur", this.onBlur);
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.changed);
    super.disconnectedCallback();
  }
  protected updated(changes: PropertyValues) {
    if (this.actor !== this.hass?.user?.id || this.authorized !== !!this.hass?.user?.is_admin) {
      this.authorized = !!this.hass?.user?.is_admin;
      this.stopTest();
      this.enumeration++;
      this.devices = [];
      this.actor = this.hass?.user?.id;
      this.selected = "";
      this.error = "";
      if (this.hass?.user?.is_admin) {
        try {
          const saved = localStorage.getItem(this.key());
          if (saved && saved.length <= 1024) this.selected = saved;
        } catch {
          /* storage is optional */
        }
        this.announce();
      }
    }
    if (
      (changes.has("testingAllowed") && !this.testingAllowed) ||
      (changes.has("locked") && this.locked)
    )
      this.stopTest();
  }
  private key() {
    return "wiskey:microphone:v1:" + this.actor;
  }
  private announce() {
    this.dispatchEvent(
      new CustomEvent("microphone-selected", { detail: { deviceId: this.selected } }),
    );
  }
  private choose(id: string) {
    this.stopTest();
    this.selected = id;
    this.error = "";
    try {
      if (id) localStorage.setItem(this.key(), id);
      else localStorage.removeItem(this.key());
    } catch {
      /* storage is optional */
    }
    this.announce();
  }
  private async refresh() {
    if (!navigator.mediaDevices?.enumerateDevices || !this.hass?.user?.is_admin || document.hidden)
      return;
    const epoch = ++this.enumeration;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (epoch !== this.enumeration || !this.isConnected) return;
      this.devices = devices.filter((d) => d.kind === "audioinput").slice(0, 64);
      if (this.selected && !this.devices.some((d) => d.deviceId === this.selected))
        this.error = "mic_selection_unavailable";
    } catch {
      if (epoch === this.enumeration) this.error = "audio_microphone_failed";
    }
  }
  stopTest() {
    this.epoch++;
    clearInterval(this.timer);
    clearTimeout(this.deadline);
    this.source?.disconnect();
    this.source = undefined;
    this.meter?.disconnect();
    this.meter = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    const context = this.context;
    this.context = undefined;
    if (context) void context.close().catch(() => {});
    this.testing = false;
    this.level = 0;
  }
  private async testInput() {
    if (
      this.testing ||
      this.locked ||
      !this.testingAllowed ||
      !window.isSecureContext ||
      !this.hass?.user?.is_admin ||
      !navigator.mediaDevices?.getUserMedia
    )
      return;
    this.stopTest();
    this.testing = true;
    this.error = "";
    const epoch = this.epoch;
    this.deadline = setTimeout(() => this.stopTest(), 60000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.selected ? { exact: this.selected } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (epoch !== this.epoch || !this.isConnected || document.hidden) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (epoch !== this.epoch || this.context !== context) return;
      this.source = context.createMediaStreamSource(stream);
      const meter = context.createAnalyser();
      meter.fftSize = 512;
      this.meter = meter;
      this.source.connect(meter);
      const samples = new Float32Array(meter.fftSize);
      this.timer = setInterval(() => {
        if (epoch !== this.epoch) return;
        meter.getFloatTimeDomainData(samples);
        this.level = Math.min(
          100,
          Math.round(Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length) * 100),
        );
      }, 100);
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (epoch === this.epoch) {
              this.stopTest();
              this.error = "mic_selection_unavailable";
            }
          },
          { once: true },
        ),
      );
      void this.refresh();
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.stopTest();
      this.error =
        (e as DOMException).name === "NotAllowedError"
          ? "audio_microphone_denied"
          : (e as DOMException).name === "OverconstrainedError"
            ? "mic_selection_unavailable"
            : "audio_microphone_failed";
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<details>
      <summary>${this.t("mic_options")}</summary>
      <p>${this.t("mic_local_hint")}</p>
      <div class="row">
        <label
          >${this.t("mic_device")}<select
            .value=${this.selected}
            ?disabled=${this.locked}
            @change=${(e: Event) => this.choose((e.target as HTMLSelectElement).value)}
          >
            <option value="">${this.t("mic_default")}</option>
            ${this.selected && !this.devices.some((d) => d.deviceId === this.selected) ? html`<option value=${this.selected}>${this.t("mic_saved")}</option>` : nothing}
            ${this.devices.filter((d) => d.deviceId).map((d, i) => html`<option value=${d.deviceId}>${d.label || `${this.t("mic_device")} ${i + 1}`}</option>`)}
          </select></label
        >
        <button type="button" ?disabled=${this.locked} @click=${() => this.refresh()}>
          ${this.t("mic_refresh")}
        </button>
        ${this.testing ? html`<button type="button" @click=${() => this.stopTest()}>${this.t("mic_test_stop")}</button>` : html`<button type="button" ?disabled=${this.locked || !this.testingAllowed || !window.isSecureContext} @click=${() => this.testInput()}>${this.t("mic_test")}</button>`}
      </div>
      ${
        this.testing
          ? html`<p role="status">${this.t("mic_local_active")} · ${this.level}%</p>
              <meter
                min="0"
                max="100"
                .value=${this.level}
                aria-label=${this.t("audio_signal")}
              ></meter>`
          : nothing
      }
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
    </details>`;
  }
}
customElements.define("wiskey-microphone-input", MicrophoneInput);
