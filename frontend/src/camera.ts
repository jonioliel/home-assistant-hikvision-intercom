import { LitElement, html, css, type PropertyValues } from "lit";
import Hls from "hls.js";
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
  private generation = 0;
  static styles = css`
    :host {
      display: block;
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
    this.player?.destroy();
    this.player = undefined;
    const video = this.renderRoot.querySelector("video");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }
  protected updated(changed: PropertyValues) {
    if (changed.has("_tick") && this._failed && !this.live) this._failed = false;
    if (changed.has("entity") || changed.has("live") || changed.has("_visible")) {
      this.stop();
      this._failed = false;
      if (this.live && this._visible && this.entity) void this.start();
    }
  }
  private async start() {
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
      void video.play().catch(() => {});
    } catch {
      if (generation === this.generation) this._failed = true;
    }
  }
  render() {
    if (!this.entity || !this._visible || this._failed) return html`<p>${this.label}</p>`;
    if (this.live)
      return html`<video controls autoplay muted playsinline aria-label=${this.label}></video>`;
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
