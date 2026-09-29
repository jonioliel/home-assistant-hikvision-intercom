import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import type { Hass } from "./types";
import { PHOTO_FILE_BYTES, photoBounds, photoHeader } from "./photo-file";

export class UserPhoto extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        min-width: 0;
        height: auto;
        overflow: visible;
      }
      img,
      video {
        display: block;
        width: min(100%, 256px);
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: 12px;
        background: #e8edf5;
      }
      :host([compact]) {
        width: var(--wiskey-photo-size, 60px);
        height: var(--wiskey-photo-size, 60px);
        flex: 0 0 var(--wiskey-photo-size, 60px);
        overflow: hidden;
        line-height: 0;
      }
      :host([compact]) img {
        width: var(--wiskey-photo-size, 60px);
        height: var(--wiskey-photo-size, 60px);
        flex: 0 0 var(--wiskey-photo-size, 60px);
        overflow: hidden;
        line-height: 0;
        border-radius: 50%;
      }
      .row {
        flex-wrap: wrap;
      }
      .crop-controls {
        display: grid;
        gap: 10px;
        max-width: 400px;
        margin-block: 12px;
      }
      .crop-controls label {
        display: grid;
        gap: 4px;
      }
      .crop-controls input {
        width: 100%;
        min-height: 36px;
        accent-color: var(--accent, #407f73);
      }
      .capture {
        margin-block: 12px;
        padding: 12px;
        border: 1px solid var(--line, #dae0e8);
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
    cropping: { state: true },
    zoom: { state: true },
    cropX: { state: true },
    cropY: { state: true },
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
  private cropping = false;
  private zoom = 1;
  private cropX = 50;
  private cropY = 50;
  private source?: HTMLImageElement;
  private objectUrl = "";
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
    const connectionChanged = this.connection !== this.hass?.connection;
    if (connectionChanged) {
      this.connection?.removeEventListener?.("disconnected", this.disconnected);
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.disconnected);
    }
    const actor = this.hass?.user?.is_admin ? (this.hass.user.id ?? "") : "";
    const key = `${actor}:${this.userId}:${this.configured}:${this.revision}:${this.compact}`;
    if (actor !== this.actor || key !== this.key || connectionChanged) {
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
    this.cropping = false;
    if (this.source) this.source.src = "";
    this.source = undefined;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = "";
  }
  private allowed() {
    return (
      !!this.hass?.user?.is_admin &&
      !this.compact &&
      this.isConnected &&
      !document.hidden &&
      this.hass.connection.connected !== false
    );
  }
  private choose() {
    if (this.allowed() && !this.busy)
      (this.renderRoot.querySelector('input[type="file"]') as HTMLInputElement)?.click();
  }
  private async fileChanged(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !this.allowed()) return;
    this.cancel();
    this.error = "";
    const epoch = this.epoch;
    this.busy = true;
    let url = "";
    try {
      if (!file.size || file.size > PHOTO_FILE_BYTES) throw Error("photo_file_size");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const header = photoHeader(bytes, file.type);
      if (epoch !== this.epoch || !this.allowed()) return;
      url = URL.createObjectURL(new Blob([bytes], { type: header.mime }));
      this.objectUrl = url;
      const image = new Image();
      this.source = image;
      image.src = url;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          image.decode(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error("photo_file_invalid")), 15000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (epoch !== this.epoch || !this.allowed()) return;
      photoBounds(image.naturalWidth, image.naturalHeight);
      // Orientation can swap sides, but header and decoded pixel counts must agree.
      if (image.naturalWidth * image.naturalHeight !== header.width * header.height)
        throw Error("photo_file_invalid");
      this.zoom = 1;
      this.cropX = this.cropY = 50;
      this.cropping = true;
      this.crop();
    } catch (error) {
      if (epoch === this.epoch) {
        this.cancel();
        const code = (error as Error).message;
        this.error = ["photo_file_size", "photo_file_type", "photo_file_dimensions"].includes(code)
          ? code
          : "photo_file_invalid";
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (epoch === this.epoch) {
        this.objectUrl = "";
        this.busy = false;
      }
    }
  }
  private encode(canvas: HTMLCanvasElement) {
    let data = "";
    for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
      data = canvas.toDataURL("image/jpeg", quality);
      const base64 = data.split(",")[1] ?? "";
      const bytes =
        (base64.length * 3) / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
      if (data.length <= 43715 && bytes <= 32768) return data;
    }
    throw Error("invalid_photo");
  }
  private crop() {
    const image = this.source;
    if (!image?.naturalWidth || !this.allowed()) return;
    const size = Math.min(image.naturalWidth, image.naturalHeight) / this.zoom;
    const x = ((image.naturalWidth - size) * this.cropX) / 100;
    const y = ((image.naturalHeight - size) * this.cropY) / 100;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, x, y, size, size, 0, 0, 256, 256);
    try {
      this.preview = this.encode(canvas);
      this.error = "";
    } catch {
      this.preview = null;
      this.error = "invalid_photo";
    }
  }
  private adjust(key: "zoom" | "cropX" | "cropY", event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value) || !this.allowed()) return;
    this[key] = Math.max(key === "zoom" ? 1 : 0, Math.min(key === "zoom" ? 4 : 100, value));
    this.crop();
  }
  private cropControls() {
    return html`<div class="crop-controls">
      <label
        >${this.t("photo_zoom")}<input
          type="range"
          min="1"
          max="4"
          step="0.05"
          .value=${String(this.zoom)}
          @input=${(e: Event) => this.adjust("zoom", e)}
      /></label>
      <label
        >${this.t("photo_crop_x")}<input
          type="range"
          min="0"
          max="100"
          .value=${String(this.cropX)}
          @input=${(e: Event) => this.adjust("cropX", e)}
      /></label>
      <label
        >${this.t("photo_crop_y")}<input
          type="range"
          min="0"
          max="100"
          .value=${String(this.cropY)}
          @input=${(e: Event) => this.adjust("cropY", e)}
      /></label>
      <p class="sub">${this.t("photo_crop_hint")}</p>
    </div>`;
  }
  private async start() {
    if (!this.allowed() || this.busy) return;
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
    if (!this.allowed() || !video?.videoWidth || !video.videoHeight || !this.stream) return;
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
    try {
      const data = this.encode(canvas);
      this.stop();
      this.preview = data;
    } catch {
      this.stop();
      this.error = "invalid_photo";
    }
  }
  private use(photo: string | null) {
    if (!this.allowed()) return;
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
      <input
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        aria-label=${this.t("photo_choose_file")}
        @change=${(e: Event) => this.fileChanged(e)}
      />
      ${image ? html`<img src=${image} alt=${this.t("profile_photo")} />` : nothing}
      ${
        this.busy
          ? html`<div class="row">
              <p role="status">${this.t("loading")}</p>
              <button type="button" @click=${() => this.cancel()}>${this.t("cancel")}</button>
            </div>`
          : nothing
      }
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
                ${this.cropping ? this.cropControls() : nothing}
                <div class="row">
                  <button type="button" class="primary" @click=${() => this.use(this.preview)}>
                    ${this.t("photo_use")}</button
                  >${this.cropping ? html`<button type="button" @click=${() => this.choose()}>${this.t("photo_choose_file")}</button>` : html`<button type="button" @click=${() => this.start()}>${this.t("photo_retake")}</button>`}
                  <button type="button" @click=${() => this.cancel()}>${this.t("cancel")}</button>
                </div>
              </div>`
            : html`<div class="row">
                <button type="button" ?disabled=${this.busy} @click=${() => this.choose()}>
                  ${this.t("photo_choose_file")}
                </button>
                <button type="button" ?disabled=${this.busy} @click=${() => this.start()}>
                  ${this.t("photo_open")}</button
                >${image || this.configured ? html`<button type="button" @click=${() => this.use(null)}>${this.t("photo_remove")}</button>` : nothing}
              </div>`
      }
      <p class="sub">${this.t("photo_save_hint")}</p>
      <p class="sub">${this.t("photo_file_hint")}</p>
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-user-photo", UserPhoto);
