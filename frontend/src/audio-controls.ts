import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";
import { decodeMuLaw } from "./audio-codec";

interface AudioEvent {
  state: "ready" | "closed";
  token?: string;
  sample_rate?: number;
  packet_bytes?: number;
  reason?: string;
  close_confirmed?: boolean | null;
}

/** A visible, connection-owned session. Microphone access always needs a press. */
export class IntercomAudioControls extends LitElement {
  static styles = css`
    :host {
      display: block;
      margin-block: 14px;
    }
    section {
      border: 1px solid var(--divider-color, #dce5e6);
      border-radius: 12px;
      padding: 14px;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 16px;
    }
    p {
      margin: 8px 0;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      font: inherit;
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 10px;
      padding: 10px 14px;
      min-height: 44px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #222);
      cursor: pointer;
      touch-action: none;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    button[aria-pressed="true"] {
      background: var(--error-color, #b32b25);
      color: #fff;
    }
    .error {
      color: var(--error-color, #b32b25);
    }
  `;
  static properties = {
    hass: { attribute: false },
    station: { attribute: false },
    _state: { state: true },
    _error: { state: true },
    _talking: { state: true },
    _micPending: { state: true },
  };
  hass?: Hass;
  station?: Station;
  private _state = "idle";
  private _error = "";
  private _talking = false;
  private _micPending = false;
  private epoch = 0;
  private micEpoch = 0;
  private context?: AudioContext;
  private connection?: Hass["connection"];
  private openingTimeout?: ReturnType<typeof setTimeout>;
  private disconnected = () => this.stop("audio_connection_lost");
  private token = "";
  private unsubscribe?: () => void;
  private stream?: MediaStream;
  private microphone?: MediaStreamAudioSourceNode;
  private processor?: AudioWorkletNode;
  private workletLoaded = false;
  private pressed = false;
  private sequence = 0;
  private sending = false;
  private nextPlayback = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private pendingRequests = new Set<() => void>();
  private audioStateChanged = () => {
    if (this._state === "listening" && this.context?.state !== "running")
      this.stop("audio_playback_interrupted");
  };
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private onVisibility = () => {
    if (document.hidden) this.stop();
  };
  private onWindowBlur = () => this.releaseTalk();
  private onPageHide = () => this.stop();
  private onCallEnding = (event: Event) => {
    if ((event as CustomEvent<{ station: string }>).detail?.station === this.station?.id)
      this.stop();
  };
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("hikvision-call-ending", this.onCallEnding);
    window.addEventListener("blur", this.onWindowBlur);
  }
  disconnectedCallback() {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("hikvision-call-ending", this.onCallEnding);
    window.removeEventListener("blur", this.onWindowBlur);
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    if (
      this._state !== "idle" &&
      (!this.hass?.user?.is_admin ||
        this.hass.connection !== this.connection ||
        !this.station?.online ||
        (changed.has("station") &&
          (changed.get("station") as Station | undefined)?.id !== this.station.id))
    )
      this.stop();
  }
  private valid(epoch: number) {
    return this.isConnected && epoch === this.epoch && !!this.hass?.user?.is_admin;
  }
  private async start() {
    if (this._state !== "idle" || !this.hass?.user?.is_admin || !this.station?.online) return;
    const epoch = ++this.epoch,
      hass = this.hass;
    this._state = "opening";
    this.connection = hass.connection;
    this.connection.addEventListener?.("disconnected", this.disconnected);
    this.openingTimeout = setTimeout(() => {
      if (this.valid(epoch) && this._state === "opening") this.stop("audio_connection_lost");
    }, 25000);
    this._error = "";
    this.sequence = 0;
    try {
      const context = new AudioContext({ sampleRate: 8000 });
      this.context = context;
      context.addEventListener("statechange", this.audioStateChanged);
      if (context.sampleRate !== 8000) throw new Error("unsupported");
      await context.resume();
      if (!this.valid(epoch)) return;
      const unsubscribe = await hass.connection.subscribeMessage<AudioEvent>(
        (event) => {
          if (!this.valid(epoch)) return;
          if (event.state === "closed") {
            this.stop(event.close_confirmed === false ? "audio_close_unconfirmed" : event.reason);
          } else if (event.token && event.sample_rate === 8000 && event.packet_bytes === 800) {
            clearTimeout(this.openingTimeout);
            this.openingTimeout = undefined;
            if (context.state !== "running") {
              this.stop("audio_playback_interrupted");
              return;
            }
            this.token = event.token;
            this._state = "listening";
            void this.receive(epoch);
          } else this.stop("audio_unsupported");
        },
        { type: "hikvision_intercom/audio/start", station_id: this.station!.id },
        { resubscribe: false, preCheck: () => this.valid(epoch) && this.context === context },
      );
      if (this.valid(epoch)) this.unsubscribe = unsubscribe;
      else this.cancelSubscription(unsubscribe);
    } catch (error) {
      if (this.valid(epoch)) this.stop(this.errorCode(error));
    }
  }
  private errorCode(error: unknown): string {
    const code = (error as { code?: unknown })?.code;
    return typeof code === "string" &&
      ["audio_busy", "audio_unsupported", "audio_auth_failed", "audio_open_unconfirmed"].includes(
        code,
      )
      ? code
      : "audio_connection_lost";
  }
  /** A lost RPC stops this session; it is never retried with old speech. */
  private request<T>(message: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        this.pendingRequests.delete(cancel);
        reject(new Error("audio_connection_lost"));
      };
      const timer = setTimeout(cancel, 5000);
      this.pendingRequests.add(cancel);
      void this.hass!.callWS<T>(message)
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timer);
          this.pendingRequests.delete(cancel);
        });
    });
  }
  private async receive(epoch: number) {
    while (this.valid(epoch) && this.token) {
      try {
        const result = await this.request<{ data: string }>({
          type: "hikvision_intercom/audio/receive",
          token: this.token,
        });
        if (!this.valid(epoch)) return;
        if (!result.data) continue;
        const packet = atob(result.data);
        if (packet.length !== 800) throw new Error("invalid packet");
        if (!this._talking) this.play(packet);
      } catch {
        if (this.valid(epoch)) this.stop("audio_connection_lost");
        return;
      }
    }
  }
  private play(packet: string) {
    const context = this.context;
    if (!context || context.state !== "running") return;
    if (this.nextPlayback > context.currentTime + 0.3) this.clearPlayback();
    const buffer = context.createBuffer(1, 800, 8000),
      output = buffer.getChannelData(0);
    for (let i = 0; i < 800; i++) output[i] = decodeMuLaw(packet.charCodeAt(i));
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    this.sources.add(source);
    this.nextPlayback = Math.max(context.currentTime + 0.02, this.nextPlayback);
    source.start(this.nextPlayback);
    this.nextPlayback += 0.1;
  }
  private clearPlayback() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.nextPlayback = 0;
  }
  private async talk() {
    if (
      this._state !== "listening" ||
      this.pressed ||
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia
    )
      return;
    this.pressed = true;
    this._micPending = true;
    this._error = "";
    const epoch = this.epoch,
      micEpoch = ++this.micEpoch,
      context = this.context!;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!this.valid(epoch) || !this.pressed || micEpoch !== this.micEpoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      if (!this.workletLoaded) {
        const url = new URL("./audio-worklet.js", import.meta.url);
        url.search = new URL(import.meta.url).search;
        await context.audioWorklet.addModule(url.href);
        if (this.valid(epoch) && this.context === context) this.workletLoaded = true;
      }
      if (!this.valid(epoch) || !this.pressed || micEpoch !== this.micEpoch) return;
      this.microphone = context.createMediaStreamSource(stream);
      this.processor = new AudioWorkletNode(context, "hikvision-microphone", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.processor.port.onmessage = (event: MessageEvent<Uint8Array>) => {
        if (this.valid(epoch) && this.pressed && micEpoch === this.micEpoch)
          void this.send(event.data, epoch);
      };
      this.processor.onprocessorerror = () => this.stop("audio_microphone_failed");
      this.microphone.connect(this.processor);
      this.processor.connect(context.destination);
      this.clearPlayback();
      this._talking = true;
      stream
        .getAudioTracks()
        .forEach((track) =>
          track.addEventListener("ended", () => this.releaseTalk(), { once: true }),
        );
    } catch {
      if (this.valid(epoch) && micEpoch === this.micEpoch) {
        this.releaseTalk();
        this._error = "audio_microphone_failed";
      }
    } finally {
      if (this.valid(epoch) && micEpoch === this.micEpoch) this._micPending = false;
    }
  }
  private async send(packet: Uint8Array, epoch: number) {
    if (this.sending || packet.length !== 800 || !this.token) return;
    this.sending = true;
    try {
      const data = btoa(String.fromCharCode(...packet));
      const result = await this.request<{ sequence: number }>({
        type: "hikvision_intercom/audio/send",
        token: this.token,
        sequence: this.sequence,
        data,
      });
      if (this.valid(epoch)) this.sequence = result.sequence;
    } catch {
      if (this.valid(epoch)) this.stop("audio_connection_lost");
    } finally {
      if (this.valid(epoch)) this.sending = false;
    }
  }
  private releaseTalk() {
    this.pressed = false;
    this.micEpoch++;
    this._micPending = false;
    this._talking = false;
    if (this.processor) {
      this.processor.port.onmessage = null;
      this.processor.onprocessorerror = null;
      this.processor.disconnect();
      this.processor.port.close();
    }
    this.processor = undefined;
    this.microphone?.disconnect();
    this.microphone = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    if (this.token) {
      const epoch = this.epoch;
      void this.request({ type: "hikvision_intercom/audio/mute", token: this.token }).catch(() => {
        if (this.valid(epoch)) this.stop("audio_connection_lost");
      });
    }
  }
  private cancelSubscription(unsubscribe: () => void) {
    try {
      void Promise.resolve(unsubscribe()).catch(() => undefined);
    } catch {
      /* The connection may already be closed. */
    }
  }
  private stop(reason?: string) {
    this.epoch++;
    clearTimeout(this.openingTimeout);
    this.openingTimeout = undefined;
    this.connection?.removeEventListener?.("disconnected", this.disconnected);
    this.connection = undefined;
    this.token = "";
    this.releaseTalk();
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (unsubscribe) this.cancelSubscription(unsubscribe);
    this.clearPlayback();
    for (const cancel of this.pendingRequests) cancel();
    this.context?.removeEventListener("statechange", this.audioStateChanged);
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.workletLoaded = false;
    this.sending = false;
    this._state = "idle";
    if (reason && reason !== "audio_stopped") this._error = reason;
  }
  render() {
    if (!this.hass?.user?.is_admin || !this.station) return nothing;
    return html`<section aria-label=${this.t("audio_title")}>
      <h3>${this.t("audio_title")}</h3>
      <p>${this.t("audio_hint")}</p>
      <div class="buttons">
        ${
          this._state === "idle"
            ? html`<button ?disabled=${!this.station.online} @click=${() => this.start()}>
                ${this.t("audio_start")}
              </button>`
            : html` <button
                  ?disabled=${this._state !== "listening" || !window.isSecureContext}
                  aria-pressed=${this._talking}
                  @pointerdown=${(e: PointerEvent) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    void this.talk();
                  }}
                  @blur=${() => this.releaseTalk()}
                  @pointerup=${() => this.releaseTalk()}
                  @pointercancel=${() => this.releaseTalk()}
                  @lostpointercapture=${() => {
                    if (this.pressed) this.releaseTalk();
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if ([" ", "Enter"].includes(e.key)) {
                      e.preventDefault();
                      if (!e.repeat) void this.talk();
                    }
                  }}
                  @keyup=${(e: KeyboardEvent) => {
                    if ([" ", "Enter"].includes(e.key)) {
                      e.preventDefault();
                      this.releaseTalk();
                    }
                  }}
                >
                  ${this.t(this._micPending ? "audio_microphone_wait" : this._talking ? "audio_talking" : "audio_push_to_talk")}
                </button>
                <button @click=${() => this.stop()}>${this.t("audio_stop")}</button>`
        }
      </div>
      <p role="status">${this.t("audio_state_" + this._state)}</p>
      ${!window.isSecureContext ? html`<p>${this.t("audio_https_required")}</p>` : nothing}
      ${this._error ? html`<p class="error" role="alert">${this.t(this._error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-intercom-audio-controls", IntercomAudioControls);
