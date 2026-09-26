import { LitElement, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass } from "./types";

export interface MediaPolicy {
  talk_mode?: "ptt" | "toggle";
  revision: number;
  transport: "hls" | "webrtc";
  webrtc_mode: "rtc" | "mse";
  fallback_hls: boolean;
  go2rtc_url: string;
  tts_engine_id?: string;
  tts_language?: string;
  tts_phrases?: string[];
}
export const DEFAULT_MEDIA: MediaPolicy = {
  talk_mode: "ptt",
  revision: 0,
  transport: "webrtc",
  webrtc_mode: "rtc",
  fallback_hls: true,
  go2rtc_url: "",
  tts_engine_id: "",
  tts_language: "",
  tts_phrases: [],
};
interface TtsEngine {
  engine_id: string;
  name: string;
  supported_languages: string[];
  default_language: string | null;
}

export class MediaSettingsPanel extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    notice: { state: true },
    server: { state: true },
    error: { state: true },
    stale: { state: true },
    engines: { state: true },
    engineDefault: { state: true },
    engineLoadError: { state: true },
  };
  hass?: Hass;
  settings?: MediaPolicy | null;
  private draft?: MediaPolicy;
  private busy = false;
  private actor?: string;
  private notice = "";
  private server = "";
  private error = "";
  private stale = false;
  private engines: TtsEngine[] = [];
  private engineDefault = "";
  private engineLoadError = false;
  private loadedConnection?: Hass["connection"];
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
    if (this.settings && !this.draft) this.draft = this.asDraft(this.settings);
    if (this.hass?.user?.is_admin && this.loadedConnection !== this.hass.connection) {
      this.loadedConnection = this.hass.connection;
      void this.loadEngines();
    }
    const select = this.renderRoot.querySelector<HTMLSelectElement>(".tts-settings-engine");
    if (select && select.value !== (this.draft?.tts_engine_id ?? "")) {
      select.value = this.draft?.tts_engine_id ?? "";
    }
    const languageSelect =
      this.renderRoot.querySelector<HTMLSelectElement>(".tts-settings-language");
    if (languageSelect && languageSelect.value !== (this.draft?.tts_language ?? "")) {
      languageSelect.value = this.draft?.tts_language ?? "";
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
  }
  private asDraft(value: MediaPolicy): MediaPolicy {
    return { ...DEFAULT_MEDIA, ...value, tts_phrases: [...(value.tts_phrases ?? [])] };
  }
  private async loadEngines() {
    const connection = this.hass?.connection;
    try {
      const result = await this.hass?.callWS<{ default: string | null; engines: TtsEngine[] }>({
        type: "hikvision_intercom/tts/engines",
      });
      if (!this.isConnected || connection !== this.hass?.connection) return;
      this.engines = Array.isArray(result?.engines) ? result.engines : [];
      this.engineDefault = result?.default ?? "";
      this.engineLoadError = false;
    } catch {
      if (this.isConnected && connection === this.hass?.connection) this.engineLoadError = true;
    }
  }
  private updatePhrase(index: number, value: string) {
    const phrases = [...(this.draft?.tts_phrases ?? [])];
    phrases[index] = value;
    this.change("tts_phrases", phrases);
  }
  private invalidPhrases(): boolean {
    const phrases = this.draft?.tts_phrases ?? [];
    const trimmed = phrases.map((phrase) => phrase.trim());
    return (
      phrases.length > 10 ||
      trimmed.some((phrase) => !phrase || phrase.length > 160) ||
      new Set(trimmed.map((phrase) => phrase.toLocaleLowerCase())).size !== trimmed.length
    );
  }
  private change(key: keyof MediaPolicy, value: unknown) {
    this.draft = { ...this.draft!, [key]: value };
    this.notice = "";
  }
  private async reload() {
    this.busy = true;
    this.error = "";
    try {
      this.draft = this.asDraft(
        await this.requests.run<MediaPolicy>(
          { type: "hikvision_intercom/media/settings_get" },
          10000,
        ),
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
      this.draft = this.asDraft(result);
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
      const result = await this.requests.run<{ server: string; version: string }>(
        { type: "hikvision_intercom/media/provider_check" },
        10000,
      );
      this.server = `${result.server} · go2rtc ${result.version}`;
      this.notice = "media_provider_ready";
    } catch {
      this.error = "media_provider_failed";
    } finally {
      this.busy = false;
    }
  }
  private async discover() {
    this.busy = true;
    this.error = "";
    this.notice = "";
    try {
      const result = await this.requests.run<{ url: string; version: string }>(
        { type: "hikvision_intercom/media/provider_discover" },
        12000,
      );
      if (!this.isConnected) return;
      this.change("go2rtc_url", result.url);
      this.server = `${result.url} · go2rtc ${result.version}`;
      this.notice = "media_discovered";
    } catch {
      this.error = "media_discover_failed";
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
          >${this.t("audio_talk_mode")}<select
            .value=${draft.talk_mode ?? "ptt"}
            ?disabled=${this.busy}
            @change=${(e: Event) => this.change("talk_mode", (e.target as HTMLSelectElement).value)}
          >
            <option value="ptt">${this.t("audio_mode_ptt")}</option>
            <option value="toggle">${this.t("audio_mode_toggle")}</option>
          </select></label
        >
        <p>${this.t("audio_toggle_hint")}</p>
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
                  true
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
        <fieldset class="tts-settings" style="margin-top: 20px">
          <legend>${this.t("tts_settings_title")}</legend>
          <p>${this.t("tts_settings_hint")}</p>
          <label
            >${this.t("tts_engine")}
            <select
              class="tts-settings-engine"
              aria-label=${this.t("tts_engine")}
              .value=${draft.tts_engine_id ?? ""}
              ?disabled=${this.busy}
              @change=${(e: Event) => {
                this.change("tts_engine_id", (e.target as HTMLSelectElement).value);
                this.change("tts_language", "");
              }}
            >
              <option value="">${this.t("tts_default_engine")}</option>
              ${
                draft.tts_engine_id &&
                !this.engines.some((engine) => engine.engine_id === draft.tts_engine_id)
                  ? html`<option value=${draft.tts_engine_id}>
                      ${draft.tts_engine_id} · ${this.t("tts_engine_unavailable")}
                    </option>`
                  : nothing
              }
              ${this.engines.map((engine) => html`<option value=${engine.engine_id}>${engine.name}</option>`)}
            </select>
          </label>
          ${this.engineLoadError ? html`<p role="alert">${this.t("tts_engines_failed")}</p>` : nothing}
          <label
            >${this.t("tts_language")}
            <select
              class="tts-settings-language"
              aria-label=${this.t("tts_language")}
              .value=${draft.tts_language ?? ""}
              ?disabled=${this.busy}
              @change=${(e: Event) => this.change("tts_language", (e.target as HTMLSelectElement).value)}
            >
              <option value="">${this.t("tts_auto_language")}</option>
              ${(() => {
                const selected = this.engines.find(
                  (engine) => engine.engine_id === (draft.tts_engine_id || this.engineDefault),
                );
                const languages = selected?.supported_languages ?? [];
                return html`${
                  draft.tts_language && !languages.includes(draft.tts_language)
                    ? html`<option value=${draft.tts_language}>
                        ${draft.tts_language} · ${this.t("tts_language_unavailable")}
                      </option>`
                    : nothing
                }${languages.map((language) => html`<option value=${language}>${language}</option>`)}`;
              })()}
            </select>
          </label>
          <h3>${this.t("tts_quick_phrases")}</h3>
          <p class="sub">${this.t("tts_phrase_hint")}</p>
          ${(draft.tts_phrases ?? []).map(
            (phrase, index) =>
              html`<div class="row" style="margin-bottom: 8px">
                <input
                  type="text"
                  maxlength="160"
                  style="flex: 1"
                  .value=${phrase}
                  aria-label=${`${this.t("tts_phrase")} ${index + 1}`}
                  ?disabled=${this.busy}
                  @input=${(e: Event) => this.updatePhrase(index, (e.target as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  ?disabled=${this.busy}
                  aria-label=${`${this.t("tts_phrase_remove")} ${index + 1}`}
                  @click=${() =>
                    this.change(
                      "tts_phrases",
                      (this.draft?.tts_phrases ?? []).filter((_, position) => position !== index),
                    )}
                >
                  ${this.t("tts_phrase_remove")}
                </button>
              </div>`,
          )}
          <button
            type="button"
            ?disabled=${this.busy || (draft.tts_phrases ?? []).length >= 10}
            @click=${() => this.change("tts_phrases", [...(this.draft?.tts_phrases ?? []), ""])}
          >
            ${this.t("tts_phrase_add")}
          </button>
          ${this.invalidPhrases() ? html`<p role="alert">${this.t("tts_phrase_invalid")}</p>` : nothing}
        </fieldset>
        <div class="row" style="margin-top: 20px; flex-wrap: wrap">
          <button
            class="primary"
            type="submit"
            ?disabled=${this.busy || this.stale || this.invalidPhrases()}
          >
            ${this.t("media_save")}
          </button>
          <button type="button" ?disabled=${this.busy} @click=${() => this.reload()}>
            ${this.t("media_reload")}
          </button>
          <button type="button" ?disabled=${this.busy} @click=${() => this.discover()}>
            ${this.t("media_discover")}
          </button>
          ${draft.transport === "webrtc" ? html`<button type="button" ?disabled=${this.busy} @click=${() => this.check()}>${this.t("media_provider_check")}</button>` : nothing}
        </div>
      </form>
      ${this.notice ? html`<p class="notice" role="status">${this.t(this.notice)} <bdi>${this.server}</bdi></p>` : nothing}
      ${this.error ? html`<p class="notice error" role="alert">${this.t(this.error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-media-settings", MediaSettingsPanel);
