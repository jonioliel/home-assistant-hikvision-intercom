import { LitElement, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass } from "./types";

export interface MediaPolicy {
  revision: number;
  transport: "hls" | "webrtc";
  webrtc_mode: "rtc" | "mse";
  fallback_hls: boolean;
  go2rtc_url: string;
}
export const DEFAULT_MEDIA: MediaPolicy = {
  revision: 0,
  transport: "webrtc",
  webrtc_mode: "rtc",
  fallback_hls: true,
  go2rtc_url: "",
};
export class MediaSettingsPanel extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    notice: { state: true },
    error: { state: true },
    stale: { state: true },
  };
  hass?: Hass;
  settings?: MediaPolicy | null;
  private draft?: MediaPolicy;
  private busy = false;
  private actor?: string;
  private notice = "";
  private error = "";
  private stale = false;
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(_changed: PropertyValues) {
    if (this.actor !== this.hass?.user?.id) {
      this.requests.cancel();
      this.actor = this.hass?.user?.id;
      this.draft = undefined;
      this.error = "";
      this.notice = "";
      this.stale = false;
    }
    if (this.settings && !this.draft) this.draft = { ...this.settings };
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
  }
  private change(key: keyof MediaPolicy, value: unknown) {
    this.draft = { ...this.draft!, [key]: value };
    this.notice = "";
  }
  private async reload() {
    this.busy = true;
    this.error = "";
    try {
      this.draft = await this.requests.run<MediaPolicy>(
        { type: "hikvision_intercom/media/settings_get" },
        10000,
      );
      this.stale = false;
    } catch {
      this.error = "media_load_failed";
    } finally {
      this.busy = false;
    }
  }
  private async save() {
    if (!this.draft || this.busy || this.stale) return;
    this.busy = true;
    this.error = "";
    this.notice = "";
    const { revision, ...values } = this.draft;
    try {
      const result = await this.requests.run<MediaPolicy>(
        { type: "hikvision_intercom/media/settings_update", revision, values },
        12000,
      );
      if (!this.isConnected) return;
      this.draft = result;
      this.notice = "media_saved";
      this.dispatchEvent(new CustomEvent("media-saved", { detail: result }));
    } catch (e) {
      if (!this.isConnected) return;
      const code = (e as { code?: string }).code;
      this.stale = code !== "invalid_fields";
      this.error =
        code === "revision_conflict"
          ? "media_conflict"
          : code === "invalid_fields"
            ? "media_invalid"
            : "media_save_unknown";
    } finally {
      this.busy = false;
    }
  }
  private async check() {
    this.busy = true;
    this.error = "";
    this.notice = "";
    try {
      await this.requests.run({ type: "hikvision_intercom/media/provider_check" }, 10000);
      this.notice = "media_provider_ready";
    } catch {
      this.error = "media_provider_failed";
    } finally {
      this.busy = false;
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const draft = this.draft;
    if (!draft || !this.settings) return html`<p role="alert">${this.t("media_load_failed")}</p>`;
    return html`<section class="station" style="max-width: 780px">
      <h2>${this.t("media_options")}</h2>
      <p>${this.t("media_scope")}</p>
      <form
        @submit=${(e: Event) => {
          e.preventDefault();
          void this.save();
        }}
      >
        <label
          >${this.t("media_transport")}<select
            aria-label=${this.t("media_transport")}
            .value=${draft.transport}
            ?disabled=${this.busy}
            @change=${(e: Event) => this.change("transport", (e.target as HTMLSelectElement).value)}
          >
            <option value="hls">HLS</option>
            <option value="webrtc">WebRTC / go2rtc</option>
          </select></label
        >
        ${
          draft.transport === "webrtc"
            ? html`<label
                  >${this.t("media_webrtc_mode")}<select
                    aria-label=${this.t("media_webrtc_mode")}
                    .value=${draft.webrtc_mode}
                    ?disabled=${this.busy}
                    @change=${(e: Event) => this.change("webrtc_mode", (e.target as HTMLSelectElement).value)}
                  >
                    <option value="rtc">RTC</option>
                    <option value="mse">MSE</option>
                  </select></label
                >
                <p class="sub">
                  ${this.t(draft.webrtc_mode === "mse" ? "media_mse_hint" : "media_rtc_hint")}
                </p>
                <label class="check"
                  ><input
                    type="checkbox"
                    aria-label=${this.t("media_fallback")}
                    .checked=${draft.fallback_hls}
                    ?disabled=${this.busy}
                    @change=${(e: Event) => this.change("fallback_hls", (e.target as HTMLInputElement).checked)}
                  />${this.t("media_fallback")}</label
                >
                ${
                  draft.webrtc_mode === "mse"
                    ? html`<label
                          >${this.t("media_go2rtc_url")}<input
                            type="url"
                            dir="ltr"
                            placeholder="http://go2rtc:1984"
                            .value=${draft.go2rtc_url}
                            ?disabled=${this.busy}
                            @input=${(e: Event) => this.change("go2rtc_url", (e.target as HTMLInputElement).value)}
                        /></label>
                        <p class="sub">${this.t("media_go2rtc_hint")}</p>`
                    : nothing
                }`
            : nothing
        }
        <div class="row" style="margin-top: 20px; flex-wrap: wrap">
          <button class="primary" type="submit" ?disabled=${this.busy || this.stale}>
            ${this.t("media_save")}
          </button>
          <button type="button" ?disabled=${this.busy} @click=${() => this.reload()}>
            ${this.t("media_reload")}
          </button>
          ${draft.transport === "webrtc" && draft.webrtc_mode === "mse" ? html`<button type="button" ?disabled=${this.busy} @click=${() => this.check()}>${this.t("media_provider_check")}</button>` : nothing}
        </div>
      </form>
      ${this.notice ? html`<p class="notice" role="status">${this.t(this.notice)}</p>` : nothing}
      ${this.error ? html`<p class="notice error" role="alert">${this.t(this.error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-media-settings", MediaSettingsPanel);
