import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import type { Hass } from "./types";

export class UserPhoto extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      img,
      video {
        width: min(100%, 256px);
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: 12px;
        background: #e8edf5;
      }
      :host([compact]) {
        width: 40px;
        height: 40px;
      }
      :host([compact]) img {
        width: 40px;
        height: 40px;
        border-radius: 50%;
      }
      .row {
        flex-wrap: wrap;
      }
      .capture {
        margin-block: 12px;
        padding: 12px;
        border: 1px solid #dae0e8;
        border-radius: 12px;
      }
      button {
        min-height: 44px;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    userId: { attribute: false },
    revision: { type: Number },
    configured: { type: Boolean },
    image: { attribute: false },
    compact: { type: Boolean, reflect: true },
    saved: { state: true },
    preview: { state: true },
    capturing: { state: true },
    ready: { state: true },
    error: { state: true },
    busy: { state: true },
  };
  hass?: Hass;
  userId = "";
  configured = false;
  revision = 0;
  image?: string | null;
  compact = false;
  private saved: string | null = null;
  private preview: string | null = null;
  private capturing = false;
  private ready = false;
  private busy = false;
  private error = "";
  private actor = "";
  private key = "";
  private epoch = 0;
  private stream?: MediaStream;
  private connection?: Hass["connection"];
  private observer?: IntersectionObserver;
  private visible = false;
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private onVisibility = () => {
    if (document.hidden) this.cancel();
  };
  private disconnected = () => {
    this.cancel();
    this.saved = null;
    this.requests.cancel();
  };
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.observer = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible && this.actor && this.configured && this.saved === null)
        void this.load(this.key);
    });
    this.observer.observe(this);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.observer?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.connection?.removeEventListener?.("disconnected", this.disconnected);
    this.cancel();
    this.requests.cancel();
    this.saved = null;
  }
  protected updated(_changes: PropertyValues) {
    if (this.connection !== this.hass?.connection) {
      this.connection?.removeEventListener?.("disconnected", this.disconnected);
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.disconnected);
    }
    const actor = this.hass?.user?.is_admin ? (this.hass.user.id ?? "") : "";
    const key = `${actor}:${this.userId}:${this.configured}:${this.revision}`;
    if (actor !== this.actor || key !== this.key) {
      this.cancel();
      this.requests.cancel();
      this.saved = null;
      this.actor = actor;
      this.key = key;
      if (actor && this.userId && this.configured && this.visible) void this.load(key);
    }
  }
  private async load(key: string) {
    try {
      const result = await this.requests.run<{ photo: string | null }>(
        { type: "hikvision_intercom/users/photo_get", user_id: this.userId },
        10000,
      );
      if (
        this.isConnected &&
        this.key === key &&
        (!result.photo || result.photo.startsWith("data:image/jpeg;base64,"))
      )
        this.saved = result.photo;
    } catch {
      if (this.isConnected && !this.compact) this.error = "photo_load_failed";
    }
  }
  private stop() {
    this.epoch++;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = undefined;
    const video = this.renderRoot.querySelector("video");
    if (video) video.srcObject = null;
    this.capturing = false;
    this.ready = false;
    this.busy = false;
  }
  private cancel() {
    this.stop();
    this.preview = null;
  }
  private async start() {
    if (!this.hass?.user?.is_admin || this.busy || this.compact) return;
    this.cancel();
    this.error = "";
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.error = "photo_https";
      return;
    }
    const epoch = this.epoch;
    this.busy = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 512 }, height: { ideal: 512 } },
        audio: false,
      });
      if (
        !this.isConnected ||
        epoch !== this.epoch ||
        document.hidden ||
        !this.hass?.user?.is_admin
      ) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.capturing = true;
      this.busy = false;
      stream.getTracks().forEach((t) => {
        t.onended = () => {
          this.cancel();
          this.error = "photo_camera_failed";
        };
      });
      await this.updateComplete;
      const video = this.renderRoot.querySelector("video");
      if (video && epoch === this.epoch) {
        video.srcObject = stream;
        await video.play();
      }
    } catch {
      if (epoch === this.epoch) {
        this.cancel();
        this.error = "photo_camera_failed";
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private capture() {
    const video = this.renderRoot.querySelector("video");
    if (!video?.videoWidth || !video.videoHeight || !this.stream) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas
      .getContext("2d")!
      .drawImage(
        video,
        (video.videoWidth - size) / 2,
        (video.videoHeight - size) / 2,
        size,
        size,
        0,
        0,
        256,
        256,
      );
    let data = "";
    for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
      data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= 43715) break;
    }
    this.stop();
    if (data.length > 43715) {
      this.error = "invalid_photo";
      return;
    }
    this.preview = data;
  }
  private use(photo: string | null) {
    this.cancel();
    this.dispatchEvent(new CustomEvent("photo-changed", { detail: photo }));
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const image = this.image === undefined ? this.saved : this.image;
    if (this.compact)
      return image ? html`<img src=${image} alt="" />` : html`<span aria-hidden="true">●</span>`;
    return html`<section aria-label=${this.t("profile_photo")}>
      <h3>${this.t("profile_photo")}</h3>
      ${image ? html`<img src=${image} alt=${this.t("profile_photo")} />` : nothing}
      ${
        this.capturing
          ? html`<div class="capture">
              <video
                autoplay
                muted
                playsinline
                @loadedmetadata=${() => {
                  this.ready = true;
                }}
              ></video>
              <div class="row">
                <button type="button" ?disabled=${!this.ready} @click=${() => this.capture()}>
                  ${this.t("photo_capture")}</button
                ><button type="button" @click=${() => this.cancel()}>${this.t("cancel")}</button>
              </div>
            </div>`
          : this.preview
            ? html`<div class="capture">
                <img src=${this.preview} alt=${this.t("photo_preview")} />
                <div class="row">
                  <button type="button" class="primary" @click=${() => this.use(this.preview)}>
                    ${this.t("photo_use")}</button
                  ><button type="button" @click=${() => this.start()}>
                    ${this.t("photo_retake")}</button
                  ><button type="button" @click=${() => this.cancel()}>${this.t("cancel")}</button>
                </div>
              </div>`
            : html`<div class="row">
                <button type="button" ?disabled=${this.busy} @click=${() => this.start()}>
                  ${this.t("photo_open")}</button
                >${image || this.configured ? html`<button type="button" @click=${() => this.use(null)}>${this.t("photo_remove")}</button>` : nothing}
              </div>`
      }
      <p class="sub">${this.t("photo_save_hint")}</p>
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-user-photo", UserPhoto);
