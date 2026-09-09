import { LitElement, html, css, type PropertyValues } from "lit";
import Hls from "hls.js";
import { CameraRTC } from "./camera-rtc";
import { translate } from "./i18n";
import { downloadText } from "./download";
import type { Hass } from "./types";

/** Images and HLS are obtained exclusively from authenticated Home Assistant camera APIs. */
export class IntercomCamera extends LitElement {
  static properties = {
    hass: { attribute: false },
    entity: { type: String },
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
    version: { type: String },
  };
  hass?: Hass;
  version = "";
  private _documentVisible = !document.hidden;
  private _networkOnline = navigator.onLine;
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
    this.stop();
  }
  private stop() {
    this.generation++;
    clearTimeout(this.startTimer);
    this.rtc?.close();
    this.rtc = undefined;
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
    if (changed.has("_tick") && this._failed && !this.live) this._failed = false;
    if (changed.has("hass") && !this.hass?.user?.is_admin) {
      this.stop();
      return;
    }
    const connectionChanged = this.connection !== this.hass?.connection;
    this.connection = this.hass?.connection;
    if (
      connectionChanged ||
      changed.has("entity") ||
      changed.has("live") ||
      changed.has("_visible") ||
      changed.has("_documentVisible") ||
      changed.has("_networkOnline")
    ) {
      this.stop();
      this._failed = false;
      if (this.live && this._visible && this.entity && this._documentVisible && this._networkOnline)
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
    const current = () =>
      generation === this.generation &&
      this.isConnected &&
      !!this.hass?.user?.is_admin &&
      this._documentVisible &&
      this._networkOnline;
    let fallbackStarted = false;
    const fallback = (reason: string) => {
      if (current() && !fallbackStarted) {
        fallbackStarted = true;
        clearTimeout(this.startTimer);
        this.previousRTC = this.rtc?.summary();
        this.rtc?.close();
        this.rtc = undefined;
        this._fallback = true;
        this._fallbackReason = reason;
        void this.startHls();
      }
    };
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
    if (this._fallback && this.renderRoot.querySelector("video")?.videoWidth) {
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
