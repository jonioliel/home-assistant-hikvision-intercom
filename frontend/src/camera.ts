import { LitElement, html, css, type PropertyValues } from "lit";
import Hls from "hls.js";
import { CameraRTC } from "./camera-rtc";
import { translate } from "./i18n";
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
  };
  hass?: Hass;
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
    clearInterval(this.timer);
    this.stop();
  }
  private stop() {
    this.generation++;
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
    if (changed.has("entity") || changed.has("live") || changed.has("_visible")) {
      this.stop();
      this._failed = false;
      if (this.live && this._visible && this.entity) void this.start();
    }
  }
  private async start() {
    const generation = this.generation;
    this._mode = "player_connecting";
    this._fallback = false;
    const current = () =>
      generation === this.generation && this.isConnected && !!this.hass?.user?.is_admin;
    const fallback = () => {
      if (current()) {
        this._fallback = true;
        void this.startHls();
      }
    };
    try {
      const caps = await this.hass!.callWS<{ frontend_stream_types: string[] }>({
        type: "camera/capabilities",
        entity_id: this.entity,
      });
      if (!current()) return;
      if (
        !caps.frontend_stream_types?.includes("web_rtc") ||
        typeof RTCPeerConnection === "undefined"
      ) {
        fallback();
        return;
      }
      await this.updateComplete;
      if (!current()) return;
      const video = this.renderRoot.querySelector("video");
      if (!video) return;
      this.rtc = new CameraRTC(
        this.hass!,
        this.entity,
        video,
        () => {
          if (current()) this._mode = "player_webrtc";
        },
        fallback,
      );
      void this.rtc.start();
    } catch {
      fallback();
    }
  }
  private async startHls() {
    const generation = this.generation;
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
      const video = this.renderRoot.querySelector("video");
      if (!video) return;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url.href;
      } else if (Hls.isSupported()) {
        this.player = new Hls({ lowLatencyMode: true, maxBufferLength: 12 });
        this.player.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            this._failed = true;
            this.player?.destroy();
          }
        });
        this.player.loadSource(url.href);
        this.player.attachMedia(video);
      } else throw Error("Unsupported video");
      this._mode = "player_hls";
      void video.play().catch(() => {});
    } catch {
      if (generation === this.generation) this._failed = true;
    }
  }
  render() {
    if (this.live && this._failed)
      return html`<p>
        ${this.t("player_failed")}<button
          @click=${() => {
            this.stop();
            this._failed = false;
            void this.start();
          }}
        >
          ${this.t("player_retry")}
        </button>
      </p>`;
    if (!this.entity || !this._visible || this._failed) return html`<p>${this.label}</p>`;
    if (this.live)
      return html`<video
          controls
          autoplay
          muted
          playsinline
          aria-label=${this.label}
          @error=${() => {
            this._failed = true;
            this.stop();
          }}
        ></video
        ><span class="player-status" role="status"
          >${this.t(this._mode)}${this._fallback ? " · " + this.t("player_fallback") : ""}</span
        >`;
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
