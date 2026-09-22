import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { icon } from "./icons";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";

interface TtsEngine {
  engine_id: string;
  name: string;
  supported_languages: string[];
  default_language: string | null;
}
interface TtsEngines {
  default: string | null;
  engines: TtsEngine[];
}
interface TtsEvent {
  state: "generating" | "speaking" | "completed" | "closed";
  reason?: string;
  duration_seconds?: number;
  bytes_written?: number;
}

export class IntercomTtsControls extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: min(760px, 100%);
      margin: 12px auto 0;
    }
    .tts-panel {
      border: 1px solid var(--divider-color, #d8e0ec);
      border-radius: 14px;
      padding: 12px;
      background: color-mix(in srgb, var(--card-background-color, #fff) 94%, #2869ee 6%);
    }
    .heading,
    .composer,
    .settings,
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .heading {
      justify-content: space-between;
      margin-bottom: 9px;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }
    .title svg {
      width: 20px;
      height: 20px;
      color: #2869ee;
    }
    textarea,
    select,
    button {
      font: inherit;
    }
    textarea,
    select {
      border: 1px solid var(--divider-color, #cbd5e1);
      border-radius: 10px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #1f2937);
    }
    textarea {
      flex: 1 1 420px;
      min-height: 54px;
      max-height: 120px;
      resize: vertical;
      padding: 10px 12px;
      line-height: 1.4;
    }
    button {
      min-height: 44px;
      padding: 9px 16px;
      border: 1px solid var(--divider-color, #cbd5e1);
      border-radius: 10px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #1f2937);
      cursor: pointer;
    }
    button.primary {
      min-width: 112px;
      background: #2869ee;
      border-color: #2869ee;
      color: white;
      font-weight: 650;
    }
    button:disabled,
    textarea:disabled,
    select:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .settings {
      flex-wrap: wrap;
      margin-top: 9px;
    }
    label {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--secondary-text-color, #64748b);
      font-size: 12px;
    }
    select {
      min-height: 36px;
      padding: 5px 8px;
      max-width: 250px;
    }
    .counter {
      margin-inline-start: auto;
      color: var(--secondary-text-color, #64748b);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .status {
      margin: 9px 0 0;
      min-height: 18px;
      font-size: 13px;
      color: var(--secondary-text-color, #64748b);
    }
    .status.success {
      color: var(--success-color, #18733d);
    }
    .status.error {
      color: var(--error-color, #b32b25);
    }
    .pulse {
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-inline-end: 6px;
      border-radius: 50%;
      background: #2869ee;
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.3;
      }
    }
    @media (max-width: 640px) {
      :host {
        margin-top: 9px;
      }
      .tts-panel {
        padding: 10px;
      }
      .composer {
        align-items: stretch;
        flex-direction: column;
      }
      textarea {
        width: 100%;
        box-sizing: border-box;
        min-height: 68px;
      }
      button.primary {
        width: 100%;
      }
      .settings {
        align-items: stretch;
      }
      label {
        flex: 1 1 100%;
        justify-content: space-between;
      }
      select {
        flex: 1;
        max-width: 70%;
      }
      .counter {
        margin-inline-start: 0;
      }
    }
  `;
  static properties = {
    hass: { attribute: false },
    station: { attribute: false },
    message: { state: true },
    engines: { state: true },
    engineId: { state: true },
    language: { state: true },
    loading: { state: true },
    speaking: { state: true },
    status: { state: true },
    error: { state: true },
  };

  hass?: Hass;
  station?: Station;
  private message = "";
  private engines: TtsEngine[] = [];
  private engineId = "";
  private language = "";
  private loading = false;
  private speaking = false;
  private status = "";
  private error = "";
  private epoch = 0;
  private loadedConnection?: Hass["connection"];
  private unsubscribe?: () => void | Promise<void>;
  private terminal = false;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);

  private onPageHide = () => this.cancel();
  private onVisibility = () => {
    if (document.hidden) this.cancel();
  };
  private onCallEnding = () => this.cancel();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("hikvision-call-ending", this.onCallEnding);
  }

  protected updated(changed: PropertyValues) {
    if (
      changed.has("station") &&
      (changed.get("station") as Station | undefined)?.id !== this.station?.id
    ) {
      this.cancel();
      this.status = "";
      this.error = "";
    }
    // Initial station and HA properties commonly arrive in the same Lit update.
    // Start discovery only after the station lifecycle reset so its result stays current.
    if (changed.has("hass") && this.loadedConnection !== this.hass?.connection) {
      this.loadedConnection = this.hass?.connection;
      void this.loadEngines();
    }
    // Select options are populated asynchronously and Lit updates their children after
    // the select value part. Re-apply controlled values after every completed render.
    const engineSelect = this.renderRoot.querySelector<HTMLSelectElement>(".tts-engine");
    if (engineSelect && engineSelect.value !== this.engineId) engineSelect.value = this.engineId;
    const languageSelect = this.renderRoot.querySelector<HTMLSelectElement>(".tts-language");
    if (languageSelect && languageSelect.value !== this.language) {
      languageSelect.value = this.language;
    }
  }

  disconnectedCallback() {
    this.cancel();
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.removeEventListener("hikvision-call-ending", this.onCallEnding);
    super.disconnectedCallback();
  }

  private chooseLanguage(engine?: TtsEngine) {
    if (!engine) return "";
    const preferred = this.hass?.language?.startsWith("he") ? "iw" : this.hass?.language;
    if (preferred && engine.supported_languages.includes(preferred)) return preferred;
    return engine.default_language ?? engine.supported_languages[0] ?? "";
  }

  private async loadEngines() {
    if (!this.hass) return;
    const epoch = ++this.epoch;
    this.loading = true;
    this.error = "";
    try {
      const result = await this.hass.callWS<TtsEngines>({
        type: "hikvision_intercom/tts/engines",
      });
      if (!this.isConnected || epoch !== this.epoch) return;
      this.engines = Array.isArray(result.engines) ? result.engines : [];
      this.engineId =
        this.engines.find((item) => item.engine_id === result.default)?.engine_id ??
        this.engines[0]?.engine_id ??
        "";
      this.language = this.chooseLanguage(
        this.engines.find((item) => item.engine_id === this.engineId),
      );
    } catch {
      if (this.isConnected && epoch === this.epoch) this.error = "tts_engines_failed";
    } finally {
      if (this.isConnected && epoch === this.epoch) this.loading = false;
    }
  }

  private releaseSubscription() {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (!unsubscribe) return;
    try {
      void Promise.resolve(unsubscribe()).catch(() => undefined);
    } catch {
      /* The HA connection may already be closed. */
    }
  }

  private cancel() {
    this.epoch++;
    this.releaseSubscription();
    this.speaking = false;
    this.terminal = false;
  }

  private handleEvent(event: TtsEvent, epoch: number) {
    if (!this.isConnected || epoch !== this.epoch) return;
    if (event.state === "generating") {
      this.status = "tts_generating";
      this.error = "";
    } else if (event.state === "speaking") {
      this.speaking = true;
      this.status = "tts_speaking";
      this.error = "";
    } else if (event.state === "completed") {
      this.speaking = false;
      this.status = "tts_completed";
      this.error = "";
      this.terminal = true;
      queueMicrotask(() => this.releaseSubscription());
    } else if (event.state === "closed") {
      this.speaking = false;
      this.status = "";
      this.error = event.reason ?? "tts_playback_failed";
      this.terminal = true;
      queueMicrotask(() => this.releaseSubscription());
    }
  }

  private async submit(event?: Event) {
    event?.preventDefault();
    if (
      this.speaking ||
      !this.hass ||
      !this.station?.online ||
      !this.engineId ||
      !this.message.trim() ||
      this.message.trim().length > 500
    )
      return;
    this.cancel();
    const epoch = ++this.epoch;
    this.speaking = true;
    this.terminal = false;
    this.status = "tts_connecting";
    this.error = "";
    try {
      const unsubscribe = await this.hass.connection.subscribeMessage<TtsEvent>(
        (message) => this.handleEvent(message, epoch),
        {
          type: "hikvision_intercom/tts/start",
          station_id: this.station.id,
          engine_id: this.engineId,
          language: this.language || null,
          message: this.message.trim(),
        },
        { resubscribe: false, preCheck: () => this.isConnected && epoch === this.epoch },
      );
      if (!this.isConnected || epoch !== this.epoch) {
        void Promise.resolve(unsubscribe()).catch(() => undefined);
        return;
      }
      this.unsubscribe = unsubscribe;
      if (this.terminal) this.releaseSubscription();
    } catch (reason) {
      if (this.isConnected && epoch === this.epoch) {
        this.speaking = false;
        this.status = "";
        this.error = (reason as { code?: string })?.code ?? "tts_playback_failed";
      }
    }
  }

  render() {
    if (!this.hass || !this.station) return nothing;
    const engine = this.engines.find((item) => item.engine_id === this.engineId);
    return html`<form class="tts-panel" @submit=${this.submit} aria-label=${this.t("tts_title")}>
      <div class="heading">
        <span class="title">${icon("speaker")} ${this.t("tts_title")}</span>
        ${this.speaking ? html`<button type="button" @click=${() => this.cancel()}>${this.t("tts_stop")}</button>` : nothing}
      </div>
      <div class="composer">
        <textarea
          maxlength="500"
          .value=${this.message}
          aria-label=${this.t("tts_message")}
          placeholder=${this.t("tts_placeholder")}
          ?disabled=${this.speaking || !this.engines.length}
          @input=${(event: Event) => (this.message = (event.target as HTMLTextAreaElement).value)}
          @keydown=${(event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void this.submit();
            }
          }}
        ></textarea>
        <button
          class="primary"
          type="submit"
          ?disabled=${this.speaking || !this.station.online || !this.engineId || !this.message.trim()}
        >
          ${this.t("tts_send")}
        </button>
      </div>
      <div class="settings">
        <label
          >${this.t("tts_engine")}
          <select
            class="tts-engine"
            .value=${this.engineId}
            ?disabled=${this.speaking || this.loading}
            @change=${(event: Event) => {
              this.engineId = (event.target as HTMLSelectElement).value;
              this.language = this.chooseLanguage(
                this.engines.find((item) => item.engine_id === this.engineId),
              );
            }}
          >
            ${this.engines.map((item) => html`<option value=${item.engine_id} ?selected=${item.engine_id === this.engineId}>${item.name}</option>`)}
          </select>
        </label>
        ${
          engine?.supported_languages.length
            ? html`<label
                >${this.t("tts_language")}
                <select
                  class="tts-language"
                  .value=${this.language}
                  ?disabled=${this.speaking}
                  @change=${(event: Event) => (this.language = (event.target as HTMLSelectElement).value)}
                >
                  ${engine.supported_languages.map((item) => html`<option value=${item} ?selected=${item === this.language}>${item}</option>`)}
                </select>
              </label>`
            : nothing
        }
        <span class="counter">${this.message.length}/500</span>
      </div>
      ${
        !this.loading && !this.engines.length && !this.error
          ? html`<p class="status error" role="alert">${this.t("tts_no_engine")}</p>`
          : nothing
      }
      ${
        this.status
          ? html`<p
              class="status ${this.status === "tts_completed" ? "success" : ""}"
              role="status"
            >
              ${this.speaking ? html`<span class="pulse" aria-hidden="true"></span>` : nothing}${this.t(this.status)}
            </p>`
          : nothing
      }
      ${this.error ? html`<p class="status error" role="alert">${this.t(this.error)}</p>` : nothing}
    </form>`;
  }
}

customElements.define("wiskey-intercom-tts", IntercomTtsControls);
