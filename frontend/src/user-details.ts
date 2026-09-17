import { fitDialogViewport } from "./dialog-viewport";
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import { mobileDisplay } from "./phone";
import type { Hass, Person, Station } from "./types";
import type { ProfilePolicy } from "./profile-settings";

interface Message {
  quote?: string;
  id: string;
  outgoing: boolean;
  timestamp: number;
  text: string;
  caption: string;
  kind: string;
  filename: string;
  media_token: string | null;
}
interface Preview {
  token: string;
  recipient: string;
  message: string;
}
interface Status {
  available: boolean;
  history: boolean;
  accounts: { id: string; name: string }[];
}
const copy = {
  missingPhone: [
    "Add a mobile number in Edit to use WhatsApp.",
    "יש להוסיף מספר נייד בעריכת המשתמש כדי להשתמש בווטסאפ.",
  ],
  draftOnly: ["A draft schedule exists; it is not enforced.", "קיימת טיוטת זמנים שאינה נאכפת."],
  no_expiry: ["No expiration date", "ללא תאריך תפוגה"],
  monday: ["Monday", "יום שני"],
  tuesday: ["Tuesday", "יום שלישי"],
  wednesday: ["Wednesday", "יום רביעי"],
  thursday: ["Thursday", "יום חמישי"],
  friday: ["Friday", "יום שישי"],
  saturday: ["Saturday", "שבת"],
  sunday: ["Sunday", "יום ראשון"],
  details: ["User details", "פרטי משתמש"],
  chat: ["WhatsApp conversation", "שיחת WhatsApp"],
  prepare: ["Send access details via WhatsApp", "שלח פרטי גישה בווטסאפ"],
  review: ["Review and edit before sending", "בדיקה ועריכה לפני השליחה"],
  send: ["Confirm and send", "אישור ושליחה"],
  account: ["Sending account", "חשבון שולח"],
  notice: [
    "Nothing is sent until you confirm. Check the recipient and access details.",
    "לא נשלח דבר עד לאישור שלך. יש לבדוק את הנמען ואת פרטי הגישה.",
  ],
  historyHint: [
    "Stored conversation only, up to 200 messages returned by the integration. Refresh to see new messages.",
    "מוצגות עד 200 הודעות שהאינטגרציה מחזירה מהשיחה השמורה. רענן להצגת הודעות חדשות.",
  ],
  empty: ["No stored messages returned for this number.", "לא הוחזרו הודעות שמורות למספר הזה."],
  accepted: [
    "The WhatsApp integration accepted the send. Delivery is not verified here.",
    "אינטגרציית WhatsApp אישרה את השליחה. מסירה לנמען אינה מאומתת כאן.",
  ],
  whatsapp_unavailable: [
    "Configure and connect the WhatsApp integration in Home Assistant.",
    "יש להגדיר ולחבר את אינטגרציית WhatsApp ב־Home Assistant.",
  ],
  whatsapp_invalid_phone: [
    "Enter a valid Israeli mobile or an international number beginning with +.",
    "יש להזין נייד ישראלי תקין או מספר בינלאומי שמתחיל ב־+.",
  ],
  whatsapp_preview_expired: [
    "User details changed or the preview expired. Prepare a new message.",
    "פרטי המשתמש השתנו או שהתצוגה פגה. יש להכין הודעה חדשה.",
  ],
  whatsapp_history_unavailable: [
    "History could not be loaded. Check the WhatsApp account and integration version.",
    "לא ניתן לטעון את השיחה. בדוק את חשבון WhatsApp ואת גרסת האינטגרציה.",
  ],
  whatsapp_send_uncertain: [
    "Send result is uncertain. Check the conversation before preparing another message.",
    "תוצאת השליחה אינה ודאית. בדוק את השיחה לפני הכנת הודעה נוספת.",
  ],
  whatsapp_media_unavailable: [
    "Media unavailable, expired, unsupported or larger than 8 MB.",
    "המדיה אינה זמינה, פגה, אינה נתמכת או גדולה מ־8 MB.",
  ],
  loadMedia: ["Load attachment", "הצג קובץ מצורף"],
  attachment: ["Download attachment", "הורד קובץ מצורף"],
  noMedia: [
    "Attachment is not available in the stored history.",
    "הקובץ אינו זמין בהיסטוריה השמורה.",
  ],
  pending: ["Synchronization not verified", "סנכרון טרם אומת"],
};
const whatsappIcon = html`<svg
  viewBox="0 0 24 24"
  width="22"
  height="22"
  fill="currentColor"
  aria-hidden="true"
>
  <path
    d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.2-1.3A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4-1.1l-.4-.2-3 .8.8-3-.2-.4A8 8 0 1 1 12 20Zm4.5-6c-.3-.1-1.6-.8-1.9-.9-.2-.1-.4-.1-.6.2l-.8 1c-.2.2-.3.2-.6.1-1.4-.7-2.4-1.6-3-2.8-.2-.3 0-.4.1-.6l.6-.8c.1-.2.1-.4 0-.6L9.5 7.7C9.3 7.2 9 7.3 8.8 7.3H8c-.2 0-.4.1-.6.3-.8.9-1 1.8-.5 3.1.6 1.8 2.6 4.3 5.7 5.5 2 .7 3 .2 3.5-.5.3-.5.5-1.4.4-1.6 0-.1-.2-.2-.5-.3Z"
  />
</svg>`;

export class UserDetails extends LitElement {
  static properties = {
    canEdit: { type: Boolean },
    embedded: { type: Boolean, reflect: true },
    hass: { attribute: false },
    person: { attribute: false },
    stations: { attribute: false },
    policy: { attribute: false },
    tab: { state: true },
    status: { state: true },
    account: { state: true },
    preview: { state: true },
    messages: { state: true },
    photo: { state: true },
    busy: { state: true },
    error: { state: true },
    sent: { state: true },
    media: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        background: transparent;
      }
      :host([embedded]) dialog {
        position: static;
        display: block;
        width: 100%;
        max-width: none;
        max-height: none;
        margin: 0;
        box-shadow: none;
        border-radius: 10px;
        border: 1px solid var(--divider-color);
      }
      :host([embedded]) header {
        position: static;
        padding: 16px;
        gap: 10px;
      }
      :host([embedded]) header h2 {
        font-size: 18px;
      }
      :host([embedded]) header > button {
        display: none;
      }
      :host([embedded]) .portrait {
        width: 52px;
        height: 52px;
        flex: 0 0 52px;
      }
      :host([embedded]) nav,
      :host([embedded]) main,
      :host([embedded]) footer {
        padding: 12px 16px;
      }
      :host([embedded]) nav {
        flex-wrap: wrap;
      }
      :host([embedded]) dl {
        gap: 8px;
      }
      :host([embedded]) dl div {
        padding: 8px;
        border-radius: 6px;
      }
      :host([embedded]) dd {
        margin: 4px 0 0;
        overflow-wrap: anywhere;
      }
      :host([embedded]) .rights {
        padding: 0;
      }
      :host([embedded]) .rights li {
        font-size: 13px;
        padding-block: 8px;
      }
      :host([embedded]) .wa {
        width: 100%;
        justify-content: center;
        font-size: 13px;
      }
      :host([embedded]) footer button {
        width: 100%;
      }
      :host([embedded]) .chat {
        max-height: 400px;
      }
      :host([embedded]) button {
        padding: 7px 10px;
      }
      dialog {
        width: min(960px, calc(100vw - 24px));
        max-height: calc(100dvh - 24px);
        padding: 0;
        border: 0;
        border-radius: 22px;
        color: var(--primary-text-color, #172633);
        background: var(--card-background-color, #fff);
        box-shadow: 0 24px 90px #0005;
      }
      dialog::backdrop {
        background: #12273588;
        backdrop-filter: blur(4px);
      }
      header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 20px 24px;
        border-bottom: 1px solid var(--divider-color, #dce3eb);
      }
      header h2 {
        margin: 0;
      }
      header .identity {
        flex: 1;
        min-width: 0;
      }
      .portrait {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        object-fit: cover;
        background: var(--secondary-background-color, #e6edf7);
        display: grid;
        place-items: center;
        font-size: 28px;
      }
      nav {
        display: flex;
        gap: 8px;
        padding: 12px 24px;
        border-bottom: 1px solid var(--divider-color, #dce3eb);
      }
      main {
        padding: 20px 24px;
      }
      dl {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      dl div {
        padding: 12px;
        background: var(--secondary-background-color, #f5f7fb);
        border-radius: 12px;
      }
      dt {
        font-size: 13px;
        opacity: 0.7;
      }
      dd {
        margin: 4px 0 0;
        overflow-wrap: anywhere;
      }
      .rights {
        padding: 0;
        list-style: none;
      }
      .rights li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid var(--divider-color, #e8edf2);
      }
      .wa {
        background: #087e64;
        color: white;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .compose {
        border: 1px solid #a4cfbd;
        border-radius: 16px;
        padding: 18px;
        margin-top: 16px;
      }
      textarea {
        width: 100%;
        box-sizing: border-box;
        min-height: 250px;
        resize: vertical;
        line-height: 1.7;
      }
      .recipient {
        white-space: nowrap;
      }
      .chat {
        min-height: 240px;
        max-height: 420px;
        overflow: auto;
        padding: 16px;
        background: var(--secondary-background-color, #edf3ef);
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .bubble {
        max-width: 85%;
        align-self: flex-end;
        padding: 12px 16px;
        border-radius: 16px 16px 4px 16px;
        background: var(--card-background-color, #fff);
        box-shadow: 0 1px 3px #0001;
        overflow-wrap: anywhere;
      }
      .bubble.out {
        align-self: flex-start;
        background: #d9f5e8;
        color: #17352e;
        border-radius: 16px 16px 16px 4px;
      }
      blockquote {
        border-inline-start: 3px solid #087e64;
        margin: 0 0 8px;
        padding: 8px;
        background: #00000008;
        white-space: pre-wrap;
      }
      .bubble p {
        white-space: pre-wrap;
        margin: 0 0 8px;
      }
      time {
        font-size: 11px;
        opacity: 0.65;
        display: block;
        text-align: end;
      }
      .bubble img,
      .bubble video {
        max-width: 100%;
        max-height: 300px;
        border-radius: 10px;
      }
      audio {
        max-width: 100%;
      }
      footer {
        padding: 12px 24px;
        border-top: 1px solid var(--divider-color, #dce3eb);
        display: flex;
        justify-content: flex-end;
      }
      .error {
        color: #ac2935;
      }
      .row {
        flex-wrap: wrap;
      }
      @media (max-width: 600px) {
        header,
        main,
        nav {
          padding: 14px;
        }
        .portrait {
          width: 60px;
          height: 60px;
        }
        dl {
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .wa {
          width: 100%;
          justify-content: center;
        }
        .bubble {
          max-width: 95%;
        }
      }
    `,
  ];
  embedded = false;
  canEdit = true;
  hass?: Hass;
  person?: Person;
  stations: Station[] = [];
  policy?: ProfilePolicy;
  private tab = "details";
  private status?: Status;
  private account = "";
  private preview?: Preview;
  private messages?: Message[];
  private photo?: string;
  private busy = false;
  private error = "";
  private sent = false;
  private media: Record<string, { url: string; mime: string }> = {};
  private requests = new ScopedRequests(() => this.hass);
  private generation = 0;
  private owner = "";
  private connection?: Hass["connection"];
  private disconnected = () => this.close();
  private closed = false;
  private t(key: string) {
    const item = copy[key as keyof typeof copy];
    return item
      ? item[this.hass?.language?.startsWith("he") ? 1 : 0]
      : translate(this.hass?.language ?? "en", key);
  }
  private close() {
    if (this.closed) return;
    this.closed = true;
    this.renderRoot.querySelector("dialog")?.close();
    this.clear();
    this.dispatchEvent(new CustomEvent("details-close"));
  }
  private clear() {
    this.generation++;
    this.requests.cancel();
    this.preview = undefined;
    this.messages = undefined;
    this.photo = undefined;
    for (const item of Object.values(this.media)) URL.revokeObjectURL(item.url);
    this.media = {};
  }
  private viewportObserver?: ResizeObserver;
  private fitViewport = () => {
    if (!this.embedded)
      fitDialogViewport(this.renderRoot.querySelector<HTMLDialogElement>("dialog[open]"));
  };
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this.fitViewport);
    window.visualViewport?.addEventListener("resize", this.fitViewport);
    this.viewportObserver = new ResizeObserver(this.fitViewport);
    this.viewportObserver.observe(this);
  }
  disconnectedCallback() {
    window.removeEventListener("resize", this.fitViewport);
    window.visualViewport?.removeEventListener("resize", this.fitViewport);
    this.viewportObserver?.disconnect();
    this.connection?.removeEventListener?.("disconnected", this.disconnected);
    this.clear();
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    if (
      !this.hass?.user?.is_admin ||
      this.hass.connection.connected === false ||
      (this.owner && this.owner !== this.hass.user.id)
    ) {
      this.close();
      return;
    }
    if (this.connection !== this.hass.connection) {
      this.connection?.removeEventListener?.("disconnected", this.disconnected);
      this.connection = this.hass.connection;
      this.connection.addEventListener?.("disconnected", this.disconnected);
    }
    if (changed.has("person")) {
      const previous = changed.get("person") as Person | undefined;
      if (
        !previous ||
        previous.id !== this.person?.id ||
        previous.revision !== this.person?.revision
      ) {
        this.clear();
        this.tab = "details";
        this.sent = false;
        this.error = "";
        this.owner = this.hass.user.id ?? "";
        void this.load();
      }
    }
    const dialog = this.renderRoot.querySelector("dialog");
    if (dialog && !dialog.open && !this.embedded) dialog.showModal();
    this.fitViewport();
  }
  private api<T>(command: string, data: Record<string, unknown> = {}) {
    return this.requests.run<T>({
      type: `hikvision_intercom/whatsapp/${command}`,
      user_id: this.person?.id,
      account: this.account,
      ...data,
    });
  }
  private async action(work: () => Promise<void>) {
    if (this.busy) return;
    const generation = this.generation;
    this.busy = true;
    this.error = "";
    try {
      await work();
    } catch (e) {
      if (generation === this.generation)
        this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
  private async load() {
    this.busy = false;
    const generation = this.generation;
    await this.action(async () => {
      const status = await this.requests.run<Status>({
        type: "hikvision_intercom/whatsapp/status",
      });
      if (generation !== this.generation) return;
      this.status = {
        available: status.available === true,
        history: status.history === true,
        accounts: Array.isArray(status.accounts) ? status.accounts : [],
      };
      this.account = this.status.accounts.length === 1 ? this.status.accounts[0].id : "";
      if (this.person?.photo_configured) {
        const result = await this.requests.run<{ photo: string | null }>({
          type: "hikvision_intercom/users/photo_get",
          user_id: this.person.id,
        });
        if (generation === this.generation) this.photo = result.photo ?? undefined;
      }
    });
  }
  private async prepare() {
    this.sent = false;
    await this.action(async () => {
      this.preview = await this.api<Preview>("preview", { language: this.hass?.language ?? "en" });
    });
  }
  private async history() {
    this.tab = "chat";
    await this.action(async () => {
      const result = await this.api<{ messages: Message[] }>("history");
      for (const item of Object.values(this.media)) URL.revokeObjectURL(item.url);
      this.media = {};
      this.messages = result.messages;
    });
  }
  private async send() {
    if (!this.preview) return;
    const preview = this.preview;
    this.preview = undefined;
    await this.action(async () => {
      try {
        await this.api("send", { token: preview.token, message: preview.message, confirmed: true });
      } catch (error) {
        const code = (error as { code?: string }).code;
        throw { code: code === "whatsapp_preview_expired" ? code : "whatsapp_send_uncertain" };
      }
      this.sent = true;
    });
  }
  private async attachment(message: Message) {
    await this.action(async () => {
      const response = await this.api<{ mime: string; data: string }>("media", {
        token: message.media_token,
      });
      const bytes = Uint8Array.from(atob(response.data), (c) => c.charCodeAt(0));
      this.media = {
        ...this.media,
        [message.id]: {
          mime: response.mime,
          url: URL.createObjectURL(new Blob([bytes], { type: response.mime })),
        },
      };
    });
  }
  render() {
    const p = this.person;
    if (this.closed || !p || !this.hass?.user?.is_admin) return nothing;
    const ready = !!this.status?.available && !!this.account && !!p.phone && !this.busy;
    return html`<dialog
      ?open=${this.embedded}
      role=${this.embedded ? "region" : "dialog"}
      dir=${this.hass.language?.startsWith("he") ? "rtl" : "ltr"}
      aria-labelledby="person-title"
      @cancel=${() => this.close()}
    >
      <header>
        ${this.photo ? html`<img class="portrait" src=${this.photo} alt="" />` : html`<span class="portrait" aria-hidden="true">${p.display_name.slice(0, 1)}</span>`}
        <div class="identity">
          <h2 id="person-title">${p.display_name}</h2>
          <bdi class="recipient" dir="ltr">${mobileDisplay(p.phone ?? "")}</bdi>
        </div>
        <button aria-label=${this.t("close")} @click=${() => this.close()}>✕</button>
      </header>
      <nav>
        <button aria-pressed=${this.tab === "details"} @click=${() => (this.tab = "details")}>
          ${this.t("details")}</button
        ><button
          ?disabled=${!ready || !this.status?.history}
          aria-pressed=${this.tab === "chat"}
          @click=${() => this.history()}
        >
          ${whatsappIcon} ${this.t("chat")}
        </button>
      </nav>
      <main>
        ${
          this.tab === "details"
            ? html`<dl>
                  <div>
                    <dt>${this.t("employee_id")}</dt>
                    <dd>${p.employee_no}</dd>
                  </div>
                  <div>
                    <dt>${this.t("status")}</dt>
                    <dd>${this.t(p.active ? "active" : "inactive")}</dd>
                  </div>
                  ${this.policy?.fields
                    .filter((f) => f.enabled)
                    .map(
                      (f) =>
                        html`<div>
                          <dt>${f.label}</dt>
                          <dd>${p.profile?.[f.id] || "—"}</dd>
                        </div>`,
                    )}
                  <div>
                    <dt>${this.t("profile_groups")}</dt>
                    <dd>
                      ${
                        this.policy?.groups
                          .filter((g) => p.group_ids?.includes(g.id))
                          .map((g) => g.label)
                          .join(", ") || "—"
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>${this.t("pin")}</dt>
                    <dd>${this.t(p.pin_configured ? "configured" : "not_configured")}</dd>
                  </div>
                  <div>
                    <dt>${this.t("cards")}</dt>
                    <dd>${p.cards.map((c) => c.masked_number || c.label).join(", ") || "—"}</dd>
                  </div>
                  <div>
                    <dt>${this.t("validity")}</dt>
                    <dd>
                      ${p.valid_from || "—"} →
                      ${p.valid_until || "—"}${
                        p.access_timing_policy
                          ? html`<p>
                                ${p.access_timing_policy.schedule.timezone} ·
                                ${[...p.access_timing_policy.schedule.days, ...p.access_timing_policy.schedule.dates].map((day) => (this.t(day.toLowerCase()) === day.toLowerCase() ? day : this.t(day.toLowerCase()))).join(", ")}
                              </p>
                              <p>
                                ${p.access_timing_policy.schedule.periods.map((w) => `${w.start}–${w.end}`).join(", ")}
                              </p>`
                          : nothing
                      }
                    </dd>
                  </div>
                </dl>
                ${p.access_timing_draft && !p.access_timing_policy ? html`<p>${this.t("draftOnly")}</p>` : nothing}
                <ul class="rights">
                  ${Object.entries(p.assignments)
                    .filter(([, a]) => a.enabled)
                    .map(
                      ([id, a]) =>
                        html`<li>
                          <span
                            >${this.stations.find((s) => s.id === id)?.name || id} ·
                            ${a.allowed_locks.join(", ")}</span
                          ><span>${this.t(a.sync_state === "synced" ? "synced" : "pending")}</span>
                        </li>`,
                    )}
                </ul>`
            : html`<p class="sub">${this.t("historyHint")}</p>
                <button ?disabled=${!ready} @click=${() => this.history()}>
                  ${this.t("refresh")}
                </button>
                <div class="chat" role="log" aria-label=${this.t("chat")}>
                  ${
                    this.messages?.length
                      ? this.messages.map((m) => {
                          const media = this.media[m.id];
                          return html`<article class=${`bubble ${m.outgoing ? "out" : ""}`}>
                            ${m.quote ? html`<blockquote>${m.quote}</blockquote>` : nothing}
                            <p>${m.text}</p>
                            ${m.caption ? html`<p>${m.caption}</p>` : nothing}${media ? (media.mime.startsWith("image/") ? html`<img src=${media.url} alt=${m.caption || m.kind} />` : media.mime.startsWith("video/") ? html`<video controls preload="metadata" src=${media.url}></video>` : media.mime.startsWith("audio/") ? html`<audio controls src=${media.url}></audio>` : html`<a href=${media.url} download=${m.filename || "attachment"}>${this.t("attachment")}</a>`) : m.media_token ? html`<button ?disabled=${this.busy} @click=${() => this.attachment(m)}>${this.t("loadMedia")} · ${m.kind}</button>` : ["image", "video", "audio", "document", "sticker"].includes(m.kind) ? html`<small>${m.kind} · ${this.t("noMedia")}</small>` : nothing}<time
                              >${m.timestamp ? new Date(m.timestamp * 1000).toLocaleString(this.hass?.language) : ""}</time
                            >
                          </article>`;
                        })
                      : html`<p>${this.t(this.busy ? "wait" : "empty")}</p>`
                  }
                </div>`
        }
        ${
          this.status?.accounts.length
            ? html`<label
                >${this.t("account")}<select
                  .value=${this.account}
                  ?disabled=${this.busy}
                  @change=${(e: Event) => {
                    this.account = (e.target as HTMLSelectElement).value;
                    this.preview = undefined;
                    this.messages = undefined;
                    this.sent = false;
                  }}
                >
                  <option value="">—</option>
                  ${this.status.accounts.map((a) => html`<option value=${a.id}>${a.name}</option>`)}
                </select></label
              >`
            : nothing
        }
        ${!p.phone ? html`<p>${this.t("missingPhone")}</p>` : nothing}${!this.status?.available ? html`<p>${this.t("whatsapp_unavailable")}</p>` : nothing}<button
          class="wa"
          ?disabled=${!ready || !this.canEdit}
          @click=${() => this.prepare()}
        >
          ${whatsappIcon}${this.t("prepare")}
        </button>
        ${
          this.preview
            ? html`<section class="compose">
                <h3>${this.t("review")}</h3>
                <p><bdi dir="ltr">${this.preview.recipient}</bdi></p>
                <p class="sub">${this.t("notice")}</p>
                <textarea
                  aria-label=${this.t("review")}
                  maxlength="12000"
                  .value=${this.preview.message}
                  @input=${(e: Event) => {
                    if (this.preview)
                      this.preview = {
                        ...this.preview,
                        message: (e.target as HTMLTextAreaElement).value,
                      };
                  }}
                ></textarea>
                <div class="row">
                  <button
                    class="wa"
                    ?disabled=${this.busy || !this.preview.message.trim()}
                    @click=${() => this.send()}
                  >
                    ${whatsappIcon}${this.t("send")}</button
                  ><button @click=${() => (this.preview = undefined)}>${this.t("cancel")}</button>
                </div>
              </section>`
            : nothing
        }
        ${this.busy ? html`<p role="status">${this.t("wait")}</p>` : nothing}${this.sent ? html`<p role="status">${this.t("accepted")}</p>` : nothing}${this.error ? html`<p class="error" role="alert">${this.t(this.error)}</p>` : nothing}
      </main>
      <footer>
        <button
          ?disabled=${!this.canEdit}
          @click=${() => {
            this.dispatchEvent(new CustomEvent("details-edit"));
            if (!this.embedded) this.close();
          }}
        >
          ${this.t("edit")}
        </button>
      </footer>
    </dialog>`;
  }
}
customElements.define("wiskey-user-details", UserDetails);
