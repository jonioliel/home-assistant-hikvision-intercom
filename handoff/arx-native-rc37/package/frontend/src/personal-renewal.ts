import { LitElement, css, html, nothing } from "lit";
import type { Hass } from "./types";
import { ScopedRequests } from "./request";
import { fromLocalInput, formatTime, type DisplayZone } from "./time";
import "./reauth";
interface OwnRequest {
  id: string;
  until: string;
  reason: string;
  state: string;
  created_at: string;
}
interface OwnAccess {
  linked: boolean;
  name?: string;
  revision?: number;
  active?: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
  can_request?: boolean;
  requests?: OwnRequest[];
  timezone: string;
}
export class WiskeyPersonalRenewal extends LitElement {
  static properties = {
    hass: { attribute: false },
    _data: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _until: { state: true },
    _reason: { state: true },
    _confirmed: { state: true },
    _uncertain: { state: true },
    _locked: { state: true },
    _reauth: { state: true },
  };
  static styles = css`
    :host {
      display: block;
      color: var(--ink, var(--primary-text-color, #172b35));
      font-family: inherit;
    }
    main {
      max-width: 780px;
      margin: 24px auto;
      padding: 0 16px;
      box-sizing: border-box;
    }
    section,
    article {
      padding: 20px;
      border: 1px solid var(--line, #d6dfe1);
      border-radius: 14px;
      background: var(--surface, var(--card-background-color, #fff));
      margin: 12px 0;
    }
    h1 {
      margin: 0;
      font-size: 26px;
    }
    h2 {
      font-size: 19px;
      margin: 0 0 12px;
    }
    p {
      line-height: 1.6;
    }
    .hint {
      color: var(--muted, var(--secondary-text-color, #63747b));
    }
    .head,
    .row {
      display: flex;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
    }
    dl {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 0;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    label {
      display: block;
      margin: 12px 0;
    }
    input:not([type="checkbox"]),
    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 6px;
      padding: 12px;
      border: 1px solid var(--line, #d6dfe1);
      border-radius: 8px;
      font: inherit;
      background: var(--surface, var(--card-background-color, #fff));
      color: inherit;
    }
    textarea {
      min-height: 84px;
      resize: vertical;
    }
    button {
      font: inherit;
      padding: 10px 16px;
      border-radius: 8px;
      border: 1px solid var(--line, #d6dfe1);
      background: var(--surface, var(--card-background-color, #fff));
      color: inherit;
      cursor: pointer;
    }
    .primary {
      background: var(--accent, #377e72);
      color: white;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .error {
      color: var(--error-color, #ac2835);
    }
    .badge {
      border-radius: 7px;
      padding: 5px 9px;
      background: var(--soft, #e8f3ef);
    }
    .check {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .check input {
      margin-top: 5px;
    }
    :focus-visible {
      outline: 3px solid var(--accent, #377e72);
      outline-offset: 3px;
    }
    @media (max-width: 500px) {
      main {
        margin: 16px auto;
      }
      section,
      article {
        padding: 16px;
      }
      dl {
        grid-template-columns: 1fr;
      }
      dd {
        margin-bottom: 8px;
      }
    }
  `;
  hass?: Hass;
  private _data?: OwnAccess;
  private _busy = false;
  private _error = "";
  private _until = "";
  private _reason = "";
  private _confirmed = false;
  private _uncertain = false;
  private _locked = false;
  private _reauth = false;
  private key = "";
  private signature = "";
  private epoch = 0;
  private identity = "";
  private connection?: Hass["connection"];
  private scope = new ScopedRequests(
    () => this.hass,
    (hass) => !!hass.user,
  );
  private disconnected = () => {
    this.reset();
    this._error = this.text(
      "Connection lost. Refresh after reconnecting.",
      "החיבור אבד. רענן לאחר התחברות מחדש.",
    );
  };
  connectedCallback() {
    super.connectedCallback();
    if (this.hass) this.attach();
  }
  disconnectedCallback() {
    this.connection?.removeEventListener?.("disconnected", this.disconnected);
    this.reset();
    super.disconnectedCallback();
  }
  protected updated(changed: Map<string, unknown>) {
    if (
      changed.has("hass") &&
      (this.identity !== this.hass?.user?.id || this.connection !== this.hass?.connection)
    )
      this.attach();
  }
  private reset() {
    this.epoch++;
    this.scope.cancel();
    this._data = undefined;
    this._until = "";
    this._reason = "";
    this._confirmed = false;
    this._uncertain = false;
    this._busy = false;
    this.key = "";
    this.signature = "";
  }
  private attach() {
    this.connection?.removeEventListener?.("disconnected", this.disconnected);
    this.reset();
    this.identity = this.hass?.user?.id ?? "";
    this.connection = this.hass?.connection;
    this.connection?.addEventListener?.("disconnected", this.disconnected);
    void this.load();
  }
  private text(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  private get zone(): DisplayZone {
    return { kind: "iana", name: this._data?.timezone || "UTC" };
  }
  private time(value?: string | null) {
    return formatTime(value, this.hass?.language, this.zone);
  }
  private status(state: string) {
    const labels: Record<string, [string, string]> = {
      pending: ["Awaiting approval", "ממתינה לאישור"],
      approved: ["Approved", "אושרה"],
      rejected: ["Rejected", "נדחתה"],
      cancelled: ["Cancelled", "בוטלה"],
      stale: ["Access changed; request is outdated", "פרטי ההרשאה השתנו; הבקשה אינה עדכנית"],
      expired: ["Request expired", "הבקשה פגה"],
    };
    return labels[state] ? this.text(...labels[state]) : this.text("Unavailable", "לא זמין");
  }
  private error(error: unknown) {
    const code = (error as { code?: string; message?: string }).code || (error as Error).message;
    if (code === "unauthorized") this.reset();
    if (code === "screen_locked") {
      this.reset();
      this._locked = true;
      return;
    }
    if (code === "reauth_required") {
      this._reauth = true;
      return;
    }
    const labels: Record<string, [string, string]> = {
      revision_conflict: [
        "Access changed. Refresh and review it.",
        "ההרשאה השתנתה. רענן ובדוק שוב.",
      ],
      renewal_already_pending: [
        "A request already awaits approval. Refresh to see it.",
        "כבר קיימת בקשה שממתינה לאישור. רענן להצגתה.",
      ],
      invalid_validity: [
        "Choose a future date later than the current expiry.",
        "בחר תאריך עתידי המאוחר מהתוקף הנוכחי.",
      ],
      clock_ambiguous: [
        "This time occurs twice when the clock changes. Choose another time.",
        "השעה מופיעה פעמיים במעבר שעון. בחר שעה אחרת.",
      ],
      clock_nonexistent: [
        "This time does not exist when the clock changes.",
        "השעה אינה קיימת במעבר שעון. בחר שעה אחרת.",
      ],
      renewal_identity_unlinked: [
        "Your account is not linked. Contact an administrator.",
        "החשבון אינו משויך. פנה למנהל.",
      ],
      unauthorized: [
        "Access is unavailable. Contact an administrator.",
        "הגישה אינה זמינה. פנה למנהל.",
      ],
    };
    this._error = labels[code || ""]
      ? this.text(...labels[code!])
      : this.text(
          "The operation was not confirmed. Refresh before trying again.",
          "הפעולה לא אושרה. רענן לפני ניסיון נוסף.",
        );
  }
  private async run(command: string, extra: Record<string, unknown> = {}) {
    return this.scope.run<OwnAccess>({
      type: `hikvision_intercom/renewal/${command}`,
      api_contract: 1,
      ...extra,
    });
  }
  private async load() {
    if (this._busy || !this.hass?.user) return;
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    try {
      const data = await this.run("self");
      if (epoch !== this.epoch) return;
      this._data = data;
      this._uncertain = false;
      this._confirmed = false;
    } catch (error) {
      if (epoch === this.epoch) this.error(error);
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private async send() {
    if (this._busy || !this._confirmed || this._uncertain || !this._data?.can_request) return;
    let until: string | null;
    try {
      until = fromLocalInput(this._until, this.zone);
      if (!until || !this._reason.trim()) throw { code: "invalid_fields" };
    } catch (error) {
      this.error(error);
      return;
    }
    const signature = JSON.stringify([this._data.revision, until, this._reason.trim()]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.key = crypto.randomUUID();
    }
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    try {
      const data = await this.run("request", {
        revision: this._data.revision,
        until,
        reason: this._reason.trim(),
        request_key: this.key,
      });
      if (epoch !== this.epoch) return;
      this._data = data;
      this._until = "";
      this._reason = "";
      this._confirmed = false;
      this.key = "";
      this.signature = "";
    } catch (error) {
      if (epoch === this.epoch) {
        this._uncertain = true;
        this.error(error);
      }
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private async cancel(id: string) {
    if (
      this._busy ||
      !window.confirm(this.text("Cancel this renewal request?", "לבטל את בקשת החידוש הזו?"))
    )
      return;
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    try {
      const data = await this.run("cancel", { request_id: id });
      if (epoch === this.epoch) this._data = data;
    } catch (error) {
      if (epoch === this.epoch) {
        this._uncertain = true;
        this.error(error);
      }
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  render() {
    if (this._locked || this._reauth)
      return html`<wiskey-reauth
        .hass=${this.hass}
        .locked=${this._locked}
        @reauth-cancel=${() => (this._reauth = false)}
        @reauthenticated=${() => {
          this._locked = false;
          this._reauth = false;
          void this.load();
        }}
      ></wiskey-reauth>`;
    const data = this._data,
      pending = data?.requests?.some((r) => r.state === "pending");
    return html`<main dir=${this.hass?.language?.startsWith("he") ? "rtl" : "ltr"}>
      <div class="head">
        <h1>${this.text("My access", "ההרשאה שלי")}</h1>
        <button ?disabled=${this._busy} @click=${() => this.load()}>
          ${this.text("Refresh", "רענון")}
        </button>
      </div>
      <p class="hint">
        ${this.text("A renewal request requires approval. Submitting it does not extend access.", "בקשת חידוש מחייבת אישור אחראי. שליחתה אינה מאריכה את ההרשאה.")}
      </p>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}${
        !data
          ? html`<p role="status">
              ${this._busy ? this.text("Loading…", "טוען…") : this.text("Refresh to load your access.", "רענן לטעינת ההרשאה שלך.")}
            </p>`
          : !data.linked
            ? html`<section>
                <h2>${this.text("Account not linked", "החשבון עדיין אינו משויך")}</h2>
                <p>
                  ${this.text("Ask an administrator to link your personal account to your access record.", "בקש ממנהל לשייך את חשבונך האישי לרשומת ההרשאה שלך.")}
                </p>
              </section>`
            : html` <section>
                  <h2>${data.name}</h2>
                  <dl>
                    <dt>${this.text("Status", "מצב")}</dt>
                    <dd>
                      ${data.active ? this.text("Active", "פעיל") : this.text("Inactive", "לא פעיל")}
                    </dd>
                    <dt>${this.text("Current expiry", "תוקף נוכחי")}</dt>
                    <dd>
                      ${data.valid_until ? this.time(data.valid_until) : this.text("No expiry date", "ללא תאריך תפוגה")}
                    </dd>
                  </dl>
                </section>
                ${
                  data.can_request && !pending
                    ? html`<section>
                        <h2>${this.text("Request an extension", "בקשת הארכת תוקף")}</h2>
                        <p class="hint">
                          ${this.text("Times use the facility timezone:", "השעות לפי אזור הזמן של האתר:")}
                          <bdi>${data.timezone}</bdi>
                        </p>
                        <label
                          >${this.text("Requested expiry", "תוקף מבוקש")}<input
                            type="datetime-local"
                            dir="ltr"
                            .value=${this._until}
                            ?disabled=${this._busy || this._uncertain}
                            @input=${(e: Event) => {
                              this._until = (e.target as HTMLInputElement).value;
                              this._confirmed = false;
                            }} /></label
                        ><label
                          >${this.text("Reason", "סיבת הבקשה")}<textarea
                            maxlength="240"
                            .value=${this._reason}
                            ?disabled=${this._busy || this._uncertain}
                            @input=${(e: Event) => {
                              this._reason = (e.target as HTMLTextAreaElement).value;
                              this._confirmed = false;
                            }}
                          ></textarea></label
                        ><label class="check"
                          ><input
                            type="checkbox"
                            .checked=${this._confirmed}
                            ?disabled=${this._busy || this._uncertain}
                            @change=${(e: Event) => (this._confirmed = (e.target as HTMLInputElement).checked)}
                          /><span
                            >${this.text("I reviewed the requested date and reason. Send them for approval.", "בדקתי את התאריך והסיבה. אני מבקש לשלוח אותם לאישור.")}</span
                          ></label
                        ><button
                          class="primary"
                          ?disabled=${this._busy || this._uncertain || !this._confirmed || !this._until || !this._reason.trim()}
                          @click=${() => this.send()}
                        >
                          ${this.text("Send request", "שלח בקשה")}
                        </button>
                      </section>`
                    : html`<p class="hint">
                        ${pending ? this.text("A request is awaiting approval.", "בקשה ממתינה לאישור.") : this.text("Renewal is unavailable for inactive or unlimited access. Contact an administrator.", "חידוש אינו זמין להרשאה לא פעילה או ללא תפוגה. פנה למנהל.")}
                      </p>`
                }
                <section>
                  <h2>${this.text("My requests", "הבקשות שלי")}</h2>
                  ${
                    !data.requests?.length
                      ? html`<p class="hint">${this.text("No requests", "אין בקשות")}</p>`
                      : data.requests.map(
                          (r) =>
                            html`<article>
                              <div class="row">
                                <strong>${this.time(r.until)}</strong
                                ><span class="badge">${this.status(r.state)}</span>
                              </div>
                              <p>${r.reason}</p>
                              <p class="hint">
                                ${this.text("Submitted:", "נשלחה:")} ${this.time(r.created_at)}
                              </p>
                              ${r.state === "pending" || r.state === "stale" || r.state === "expired" ? html`<button ?disabled=${this._busy || this._uncertain} @click=${() => this.cancel(r.id)}>${this.text("Cancel request", "בטל בקשה")}</button>` : nothing}
                            </article>`,
                        )
                  }
                </section>`
      }
    </main>`;
  }
}
customElements.define("wiskey-personal-renewal", WiskeyPersonalRenewal);
class WiskeyRenewalPanel extends WiskeyPersonalRenewal {}
customElements.define("wiskey-renewal-panel", WiskeyRenewalPanel);
