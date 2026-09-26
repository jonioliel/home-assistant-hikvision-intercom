import "./microphone-input";
import "./tts-controls";
import { icon } from "./icons";
import type { MicrophoneInput } from "./microphone-input";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { downloadText } from "./download";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";
import type { MediaPolicy } from "./media-settings";
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
    :host([dock]) {
      margin: 0;
    }
    :host([dock]) section {
      border: 0;
      padding: 12px 4px;
      display: flex;
      flex-direction: column;
      align-items: stretch;
    }
    :host([dock]) .buttons {
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    :host([dock]) .session-buttons {
      order: -2;
    }
    :host([dock]) .session-buttons > button {
      min-width: 56px;
      min-height: 56px;
      padding: 6px;
      border: 0;
      border-radius: 28px;
      background: #edf0f7;
      color: #27334b;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 6px;
      font-size: 12px;
    }
    :host([dock]) .session-buttons > button[aria-pressed="true"] {
      background: #2869ee;
      color: white;
    }
    :host([dock]) .session-status {
      order: -3;
      text-align: center;
      min-height: 18px;
    }
    :host([dock]) .session-status.talking {
      color: #2869ee;
      font-weight: 600;
    }
    .microphone-level {
      order: -3;
      width: 90px;
      align-self: center;
      height: 8px;
      margin-bottom: 8px;
      accent-color: #2869ee;
    }
    :host([v4][dock]) section {
      padding: 8px 0;
    }
    :host([v4][dock]) .session-buttons {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    :host([v4][dock]) .session-buttons > button {
      min-width: 0;
      min-height: 42px;
      padding: 8px 12px;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
      flex-direction: row;
      font-size: 13px;
    }
    :host([v4][dock]) .session-buttons > button[aria-pressed="true"] {
      background: var(--primary-color);
      border-color: var(--primary-color);
      color: var(--text-primary-color);
    }
    :host([v4][dock]) .session-status.talking {
      color: var(--primary-color);
    }
    :host([v4][dock]) .microphone-level {
      accent-color: var(--primary-color);
    }
    :host([dock]) .audio-options {
      margin-top: 12px;
      font-size: 12px;
    }
    :host([dock]) .audio-options > summary {
      text-align: center;
      color: var(--secondary-text-color);
    }
    ::slotted(*) {
      flex: 0 1 auto;
    }
    button:focus-visible,
    summary:focus-visible {
      outline: 3px solid #5675e8;
      outline-offset: 3px;
    }
    @media (max-width: 600px) {
      :host([dock]) .buttons {
        flex-wrap: nowrap;
        gap: 6px;
      }
      :host([dock]) .session-buttons > button {
        font-size: 11px;
      }
    }
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
    dl {
      margin: 8px 0;
      font-size: 13px;
    }
    dl div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 5px 0;
    }
    dt {
      color: var(--secondary-text-color);
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    summary {
      cursor: pointer;
      padding-block: 8px;
    }
    .talk-button {
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      touch-action: none;
    }
    .error {
      color: var(--error-color, #b32b25);
    }
  `;
  static properties = {
    dock: { type: Boolean, reflect: true },
    hideTts: { type: Boolean },
    v4: { type: Boolean, reflect: true },
    talkMode: { attribute: false },
    ttsSettings: { attribute: false },
    hass: { attribute: false },
    station: { attribute: false },
    _state: { state: true },
    _error: { state: true },
    _talking: { state: true },
    _micPending: { state: true },
    _acknowledged: { state: true },
    _signal: { state: true },
    _peakSignal: { state: true },
    _receivedSignal: { state: true },
    _receivedPeakSignal: { state: true },
    _diagnosticsOpen: { state: true },
    _diagnosticLoading: { state: true },
    _diagnosticError: { state: true },
    lastBackend: { state: true },
    backendSampledAt: { state: true },
    _haConnected: { state: true },
  };
  dock = false;
  hideTts = false;
  v4 = false;
  talkMode: "ptt" | "toggle" = "ptt";
  ttsSettings?: MediaPolicy | null;
  hass?: Hass;
  station?: Station;
  private _state = "idle";
  private _error = "";
  private _talking = false;
  private _micPending = false;
  private _acknowledged = 0;
  private _signal = 0;
  private _peakSignal = 0;
  private _receivedSignal = 0;
  private _receivedPeakSignal = 0;
  private _diagnosticsOpen = false;
  private _diagnosticLoading = false;
  private _diagnosticError = false;
  private diagnosticEpoch = -1;
  private lastDiagnosticPoll = 0;
  private backendSampledAt: string | null = null;
  private captured = 0;
  private dropped = 0;
  private received = 0;
  private microphoneStage = "not_requested";
  private contextState = "not_started";
  private sampleRate = 0;
  private startedAt: string | null = null;
  private lastBackend: Record<string, unknown> | null = null;
  private epoch = 0;
  private micEpoch = 0;
  private context?: AudioContext;
  private connection?: Hass["connection"];
  private observedConnection?: Hass["connection"];
  private activeStationId = "";
  private _haConnected = true;
  private haReady = () => {
    this._haConnected = true;
  };
  private bindConnection(connection?: Hass["connection"]) {
    this.observedConnection?.removeEventListener?.("disconnected", this.disconnected);
    this.observedConnection?.removeEventListener?.("ready", this.haReady);
    this.observedConnection = connection;
    this._haConnected = connection?.connected !== false;
    connection?.addEventListener?.("disconnected", this.disconnected);
    connection?.addEventListener?.("ready", this.haReady);
  }
  private openingTimeout?: ReturnType<typeof setTimeout>;
  private disconnected = () => {
    this._haConnected = false;
    this.stop("audio_connection_lost");
  };
  private token = "";
  private unsubscribe?: () => void;
  private stream?: MediaStream;
  private microphone?: MediaStreamAudioSourceNode;
  private processor?: AudioWorkletNode;
  private workletLoaded = false;
  private selectedMicrophone = "";
  private pressed = false;
  private sequence = 0;
  private sending = false;
  private nextPlayback = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private pendingRequests = new Set<() => void>();
  private cameraStreamPlayback = false;
  private cameraAudioAvailable = false;
  private backendTalkOnly = false;
  private backendOpening?: Promise<boolean>;
  private backendGeneration = 0;
  private audioStateChanged = () => {
    if (
      this._state === "listening" &&
      !this.cameraStreamPlayback &&
      this.context?.state !== "running"
    )
      this.stop("audio_playback_interrupted");
  };
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private cameraPlayback(enabled: boolean) {
    const detail: { enabled: boolean; available?: boolean } = { enabled };
    this.dispatchEvent(
      new CustomEvent("hikvision-playback-audio", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
    return detail.available === true;
  }
  private onVisibility = () => {
    if (document.hidden) this.stop();
  };
  private onWindowBlur = () => {
    if (this.talkMode === "ptt") this.releaseTalk();
  };
  private onPageHide = () => this.stop();
  private onCallEnding = (event: Event) => {
    if ((event as CustomEvent<{ station: string }>).detail?.station === this.station?.id)
      this.stop();
  };
  connectedCallback() {
    super.connectedCallback();
    this.bindConnection(this.hass?.user?.is_admin ? this.hass.connection : undefined);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("hikvision-call-ending", this.onCallEnding);
    window.addEventListener("blur", this.onWindowBlur);
  }
  disconnectedCallback() {
    this.stop();
    this.bindConnection(undefined);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("hikvision-call-ending", this.onCallEnding);
    window.removeEventListener("blur", this.onWindowBlur);
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    if (changed.has("talkMode")) this.releaseTalk();
    if (
      changed.has("station") &&
      (changed.get("station") as Station | undefined)?.id !== this.station?.id
    ) {
      this.lastBackend = null;
      this.backendSampledAt = null;
      this._peakSignal = 0;
      this._receivedSignal = 0;
      this._receivedPeakSignal = 0;
    }
    const connection = this.hass?.user?.is_admin ? this.hass.connection : undefined;
    if (this.observedConnection !== connection) this.bindConnection(connection);
    if (
      this._state !== "idle" &&
      (!this.hass?.user?.is_admin ||
        !this._haConnected ||
        this.hass.connection !== this.connection ||
        !this.station?.online ||
        (changed.has("station") &&
          (changed.get("station") as Station | undefined)?.id !== this.station.id))
    )
      this.stop();
  }
  private valid(epoch: number) {
    return (
      this.isConnected &&
      epoch === this.epoch &&
      !!this.hass?.user?.is_admin &&
      !document.hidden &&
      this._haConnected &&
      this.connection?.connected !== false &&
      this.hass.connection === this.connection &&
      !!this.station?.online &&
      this.station.id === this.activeStationId
    );
  }
  private async start() {
    this.renderRoot.querySelector<MicrophoneInput>("wiskey-microphone-input")?.stopTest();
    if (
      this._state !== "idle" ||
      !this.hass?.user?.is_admin ||
      !this.station?.online ||
      !this._haConnected ||
      this.hass.connection.connected === false ||
      document.hidden
    )
      return;
    this.cameraAudioAvailable = this.cameraPlayback(true);
    this.cameraStreamPlayback = this.cameraAudioAvailable;
    const epoch = ++this.epoch,
      hass = this.hass;
    this._state = "opening";
    this.connection = hass.connection;
    this.activeStationId = this.station.id;
    this._error = "";
    this.sequence = 0;
    this._acknowledged = this._signal = this.captured = this.dropped = this.received = 0;
    this.microphoneStage = "not_requested";
    this.lastBackend = null;
    this.backendSampledAt = null;
    this._peakSignal = 0;
    this._receivedSignal = 0;
    this._receivedPeakSignal = 0;
    this._diagnosticError = false;
    this._diagnosticLoading = false;
    this.startedAt = new Date().toISOString();
    if (this.cameraAudioAvailable) {
      this._state = "listening";
      return;
    }
    try {
      const context = await this.ensureAudioContext(epoch);
      await this.openBackend(epoch, context, true);
    } catch (error) {
      if (this.valid(epoch)) this.stop(this.errorCode(error));
    }
  }
  private async ensureAudioContext(epoch: number) {
    let context = this.context;
    if (!context || context.state === "closed") {
      context = new AudioContext({ sampleRate: 8000 });
      this.context = context;
      this.sampleRate = context.sampleRate;
      context.addEventListener("statechange", this.audioStateChanged);
    }
    if (context.sampleRate !== 8000) throw new Error("unsupported");
    if (context.state !== "running") await context.resume();
    if (!this.valid(epoch) || this.context !== context) throw new Error("audio_connection_lost");
    return context;
  }
  private async openBackend(
    epoch: number,
    context: AudioContext,
    receivePlayback: boolean,
  ): Promise<boolean> {
    if (this.token) return true;
    if (this.backendOpening) return this.backendOpening;
    const generation = ++this.backendGeneration;
    this.backendTalkOnly = !receivePlayback;
    this._state = "opening";
    let resolveReady!: (value: boolean) => void;
    let rejectReady!: (reason: unknown) => void;
    let settled = false;
    const ready = new Promise<boolean>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.backendOpening = ready;
    const settle = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(this.openingTimeout);
      this.openingTimeout = undefined;
      if (ok) resolveReady(true);
      else
        rejectReady(Object.assign(new Error(reason ?? "audio_connection_lost"), { code: reason }));
    };
    this.openingTimeout = setTimeout(() => {
      if (this.valid(epoch) && generation === this.backendGeneration) {
        settle(false, "audio_connection_lost");
        this.stop("audio_connection_lost");
      }
    }, 25000);
    try {
      const unsubscribe = await this.hass!.connection.subscribeMessage<AudioEvent>(
        (event) => {
          if (!this.valid(epoch) || generation !== this.backendGeneration) return;
          if (event.state === "closed") {
            const reason =
              event.close_confirmed === false ? "audio_close_unconfirmed" : event.reason;
            settle(false, reason);
            this.stop(reason);
          } else if (event.token && event.sample_rate === 8000 && event.packet_bytes === 800) {
            if (context.state !== "running") {
              settle(false, "audio_playback_interrupted");
              this.stop("audio_playback_interrupted");
              return;
            }
            this.token = event.token;
            this._state = "listening";
            settle(true);
            if (receivePlayback) void this.receive(epoch);
            if (this._diagnosticsOpen) void this.refreshDiagnostics();
          } else {
            settle(false, "audio_unsupported");
            this.stop("audio_unsupported");
          }
        },
        { type: "hikvision_intercom/audio/start", station_id: this.activeStationId },
        {
          resubscribe: false,
          preCheck: () =>
            this.valid(epoch) && generation === this.backendGeneration && this.context === context,
        },
      );
      if (this.valid(epoch) && generation === this.backendGeneration)
        this.unsubscribe = unsubscribe;
      else {
        this.cancelSubscription(unsubscribe);
        settle(false, "audio_connection_lost");
      }
      return await ready;
    } catch (error) {
      settle(false, this.errorCode(error));
      throw error;
    } finally {
      if (this.backendOpening === ready) this.backendOpening = undefined;
    }
  }
  private closeBackend() {
    this.backendGeneration++;
    clearTimeout(this.openingTimeout);
    this.openingTimeout = undefined;
    this.token = "";
    this.backendOpening = undefined;
    this.backendTalkOnly = false;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (unsubscribe) this.cancelSubscription(unsubscribe);
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
        this.received++;
        let energy = 0;
        for (let i = 0; i < packet.length; i++) energy += decodeMuLaw(packet.charCodeAt(i)) ** 2;
        this._receivedSignal = Math.min(100, Math.round(Math.sqrt(energy / packet.length) * 100));
        this._receivedPeakSignal = Math.max(this._receivedPeakSignal, this._receivedSignal);
        if (!this._talking && !this.cameraStreamPlayback) this.play(packet);
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
    this.renderRoot.querySelector<MicrophoneInput>("wiskey-microphone-input")?.stopTest();
    this.pressed = true;
    this._micPending = true;
    this._error = "";
    const epoch = this.epoch,
      micEpoch = ++this.micEpoch;
    try {
      const context = await this.ensureAudioContext(epoch);
      if (this.cameraAudioAvailable) {
        this.cameraPlayback(false);
        this.cameraStreamPlayback = false;
      }
      await this.openBackend(epoch, context, false);
      if (!this.valid(epoch) || !this.pressed || micEpoch !== this.micEpoch) {
        if (this.backendTalkOnly) this.closeBackend();
        if (this.valid(epoch) && this.cameraAudioAvailable)
          this.cameraStreamPlayback = this.cameraPlayback(true);
        return;
      }
      this.microphoneStage = "permission";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.selectedMicrophone ? { exact: this.selectedMicrophone } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!this.valid(epoch) || !this.pressed || micEpoch !== this.micEpoch) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.microphoneStage = "processor";
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
      this.microphoneStage = "capturing";
      stream
        .getAudioTracks()
        .forEach((track) =>
          track.addEventListener("ended", () => this.releaseTalk(), { once: true }),
        );
    } catch (error) {
      if (this.valid(epoch) && micEpoch === this.micEpoch) {
        const stage = this.microphoneStage;
        const name = (error as { name?: string }).name;
        this.releaseTalk();
        this.microphoneStage = stage + "_failed";
        this._error =
          stage === "processor"
            ? "audio_worklet_failed"
            : name === "NotAllowedError" || name === "SecurityError"
              ? "audio_microphone_denied"
              : name === "OverconstrainedError" ||
                  (name === "NotFoundError" && !!this.selectedMicrophone)
                ? "mic_selection_unavailable"
                : name === "NotFoundError"
                  ? "audio_microphone_missing"
                  : name === "NotReadableError"
                    ? "audio_microphone_busy"
                    : "audio_microphone_failed";
      }
    } finally {
      if (this.valid(epoch) && micEpoch === this.micEpoch) this._micPending = false;
    }
  }
  private async send(packet: Uint8Array, epoch: number) {
    if (packet.length !== 800 || !this.token) return;
    this.captured++;
    let energy = 0;
    for (const byte of packet) energy += decodeMuLaw(byte) ** 2;
    this._signal = Math.min(100, Math.round(Math.sqrt(energy / packet.length) * 100));
    this._peakSignal = Math.max(this._peakSignal, this._signal);
    if (this.sending) {
      this.dropped++;
      return;
    }
    this.sending = true;
    try {
      const data = btoa(String.fromCharCode(...packet));
      const result = await this.request<{ sequence: number }>({
        type: "hikvision_intercom/audio/send",
        token: this.token,
        sequence: this.sequence,
        data,
      });
      if (this.valid(epoch)) {
        if (result.sequence !== this.sequence + 1) throw Error("audio_invalid_packet");
        this.sequence = result.sequence;
        this._acknowledged++;
        if (this._diagnosticsOpen && performance.now() - this.lastDiagnosticPoll >= 2000)
          void this.refreshDiagnostics();
      }
    } catch {
      if (this.valid(epoch)) this.stop("audio_connection_lost");
    } finally {
      if (this.valid(epoch)) this.sending = false;
    }
  }
  private releaseTalk() {
    const epoch = this.epoch;
    this.pressed = false;
    this.micEpoch++;
    this._micPending = false;
    this._talking = false;
    this._signal = 0;
    if (this.microphoneStage === "capturing") this.microphoneStage = "released";
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
    const restoreCamera = () => {
      if (this.valid(epoch) && this.cameraAudioAvailable) {
        this._state = "listening";
        this.cameraStreamPlayback = this.cameraPlayback(true);
      }
    };
    if (this.backendTalkOnly) {
      const finish = () => {
        this.closeBackend();
        restoreCamera();
      };
      if (this.token) {
        void this.request({ type: "hikvision_intercom/audio/mute", token: this.token })
          .then(() => {
            if (this.valid(epoch) && this._diagnosticsOpen) void this.refreshDiagnostics();
          })
          .catch(() => undefined)
          .finally(finish);
      } else {
        this.closeBackend();
        restoreCamera();
      }
    } else if (this.token) {
      void this.request({ type: "hikvision_intercom/audio/mute", token: this.token })
        .then(() => {
          if (this.valid(epoch) && this._diagnosticsOpen) void this.refreshDiagnostics();
        })
        .catch(() => {
          if (this.valid(epoch)) this.stop("audio_connection_lost");
        });
    } else restoreCamera();
  }
  private cancelSubscription(unsubscribe: () => void) {
    try {
      void Promise.resolve(unsubscribe()).catch(() => undefined);
    } catch {
      /* The connection may already be closed. */
    }
  }
  private stop(reason?: string) {
    this.cameraPlayback(false);
    this.cameraStreamPlayback = false;
    this.cameraAudioAvailable = false;
    this.renderRoot.querySelector<MicrophoneInput>("wiskey-microphone-input")?.stopTest();
    this.epoch++;
    this._diagnosticLoading = false;
    this.connection = undefined;
    this.activeStationId = "";
    this.releaseTalk();
    this.closeBackend();
    this.clearPlayback();
    for (const cancel of this.pendingRequests) cancel();
    this.contextState = this.context?.state ?? this.contextState;
    this.context?.removeEventListener("statechange", this.audioStateChanged);
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.workletLoaded = false;
    this.sending = false;
    this._state = "idle";
    if (reason && reason !== "audio_stopped") this._error = reason;
  }
  private async refreshDiagnostics() {
    const epoch = this.epoch;
    if (!this.token || !this.valid(epoch) || this.diagnosticEpoch === epoch) return;
    this.diagnosticEpoch = epoch;
    this._diagnosticLoading = true;
    this.lastDiagnosticPoll = performance.now();
    try {
      const result = await this.request<Record<string, unknown>>({
        type: "hikvision_intercom/audio/diagnostics",
        token: this.token,
      });
      if (!this.valid(epoch)) return;
      this.lastBackend = Object.fromEntries(
        [
          "microphone_packets_accepted",
          "microphone_bytes_written",
          "microphone_signal_bytes_written",
          "total_bytes_written",
          "received_bytes",
          "received_signal_bytes",
          "dropped_receive_packets",
          "upload_http_status",
        ]
          .filter(
            (key) =>
              typeof result[key] === "number" &&
              Number.isFinite(result[key]) &&
              (result[key] as number) >= 0,
          )
          .map((key) => [key, result[key]]),
      );
      this.backendSampledAt = new Date().toISOString();
      this._diagnosticError = false;
    } catch {
      if (this.valid(epoch)) this._diagnosticError = true;
    } finally {
      if (this.diagnosticEpoch === epoch) this.diagnosticEpoch = -1;
      if (this.epoch === epoch) this._diagnosticLoading = false;
    }
  }
  private async exportDiagnostics() {
    if (!this.hass?.user?.is_admin || !this.isConnected) return;
    const epoch = this.epoch,
      user = this.hass.user,
      connection = this.hass.connection;
    if (this.token) await this.refreshDiagnostics();
    if (
      epoch !== this.epoch ||
      this.hass?.user !== user ||
      !user.is_admin ||
      this.hass.connection !== connection ||
      !this.isConnected
    )
      return;
    downloadText(
      JSON.stringify(
        {
          format: "hikvision_intercom.audio_diagnostics",
          schema: 1,
          generated_at: new Date().toISOString(),
          started_at: this.startedAt,
          path: "browser_ha_isapi",
          playback_source: this.cameraStreamPlayback ? "camera_stream" : "isapi",
          secure_context: window.isSecureContext,
          microphone_api: !!navigator.mediaDevices?.getUserMedia,
          state: this._state,
          microphone_stage: this.microphoneStage,
          audio_context: this.context?.state ?? this.contextState,
          sample_rate: this.sampleRate,
          microphone_packets_captured: this.captured,
          microphone_packets_acknowledged: this._acknowledged,
          microphone_packets_dropped_busy: this.dropped,
          microphone_signal_percent: this._signal,
          microphone_peak_percent: this._peakSignal,
          station_signal_percent: this._receivedSignal,
          station_peak_percent: this._receivedPeakSignal,
          backend_sampled_at: this.backendSampledAt,
          backend_refresh_failed: this._diagnosticError,
          receive_packets: this.received,
          backend: this.lastBackend,
          error: this._error || null,
          physical_audibility: "unverified",
          recording_saved: false,
        },
        null,
        2,
      ),
      "wiskey-audio-diagnostics.json",
      "application/json",
    );
  }
  render() {
    if (!this.hass?.user?.is_admin || !this.station) return nothing;
    return html`<section aria-label=${this.t("audio_title")}>
      ${this.dock ? nothing : html`<h3>${this.t("audio_title")}</h3>`}
      <details class="audio-options" ?open=${!this.dock}>
        <summary>${this.t("camera_audio_options")}</summary>
        <p>${this.t(this.talkMode === "toggle" ? "audio_toggle_hint" : "audio_hint")}</p>
        <wiskey-microphone-input
          .hass=${this.hass}
          .locked=${this._talking || this._micPending}
          .testingAllowed=${this._state === "idle"}
          @microphone-selected=${(e: CustomEvent<{ deviceId: string }>) => {
            this.releaseTalk();
            this.selectedMicrophone = e.detail.deviceId;
            this._error = "";
          }}
        ></wiskey-microphone-input>
        <details
          .open=${this._diagnosticsOpen}
          @toggle=${(event: Event) => {
            this._diagnosticsOpen = (event.currentTarget as HTMLDetailsElement).open;
            if (this._diagnosticsOpen) void this.refreshDiagnostics();
          }}
        >
          <summary>${this.t("audio_diagnostics_title")}</summary>
          <p>${this.t("audio_path_hint")}</p>
          <dl>
            <div>
              <dt>${this.t("audio_signal")}</dt>
              <dd>${this._signal}%</dd>
            </div>
            <div>
              <dt>${this.t("audio_peak")}</dt>
              <dd data-testid="audio-peak">${this._peakSignal}%</dd>
            </div>
            <div>
              <dt>${this.t("audio_packets")}</dt>
              <dd>${this._acknowledged}</dd>
            </div>
            <div>
              <dt>${this.t("audio_received_signal")}</dt>
              <dd data-testid="audio-received-signal">${this._receivedSignal}%</dd>
            </div>
            <div>
              <dt>${this.t("audio_received_peak")}</dt>
              <dd data-testid="audio-received-peak">${this._receivedPeakSignal}%</dd>
            </div>
            <div>
              <dt>${this.t("audio_written")}</dt>
              <dd data-testid="audio-written">
                ${this.lastBackend?.microphone_bytes_written ?? "—"}
              </dd>
            </div>
            <div>
              <dt>${this.t("audio_microphone_signal_written")}</dt>
              <dd data-testid="audio-signal-written">
                ${this.lastBackend?.microphone_signal_bytes_written ?? "—"}
              </dd>
            </div>
            <div>
              <dt>${this.t("audio_received_signal_bytes")}</dt>
              <dd data-testid="audio-received-signal-bytes">
                ${this.lastBackend?.received_signal_bytes ?? "—"}
              </dd>
            </div>
            <div>
              <dt>${this.t("audio_upload")}</dt>
              <dd data-testid="audio-upload">${this.lastBackend?.upload_http_status ?? "—"}</dd>
            </div>
          </dl>
          <p>${this.t("audio_sample_hint")}</p>
          ${this.backendSampledAt ? html`<p>${this.t("audio_sample_time")}: <time datetime=${this.backendSampledAt}>${new Date(this.backendSampledAt).toLocaleTimeString(this.hass?.language)}</time></p>` : nothing}
          ${this._diagnosticError ? html`<p role="status">${this.t("audio_diagnostics_failed")}</p>` : nothing}
          <p>${this.t("audio_speaker_unverified")}</p>
          <div class="buttons">
            <button
              ?disabled=${!this.token || this._diagnosticLoading}
              @click=${() => this.refreshDiagnostics()}
            >
              ${this.t("audio_refresh_diagnostics")}
            </button>
            <button ?disabled=${this._diagnosticLoading} @click=${() => this.exportDiagnostics()}>
              ${this.t("audio_diagnostics")}
            </button>
          </div>
        </details>
      </details>
      <div class="buttons session-buttons">
        ${
          this._state === "idle"
            ? html`<button
                ?disabled=${!this.station.online || !this._haConnected || this.hass.connection.connected === false}
                @click=${() => this.start()}
              >
                ${this.dock ? icon("speaker") : nothing}${this.t("audio_start")}
              </button>`
            : html` <button
                  ?disabled=${this._state !== "listening" || !window.isSecureContext}
                  class="talk-button"
                  aria-pressed=${this._talking}
                  @contextmenu=${(e: Event) => e.preventDefault()}
                  @click=${() => {
                    if (this.talkMode === "toggle") {
                      if (this.pressed || this._micPending) this.releaseTalk();
                      else void this.talk();
                    }
                  }}
                  @pointerdown=${(e: PointerEvent) => {
                    if (this.talkMode === "toggle") return;
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    void this.talk();
                  }}
                  @blur=${() => {
                    if (this.talkMode === "ptt") this.releaseTalk();
                  }}
                  @pointerup=${() => {
                    if (this.talkMode === "ptt") this.releaseTalk();
                  }}
                  @pointercancel=${() => {
                    if (this.talkMode === "ptt") this.releaseTalk();
                  }}
                  @lostpointercapture=${() => {
                    if (this.talkMode === "ptt" && this.pressed) this.releaseTalk();
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (this.talkMode === "ptt" && [" ", "Enter"].includes(e.key)) {
                      e.preventDefault();
                      if (!e.repeat) void this.talk();
                    }
                  }}
                  @keyup=${(e: KeyboardEvent) => {
                    if (this.talkMode === "ptt" && [" ", "Enter"].includes(e.key)) {
                      e.preventDefault();
                      this.releaseTalk();
                    }
                  }}
                >
                  ${this.dock ? icon("microphone") : nothing}${this.t(this._micPending ? "audio_microphone_wait" : this.talkMode === "toggle" ? (this._talking ? "audio_end_talk" : "audio_begin_talk") : this._talking ? "audio_talking" : "audio_push_to_talk")}
                </button>
                <button @click=${() => this.stop()}>
                  ${this.dock ? icon("speaker") : nothing}${this.t("audio_stop")}
                </button>`
        }
        <slot></slot>
      </div>
      <p class="session-status ${this._talking ? "talking" : ""}" role="status">
        ${this.t(this._talking ? "camera_microphone_active" : "audio_state_" + this._state)}${this._state === "listening" && this.cameraStreamPlayback ? ` · ${this.t("audio_playback_camera")}` : ""}${
          this._state === "listening" && !this._talking
            ? ` · ${this.t("audio_received_signal")}: ${this._receivedSignal}%`
            : ""
        }
      </p>
      ${this.dock && this._talking ? html`<meter class="microphone-level" min="0" max="100" .value=${this._signal} aria-label=${this.t("audio_signal")}></meter>` : nothing}
      ${!window.isSecureContext ? html`<p>${this.t("audio_https_required")}</p>` : nothing}
      ${this._error ? html`<p class="error" role="alert">${this.t(this._error)}</p>` : nothing}
      ${this.dock && !this.hideTts ? html`<wiskey-intercom-tts compact .hass=${this.hass} .station=${this.station} .settings=${this.ttsSettings}></wiskey-intercom-tts>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-intercom-audio-controls", IntercomAudioControls);
