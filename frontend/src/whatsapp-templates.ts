import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass } from "./types";

type TemplateKey = "he_unrestricted" | "he_scheduled" | "en_unrestricted" | "en_scheduled";
type TemplateValues = Record<TemplateKey, string> & { organization: string };
interface TemplatePolicy extends TemplateValues {
  revision: number;
  defaults: TemplateValues;
  placeholders: string[];
}

const sample: Record<string, string> = {
  name: "יהונתן אוליאל",
  organization: "מתנ״ס אפרת",
  pin: "646464",
  credential_section: "קוד הגישה האישי שלך:\n📟 646464 📟",
  security_notice: "🚫 ⚠️ ידוע לך כי חל איסור מוחלט למסור את הקוד לאחרים. ⚠️ 🚫",
  status: "פעיל",
  doors: "1. רקפת\n2. נרקיס\n3. דלת ראשית",
  doors_section: "דלתות מורשות:\n\n1. רקפת\n2. נרקיס\n3. דלת ראשית\n\n",
  days: "שני, שלישי, חמישי",
  dates: "17.09.2026",
  hours: "09:00–17:00",
  validity: "מ־17.09.2026 עד 30.09.2026",
  timezone: "Asia/Jerusalem",
  access_window_section: "📆 ימי הכניסה:\nשני, שלישי, חמישי\n\n⌚ שעות הכניסה:\n09:00–17:00\n\n",
};

export class WhatsAppTemplateSettings extends LitElement {
  static styles = [
    styles,
    css`
      .template-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 0.72fr);
        gap: 20px;
      }
      .template-card {
        border: 1px solid var(--divider-color, #d8e0ec);
        border-radius: 16px;
        padding: 18px;
        background: var(--card-background-color, #fff);
      }
      textarea {
        width: 100%;
        min-height: 360px;
        resize: vertical;
        box-sizing: border-box;
        font: inherit;
        line-height: 1.55;
      }
      .preview {
        white-space: pre-wrap;
        line-height: 1.6;
        min-height: 300px;
        background: var(--secondary-background-color, #f5f7fb);
      }
      .tokens {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin: 10px 0 18px;
      }
      .tokens code {
        direction: ltr;
        unicode-bidi: isolate;
        padding: 5px 8px;
        border-radius: 8px;
        background: var(--secondary-background-color, #eef2f8);
      }
      .selector-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 18px;
      }
      @media (max-width: 820px) {
        .template-layout {
          grid-template-columns: 1fr;
        }
        .selector-row {
          grid-template-columns: 1fr;
        }
        textarea {
          min-height: 300px;
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    policy: { state: true },
    draft: { state: true },
    language: { state: true },
    timing: { state: true },
    busy: { state: true },
    notice: { state: true },
    error: { state: true },
    stale: { state: true },
  };
  hass?: Hass;
  private policy?: TemplatePolicy;
  private draft?: TemplateValues;
  private language: "he" | "en" = "he";
  private timing: "unrestricted" | "scheduled" = "unrestricted";
  private busy = false;
  private notice = "";
  private error = "";
  private stale = false;
  private actor?: string;
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);

  protected updated(_changed: PropertyValues) {
    if (this.actor !== this.hass?.user?.id) {
      this.requests.cancel();
      this.actor = this.hass?.user?.id;
      this.policy = undefined;
      this.draft = undefined;
      this.error = "";
      this.notice = "";
      this.stale = false;
      if (this.actor) void this.reload();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
  }
  private get key(): TemplateKey {
    return `${this.language}_${this.timing}` as TemplateKey;
  }
  private async reload() {
    this.busy = true;
    this.error = "";
    try {
      const result = await this.requests.run<TemplatePolicy>(
        { type: "hikvision_intercom/whatsapp/templates_get" },
        10000,
      );
      if (!this.isConnected) return;
      this.policy = result;
      const {
        revision: _revision,
        defaults: _defaults,
        placeholders: _placeholders,
        ...values
      } = result;
      this.draft = values;
      this.stale = false;
    } catch {
      if (this.isConnected) this.error = "whatsapp_template_load_failed";
    } finally {
      this.busy = false;
    }
  }
  private change(key: keyof TemplateValues, value: string) {
    this.draft = { ...this.draft!, [key]: value };
    this.notice = "";
  }
  private async save() {
    if (!this.policy || !this.draft || this.busy || this.stale) return;
    this.busy = true;
    this.error = "";
    this.notice = "";
    try {
      const result = await this.requests.run<TemplatePolicy>(
        {
          type: "hikvision_intercom/whatsapp/templates_update",
          revision: this.policy.revision,
          values: this.draft,
        },
        12000,
      );
      if (!this.isConnected) return;
      this.policy = result;
      const {
        revision: _revision,
        defaults: _defaults,
        placeholders: _placeholders,
        ...values
      } = result;
      this.draft = values;
      this.notice = "whatsapp_template_saved";
    } catch (error) {
      if (!this.isConnected) return;
      const code = (error as { code?: string }).code;
      this.stale = code === "revision_conflict";
      this.error =
        code === "invalid_fields"
          ? "whatsapp_template_invalid"
          : code === "revision_conflict"
            ? "whatsapp_template_conflict"
            : "whatsapp_template_save_failed";
    } finally {
      this.busy = false;
    }
  }
  private preview() {
    if (!this.draft) return "";
    const variables =
      this.language === "he"
        ? sample
        : {
            ...sample,
            name: "Jonathan",
            status: "Active",
            credential_section: "Your personal access code:\n📟 646464 📟",
            security_notice: "🚫 ⚠️ Never share this code with anyone. ⚠️ 🚫",
            doors: "1. Main entrance\n2. Lobby\n3. Office",
            doors_section: "Authorized doors:\n\n1. Main entrance\n2. Lobby\n3. Office\n\n",
            days: "Monday, Tuesday, Thursday",
            dates: "2026-09-17",
            validity: "From 2026-09-17 until 2026-09-30",
            access_window_section:
              "📆 Access days:\nMonday, Tuesday, Thursday\n\n⌚ Access hours:\n09:00–17:00\n\n",
          };
    return this.draft[this.key]
      .replace(/{{\s*([a-z_]+)\s*}}/g, (_all, name: string) =>
        name === "organization" ? this.draft!.organization : (variables[name] ?? ""),
      )
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    if (!this.policy || !this.draft)
      return html`<section class="station">
        <h2>${this.t("whatsapp_templates")}</h2>
        <p role="alert">${this.t(this.error || "loading")}</p>
      </section>`;
    return html`<section class="station" style="max-width: 1180px">
      <h2>${this.t("whatsapp_templates")}</h2>
      <p>${this.t("whatsapp_templates_intro")}</p>
      <label
        >${this.t("whatsapp_organization")}<input
          maxlength="120"
          .value=${this.draft.organization}
          ?disabled=${this.busy}
          @input=${(event: Event) => this.change("organization", (event.target as HTMLInputElement).value)}
      /></label>
      <div class="selector-row">
        <label
          >${this.t("whatsapp_template_language")}<select
            .value=${this.language}
            @change=${(event: Event) => (this.language = (event.target as HTMLSelectElement).value as "he" | "en")}
          >
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select></label
        >
        <label
          >${this.t("whatsapp_template_kind")}<select
            .value=${this.timing}
            @change=${(event: Event) => (this.timing = (event.target as HTMLSelectElement).value as "unrestricted" | "scheduled")}
          >
            <option value="unrestricted">${this.t("whatsapp_template_unrestricted")}</option>
            <option value="scheduled">${this.t("whatsapp_template_scheduled")}</option>
          </select></label
        >
      </div>
      <p class="sub">${this.t("whatsapp_template_variables")}</p>
      <div class="tokens" aria-label=${this.t("whatsapp_template_variables")}>
        ${this.policy.placeholders.map((name) => html`<code>{{${name}}}</code>`)}
      </div>
      <div class="template-layout">
        <div class="template-card">
          <label
            >${this.t("whatsapp_template_text")}<textarea
              dir=${this.language === "he" ? "rtl" : "ltr"}
              .value=${this.draft[this.key]}
              ?disabled=${this.busy}
              @input=${(event: Event) => this.change(this.key, (event.target as HTMLTextAreaElement).value)}
            ></textarea>
          </label>
        </div>
        <article
          class="template-card preview"
          dir=${this.language === "he" ? "rtl" : "ltr"}
          aria-label=${this.t("whatsapp_template_preview")}
        >
          <strong>${this.t("whatsapp_template_preview")}</strong>
          <div>${this.preview()}</div>
        </article>
      </div>
      <p class="sub">${this.t("whatsapp_template_review_hint")}</p>
      <div class="actions">
        <button class="primary" ?disabled=${this.busy || this.stale} @click=${() => this.save()}>
          ${this.t("save")}
        </button>
        <button ?disabled=${this.busy} @click=${() => this.reload()}>${this.t("reload")}</button>
        <button
          ?disabled=${this.busy}
          @click=${() => {
            this.draft = { ...this.policy!.defaults };
            this.notice = "whatsapp_template_defaults_ready";
          }}
        >
          ${this.t("whatsapp_template_restore")}
        </button>
      </div>
      ${this.notice ? html`<p class="notice" role="status">${this.t(this.notice)}</p>` : nothing}
      ${this.error ? html`<p class="notice error" role="alert">${this.t(this.error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("wiskey-whatsapp-templates", WhatsAppTemplateSettings);
