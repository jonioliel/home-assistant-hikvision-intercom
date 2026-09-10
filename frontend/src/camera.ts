import { LitElement, html, css, type PropertyValues } from "lit";
import Hls from "hls.js";
import { CameraMSE } from "./camera-mse";
import { DEFAULT_MEDIA, type MediaPolicy } from "./media-settings";
import { CameraRTC } from "./camera-rtc";
import { translate } from "./i18n";
import { downloadText } from "./download";
import type { Hass } from "./types";

/** Images and HLS are obtained exclusively from authenticated Home Assistant camera APIs. */
export class IntercomCamera extends LitElement {
  static properties = {
    hass: { attribute: false },
    entity: { type: String },
    stationId: { type: String },
    media: { attribute: false },
    live: { type: Boolean },
    label: { type: String },
    _tick: { state: true },
    _visible: { state: true },
    _failed: { state: true },
    _mode: { state: true },
    _fallback: { state: true },
    _fallbackReason: { state: true },
    _documentVisible: { state: true },
    _networkOnline: { state: true },
    _haConnected: { state: true },
    version: { type: String },
  };
  hass?: Hass;
  version = "";
  private _documentVisible = !document.hidden;
  private _networkOnline = navigator.onLine;
  private _haConnected = true;
  private haDisconnected = () => {
    this._haConnected = false;
    this.stop();
  };
  private haReady = () => {
    this._haConnected = true;
  };
  private _fallbackReason = "";
  private startTimer?: ReturnType<typeof setTimeout>;
  private firstFrameAt: string | null = null;
  private startedAt: string | null = null;
  private previousRTC?: Record<string, unknown>;
  private visibility = () => {
    this._documentVisible = !document.hidden;
  };
  private online = () => {
    this._networkOnline = navigator.onLine;
  };
  private connection?: Hass["connection"];
  entity = "";
  stationId = "";
  media?: MediaPolicy | null;
  private policyKey = "";
  private mse?: CameraMSE;
  private previousMSE?: Record<string, unknown>;
  private activeTransport = "";
  live = false;
  label = "";
  private _tick = 0;
  private _visible = false;
  private _failed = false;
  private observer?: IntersectionObserver;
  private timer?: ReturnType<typeof setInterval>;
  private player?: Hls;
  private rtc?: CameraRTC;
  private _mode = "player_connecting";
  private _fallback = false;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private generation = 0;
  static styles = css`
    :host {
      display: block;
      position: relative;
      background: #172a2d;
      aspect-ratio: 16/9;
      border-radius: 12px;
      overflow: hidden;
    }
    img,
    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .player-status {
      position: absolute;
      inset-block-start: 4px;
      inset-inline-start: 4px;
      padding: 4px 8px;
      background: #172a2de8;
      color: white;
      font-size: 12px;
      pointer-events: none;
      max-width: 60%;
    }
    .playback-export {
      position: absolute;
      inset-block-start: 4px;
      inset-inline-end: 4px;
      padding: 4px 8px;
      font: inherit;
      font-size: 12px;
    }
    button {
      font: inherit;
      border: 1px solid #ffffff60;
      border-radius: 8px;
      background: #18383e;
      color: #fff;
      min-height: 36px;
      cursor: pointer;
    }
    .player-error {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px;
      color: #edf6f6;
      text-align: center;
      overflow: auto;
    }
    .player-error p {
      height: auto;
      display: block;
      font-size: 14px;
    }
    .player-error small {
      max-width: 45ch;
    }
    .player-error .actions {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .player-error button {
      padding: 8px 12px;
    }
    .player-error .playback-export {
      position: static;
    }
    p {
      height: 100%;
      margin: 0;
      display: grid;
      place-items: center;
      color: #edf6f6;
      font: inherit;
      text-align: center;
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    this.visibility();
    this.online();
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("online", this.online);
    window.addEventListener("offline", this.online);
    this.observer = new IntersectionObserver((entries) => {
      this._visible = entries.some((item) => item.isIntersecting);
      if (this._visible) this._tick = Date.now();
    });
    this.observer.observe(this);
    this.timer = setInterval(() => {
      if (this._visible && !document.hidden) this._tick = Date.now();
    }, 10000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.observer?.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("online", this.online);
    window.removeEventListener("offline", this.online);
    clearInterval(this.timer);
    this.bindConnection(undefined);
    this.stop();
  }
  private bindConnection(connection?: Hass["connection"]) {
    this.connection?.removeEventListener?.("disconnected", this.haDisconnected);
    this.connection?.removeEventListener?.("ready", this.haReady);
    this.connection = connection;
    this._haConnected = connection?.connected !== false;
    connection?.addEventListener?.("disconnected", this.haDisconnected);
    connection?.addEventListener?.("ready", this.haReady);
  }
  private stop() {
    this.generation++;
    clearTimeout(this.startTimer);
    this.rtc?.close();
    this.rtc = undefined;
    this.mse?.close();
    this.mse = undefined;
    this.player?.destroy();
    this.player = undefined;
    const video = this.renderRoot.querySelector("video");
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }
  }
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    if (changed.has("_tick") && this._failed && !this.live) this._failed = false;
    if (!this.hass?.user?.is_admin) {
      this.bindConnection(undefined);
      this.stop();
      return;
    }
    const policy = this.media ?? DEFAULT_MEDIA;
    const policyKey = JSON.stringify([
      policy.revision,
      policy.transport,
      policy.webrtc_mode,
      policy.fallback_hls,
    ]);
    const policyChanged = this.policyKey !== policyKey;
    this.policyKey = policyKey;
    const connectionChanged = this.connection !== this.hass?.connection;
    if (connectionChanged) this.bindConnection(this.hass?.connection);
    if (
      connectionChanged ||
      policyChanged ||
      changed.has("stationId") ||
      changed.has("entity") ||
      changed.has("live") ||
      changed.has("_visible") ||
      changed.has("_documentVisible") ||
      changed.has("_networkOnline") ||
      changed.has("_haConnected")
    ) {
      this.stop();
      this._failed = false;
      if (
        this.live &&
        this._visible &&
        this.entity &&
        this._documentVisible &&
        this._networkOnline &&
        this._haConnected
      )
        void this.start();
    }
  }
  private async start() {
    const generation = this.generation;
    this._mode = "player_connecting";
    this._fallback = false;
    this._fallbackReason = "";
    this.startedAt = new Date().toISOString();
    this.firstFrameAt = null;
    this.previousRTC = undefined;
    this.previousMSE = undefined;
    const policy = this.media ?? DEFAULT_MEDIA;
    this.activeTransport = policy.transport === "hls" ? "hls" : policy.webrtc_mode;
    const current = () =>
      generation === this.generation &&
      this.isConnected &&
      !!this.hass?.user?.is_admin &&
      this._documentVisible &&
      this._networkOnline &&
      this._haConnected;
    let fallbackStarted = false;
    const fallback = (reason: string) => {
      if (current() && !fallbackStarted) {
        fallbackStarted = true;
        clearTimeout(this.startTimer);
        this.previousRTC = this.rtc?.summary();
        this.rtc?.close();
        this.rtc = undefined;
        this.previousMSE = this.mse?.summary();
        this.mse?.close();
        this.mse = undefined;
        if (!policy.fallback_hls) {
          this.failPlayer(reason);
          return;
        }
        this._fallback = true;
        this._fallbackReason = reason;
        void this.startHls();
      }
    };
    if (policy.transport === "hls") {
      void this.startHls();
      return;
    }
    if (policy.webrtc_mode === "mse") {
      await this.updateComplete;
      if (!current()) return;
      const video = this.renderRoot.querySelector("video");
      if (!video || !this.stationId) {
        fallback("mse_provider_unavailable");
        return;
      }
      this.startTimer = setTimeout(() => fallback("mse_timeout"), 16000);
      this.mse = new CameraMSE(
        this.hass!,
        this.stationId,
        video,
        () => {
          if (current()) {
            clearTimeout(this.startTimer);
            this._mode = "player_mse";
            this.firstFrameAt = new Date().toISOString();
          }
        },
        fallback,
      );
      void this.mse.start();
      return;
    }
    this.startTimer = setTimeout(() => fallback("capabilities_timeout"), 10000);
    try {
      const caps = await this.hass!.callWS<{ frontend_stream_types: string[] }>({
        type: "camera/capabilities",
        entity_id: this.entity,
      });
      if (!current() || fallbackStarted) return;
      clearTimeout(this.startTimer);
      if (!caps.frontend_stream_types?.includes("web_rtc")) {
        fallback("provider_unavailable");
        return;
      }
      if (typeof RTCPeerConnection === "undefined") {
        fallback("browser_unavailable");
        return;
      }
      await this.updateComplete;
      if (!current() || fallbackStarted) return;
      const video = this.renderRoot.querySelector("video");
      if (!video) return;
      this.rtc = new CameraRTC(
        this.hass!,
        this.entity,
        video,
        () => {
          if (current()) {
            this._mode = "player_webrtc";
            this.firstFrameAt = new Date().toISOString();
          }
        },
        fallback,
      );
      void this.rtc.start();
    } catch {
      fallback("capabilities_failed");
    }
  }
  private failPlayer(reason: string) {
    this._failed = true;
    if (!this._fallbackReason) this._fallbackReason = reason;
    this.stop();
  }
  private loaded() {
    if (this.activeTransport === "hls" && this.renderRoot.querySelector("video")?.videoWidth) {
      clearTimeout(this.startTimer);
      this._mode = "player_hls";
      this.firstFrameAt = new Date().toISOString();
    }
  }
  private async exportPlayback() {
    if (!this.hass?.user?.is_admin) return;
    const generation = this.generation;
    const rtc = this.rtc ? await this.rtc.diagnostics() : (this.previousRTC ?? null);
    if (generation !== this.generation || !this.isConnected || !this.hass?.user?.is_admin) return;
    const video = this.renderRoot.querySelector("video");
    downloadText(
      JSON.stringify(
        {
          format: "hikvision_intercom.playback",
          schema: 1,
          integration_version: this.version,
          generated_at: new Date().toISOString(),
          started_at: this.startedAt,
          first_frame_at: this.firstFrameAt,
          mode: this._mode,
          failed: this._failed,
          fallback_reason: this._fallbackReason || null,
          document_visible: this._documentVisible,
          browser_online: this._networkOnline,
          width: video?.videoWidth ?? 0,
          height: video?.videoHeight ?? 0,
          rtc,
          mse: this.mse?.summary() ?? this.previousMSE ?? null,
          selected_transport: (this.media ?? DEFAULT_MEDIA).transport,
          selected_webrtc_mode: (this.media ?? DEFAULT_MEDIA).webrtc_mode,
          fallback_allowed: (this.media ?? DEFAULT_MEDIA).fallback_hls,
          active_transport: this.activeTransport,
        },
        null,
        2,
      ),
      "hikvision-playback.json",
      "application/json",
    );
  }
  private exportButton() {
    return html`<button class="playback-export" @click=${() => this.exportPlayback()}>
      ${this.t("player_export")}
    </button>`;
  }
  private async startHls() {
    this.activeTransport = "hls";
    const generation = this.generation;
    this.startTimer = setTimeout(() => {
      if (generation === this.generation) this.failPlayer("hls_timeout");
    }, 16000);
    try {
      const response = await this.hass!.callWS<{ url: string }>({
        type: "camera/stream",
        entity_id: this.entity,
        format: "hls",
      });
      if (generation !== this.generation || !this.isConnected) return;
      const url = new URL(response.url, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith("/api/hls/"))
        throw Error("Unsupported stream endpoint");
      await this.updateComplete;
      if (generation !== this.generation || !this.isConnected || !this.hass?.user?.is_admin) return;
      const video = this.renderRoot.querySelector("video");
      if (!video) return;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url.href;
      } else if (Hls.isSupported()) {
        this.player = new Hls({ lowLatencyMode: true, maxBufferLength: 12 });
        this.player.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && generation === this.generation) this.failPlayer("hls_failed");
        });
        this.player.loadSource(url.href);
        this.player.attachMedia(video);
      } else throw Error("Unsupported video");
      void video.play().catch(() => {});
    } catch {
      if (generation === this.generation) this.failPlayer("hls_failed");
    }
  }
  render() {
    if (this.live && !this._documentVisible) return html`<p>${this.t("player_suspended")}</p>`;
    if (this.live && !this._networkOnline) return html`<p>${this.t("player_network_offline")}</p>`;
    if (this.live && !this._haConnected) return html`<p>${this.t("player_ha_disconnected")}</p>`;
    if (this.live && this._failed)
      return html`<div class="player-error" role="status">
        <p>${this.t("player_failed")}</p>
        <small>${this.t("player_reason_" + this._fallbackReason)}</small>
        <div class="actions">
          <button
            @click=${() => {
              this.stop();
              this._failed = false;
              void this.start();
            }}
          >
            ${this.t("player_retry")}</button
          >${this.exportButton()}
        </div>
      </div>`;
    if (!this.entity || !this._visible || this._failed) return html`<p>${this.label}</p>`;
    if (this.live)
      return html`<video
          controls
          autoplay
          muted
          playsinline
          aria-label=${this.label}
          @loadeddata=${() => this.loaded()}
          @error=${() => this.failPlayer("media_failed")}
        ></video
        ><span class="player-status" role="status"
          >${this.t(this._mode)}${this._fallback ? " · " + this.t("player_fallback") : ""}</span
        >${this.exportButton()}`;
    const picture = this.hass?.states[this.entity]?.attributes.entity_picture;
    let source = "";
    try {
      const url = new URL(picture, location.origin);
      if (url.origin === location.origin && url.pathname.startsWith("/api/camera_proxy/")) {
        url.searchParams.set("_intercom_preview", String(this._tick));
        source = url.href;
      }
    } catch {}
    return source
      ? html`<img
          src=${source}
          alt=${this.label}
          loading="lazy"
          @error=${() => {
            this._failed = true;
          }}
        />`
      : html`<p>${this.label}</p>`;
  }
}
customElements.define("hikvision-intercom-camera", IntercomCamera);
