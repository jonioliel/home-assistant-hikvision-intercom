import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import { downloadText } from "./download";
import "./user-timing";
import type { Card, Hass, Person, Station, UserTimingDraft } from "./types";

interface Settings {
  revision: number;
  idle_minutes: number;
  reauth_sensitive: boolean;
  dual_approval: boolean;
}
interface Approval {
  id: string;
  actor: string;
  approver: string | null;
  state: string;
  label: string;
  expires_at: string;
  people: { name: string; delete: boolean; fields: string[]; archive?: boolean }[];
  inventory: { label: string; status: string }[];
  impact: {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    timing: unknown;
  }[];
}
interface Transfer {
  id: string;
  kind: string;
  source_name: string;
  actor: string;
  approved_by: string | null;
  target: string;
  state: string;
  ready: boolean;
}
interface Inventory {
  id: string;
  label: string;
  status: string;
  masked_number: string;
  holder: string | null;
  holder_id: string | null;
  return_by: string | null;
  revision: number;
}
interface Preset {
  id: string;
  label: string;
  revision: number;
  data: Record<string, unknown>;
  message: string;
}
interface Reminder {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  at: string;
  revision: number;
}
interface Renewal {
  id: string;
  actor: string;
  name: string;
  reason: string;
  until: string;
  state: string;
}
interface CenterData {
  settings: Settings;
  approvals: Approval[];
  transfers: Transfer[];
  inventory: Inventory[];
  templates: Preset[];
  reminders: Reminder[];
  renewals: Renewal[];
}
interface Review {
  review_id: string;
  errors: number;
  changed: number;
  rows: { name: string; employee_no: string; action: string; error: string | null }[];
}

export class WorkflowCenter extends LitElement {
  static properties = {
    hass: { attribute: false },
    people: { attribute: false },
    stations: { attribute: false },
    groups: { attribute: false },
    fields: { attribute: false },
    picker: { type: Boolean },
    data: { state: true },
    tab: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    review: { state: true },
    preset: { state: true },
    source: { state: true },
    inventoryEdit: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
        background: transparent;
      }
      nav,
      .row,
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      nav {
        margin-bottom: 16px;
      }
      nav button[aria-current="page"] {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
      }
      article {
        background: var(--surface);
        border: 1px solid var(--divider-color);
        padding: 16px;
        border-radius: 12px;
        margin-block: 10px;
      }
      h2,
      h3,
      p {
        margin-block: 0 10px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      label {
        display: grid;
        gap: 6px;
        margin-block: 8px;
      }
      label.check {
        display: flex;
        align-items: center;
      }
      input,
      select,
      textarea {
        width: 100%;
        min-width: 0;
        color: var(--ink);
        background: var(--surface);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 10px;
        box-sizing: border-box;
      }
      input[type="checkbox"] {
        width: 20px;
        height: 20px;
      }
      textarea {
        min-height: 90px;
        resize: vertical;
      }
      .sub {
        white-space: normal;
        line-height: 1.5;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      td,
      th {
        padding: 10px;
        border-bottom: 1px solid var(--divider-color);
        text-align: start;
      }
      .error {
        color: var(--error-color, #c83f48);
      }
      .badge {
        padding: 3px 8px;
        border-radius: 6px;
        background: var(--secondary-background-color);
      }
      .list {
        display: grid;
        gap: 6px;
      }
      .short {
        max-width: 180px;
      }
      .review {
        overflow: auto;
        max-height: 360px;
      }
      @media (max-width: 600px) {
        .grid {
          grid-template-columns: 1fr;
        }
        nav button {
          flex: 1 1 120px;
        }
        .actions button {
          flex: 1;
        }
      }
    `,
  ];
  hass?: Hass;
  people: Person[] = [];
  stations: Station[] = [];
  groups: { id: string; label: string; enabled: boolean }[] = [];
  fields: { id: string; label: string; enabled: boolean; type?: string; options: string[] }[] = [];
  picker = false;
  private data?: CenterData;
  private tab = "backup";
  private busy = false;
  private error = "";
  private notice = "";
  private review?: Review;
  private backupFile = "";
  private passphrase = "";
  private importMode = "add_only";
  private mapping: Record<string, string> = {};
  private source = "";
  private target = "";
  private transferKind = "card";
  private transferValue = "";
  private sourceCards: Card[] = [];
  private inventoryEdit?: Inventory;
  private cardNo = "";
  private cardLabel = "";
  private cardStatus = "available";
  private cardDue = "";
  private cardHolder = "";
  private preset?: Preset;
  private days = 7;
  private renewUser = "";
  private renewUntil = "";
  private renewReason = "";
  private actor = "";
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private he = () => this.hass?.language?.startsWith("he");
  private text = (he: string, en: string) => (this.he() ? he : en);
  protected updated(changed: PropertyValues) {
    if (changed.has("hass") && this.actor !== this.hass?.user?.id) {
      this.requests.cancel();
      this.actor = this.hass?.user?.id ?? "";
      this.data = undefined;
      this.review = undefined;
      this.preset = undefined;
      this.sourceCards = [];
      this.passphrase = "";
      this.backupFile = "";
      this.error = "";
      this.notice = "";
      if (this.hass?.user?.is_admin) void this.load();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
    this.passphrase = "";
    this.backupFile = "";
  }
  private call<T>(command: string, data: Record<string, unknown> = {}) {
    return this.requests.run<T>({ type: `hikvision_intercom/${command}`, ...data });
  }
  private async work(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.notice = "";
    try {
      await action();
    } catch (error) {
      this.error = this.t((error as { code?: string }).code ?? "action_failed");
    } finally {
      this.busy = false;
    }
  }
  private async load() {
    await this.work(async () => {
      this.data = await this.call<CenterData>("workflows/get", { days: this.days });
    });
  }
  private async mutate(command: string, values: Record<string, unknown>) {
    await this.work(async () => {
      await this.call(command, values);
      this.data = await this.call<CenterData>("workflows/get", { days: this.days });
      this.notice = this.text("הפעולה נשמרה.", "Action saved.");
    });
  }
  private personPicker(value: string, change: (value: string) => void, label: string) {
    return html`<label
      >${label}<select
        .value=${value}
        @change=${(e: Event) => change((e.target as HTMLSelectElement).value)}
      >
        <option value="">${this.t("select_user")}</option>
        ${this.people.map((person) => html`<option value=${person.id}>${person.display_name} · ${person.employee_no}</option>`)}
      </select></label
    >`;
  }
  private async selectSource(value: string) {
    this.source = value;
    this.transferValue = "";
    this.sourceCards = [];
    if (!value) return;
    await this.work(async () => {
      const person = await this.call<Person>("users/get", { user_id: value });
      if (this.source === value) this.sourceCards = person.cards;
    });
  }
  private backup() {
    return html`<article>
      <h3>${this.text("גיבוי מוצפן ושחזור אנשים", "Encrypted backup and people restore")}</h3>
      <p class="sub">
        ${this.text("הקובץ מכיל מידע רגיש מוצפן. שמור את הסיסמה בנפרד. השחזור מייבא אנשים והרשאות לאחר סקירה; רישומי הבעלות והביטול הפעילים נשמרים. אנשים בארכיון נשמרים בקובץ המוצפן ואינם נוצרים מחדש בייבוא אנשים. גיבוי מערכת מלא משחזר גם את הארכיון וההיסטוריה. תצורת שרת, חיבורים וערכות עיצוב מגובים בגיבוי המערכת המלא.", "The encrypted file contains sensitive data. Keep its passphrase separately. Restore imports reviewed people and access while preserving active ownership and revocation records. Archived people are retained in the encrypted file and skipped by desired-people import. Full system backup restores the archive and history. Server configuration, connections and themes belong in a full system backup.")}
      </p>
      <label
        >${this.text("סיסמת גיבוי — 12 תווים לפחות", "Backup passphrase — at least 12 characters")}<input
          type="password"
          autocomplete="new-password"
          .value=${this.passphrase}
          @input=${(e: Event) => {
            this.passphrase = (e.target as HTMLInputElement).value;
            this.review = undefined;
          }}
      /></label>
      <button
        ?disabled=${this.busy}
        @click=${() =>
          void this.work(async () => {
            const result = await this.call<{ content: string; filename: string }>(
              "backups/export",
              {
                passphrase: this.passphrase,
              },
            );
            downloadText(result.content, result.filename, "application/json");
            this.passphrase = "";
            this.notice = this.text("הגיבוי הורד.", "Backup downloaded.");
          })}
      >
        ${this.text("הורדת גיבוי מוצפן", "Download encrypted backup")}
      </button>
      <hr />
      <label
        >${this.text("קובץ לשחזור", "Backup file")}<input
          type="file"
          accept=".json"
          @change=${(e: Event) =>
            void this.work(async () => {
              this.review = undefined;
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                if (file.size > 67108864) throw { code: "backup_too_large" };
                this.backupFile = await file.text();
              }
            })}
      /></label>
      <label
        >${this.text("מצב ייבוא", "Import mode")}<select
          .value=${this.importMode}
          @change=${(e: Event) => {
            this.importMode = (e.target as HTMLSelectElement).value;
            this.review = undefined;
          }}
        >
          <option value="add_only">${this.text("הוסף חדשים בלבד", "Add new people only")}</option>
          <option value="update_matching">
            ${this.text("עדכן גם משתמשים עם מספר עובד זהה", "Also update matching employee numbers")}
          </option>
        </select></label
      >
      <button
        ?disabled=${this.busy || !this.backupFile}
        @click=${() =>
          void this.work(async () => {
            this.review = await this.call<Review>("backups/preview", {
              content: this.backupFile,
              passphrase: this.passphrase,
              mode: this.importMode,
              mapping: this.mapping,
            });
            this.passphrase = "";
            this.backupFile = "";
          })}
      >
        ${this.text("בדיקת התנגשויות ותצוגה מקדימה", "Check collisions and preview")}
      </button>
      ${
        this.review
          ? html`<p>
                ${this.review.changed} ${this.text("שינויים", "changes")} · ${this.review.errors}
                ${this.text("התנגשויות", "conflicts")}
              </p>
              <div class="review">
                <table>
                  <thead>
                    <tr>
                      <th>${this.t("name")}</th>
                      <th>${this.t("employee_no")}</th>
                      <th>${this.text("פעולה", "Action")}</th>
                      <th>${this.text("תוצאה", "Result")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.review.rows.map(
                      (row) =>
                        html`<tr>
                          <td>${row.name}</td>
                          <td><bdi>${row.employee_no}</bdi></td>
                          <td>${this.t("workflow_" + row.action)}</td>
                          <td class=${row.error ? "error" : ""}>
                            ${row.error ? this.t(row.error) : "✓"}
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              <label class="check"
                ><input
                  id="restore-confirm"
                  type="checkbox"
                />${this.text("בדקתי את השינויים ואני מאשר את הייבוא", "I reviewed and approve this import")}</label
              ><button
                ?disabled=${this.busy || !!this.review.errors || !this.review.changed}
                @click=${() => {
                  if (
                    !this.renderRoot.querySelector<HTMLInputElement>("#restore-confirm")?.checked
                  ) {
                    this.error = this.t("confirmation_required");
                    return;
                  }
                  void this.work(async () => {
                    await this.call("backups/apply", {
                      review_id: this.review!.review_id,
                      confirmed: true,
                    });
                    this.review = undefined;
                    this.notice = this.text(
                      "הייבוא נשמר. הסנכרון לתחנות ממשיך ברקע.",
                      "Import saved. Station synchronization continues in the background.",
                    );
                  });
                }}
              >
                ${this.text("אישור ייבוא", "Approve import")}
              </button>`
          : nothing
      }
    </article>`;
  }
  private security() {
    const settings = this.data!.settings;
    return html`<article>
      <h3>${this.text("הגנת מסך משותף", "Shared screen protection")}</h3>
      <p class="sub">
        ${this.text("נעילה מנקה מידע אישי ומפסיקה מדיה. פתיחה דורשת סיסמת המפעיל ואימות דו־שלבי אם הוגדר. הרשאת פעולה רגישה תקפה לחמש דקות ולא מועברת לחלון אחר.", "Locking clears personal information and stops media. Unlock requires the operator's password and configured MFA. Fresh authentication for sensitive actions lasts five minutes and applies to this connection only.")}
      </p>
      <label
        >${this.text("נעילה לאחר דקות ללא פעילות (0 = כבוי)", "Idle lock minutes (0 = off)")}<input
          class="short"
          type="number"
          min="0"
          max="120"
          .value=${String(settings.idle_minutes)}
          @change=${(e: Event) => (settings.idle_minutes = Number((e.target as HTMLInputElement).value))}
      /></label>
      <label class="check"
        ><input
          type="checkbox"
          .checked=${settings.reauth_sensitive}
          @change=${(e: Event) => (settings.reauth_sensitive = (e.target as HTMLInputElement).checked)}
        />${this.text("אימות מחדש לפני פעולות רגישות", "Reauthenticate before sensitive actions")}</label
      >
      <label class="check"
        ><input
          type="checkbox"
          .checked=${settings.dual_approval}
          @change=${(e: Event) => (settings.dual_approval = (e.target as HTMLInputElement).checked)}
        />${this.text("אישור מפעיל שני לשינויי גישה, מחיקות וייבוא", "Second operator approval for access changes, deletion and import")}</label
      >
      <p class="sub">
        ${this.text("כאשר אישור כפול מופעל, פעולה שאינה נתמכת בתור האישורים נחסמת; אין מסלול שעוקף אישור באמצעות עבודה ברקע. יש לוודא שלפחות שני מנהלים פעילים זמינים.", "When dual approval is enabled, a sensitive action without an approval path is blocked. Background jobs cannot bypass approval. Ensure two active administrators are available.")}
      </p>
      <button
        ?disabled=${this.busy}
        @click=${() => void this.mutate("workflows/settings_update", { revision: settings.revision, values: { idle_minutes: settings.idle_minutes, reauth_sensitive: settings.reauth_sensitive, dual_approval: settings.dual_approval } })}
      >
        ${this.t("save")}
      </button>
    </article>`;
  }
  private approvals() {
    return html`<p class="sub">
        ${this.text("האישור קשור בדיוק לשינויים שנבדקו. שינוי בנתונים או בהרשאות לאחר הבקשה מחייב סקירה חדשה. לאחר אישור, המפעיל המבקש מפעיל את השינוי במפורש.", "Approval is bound to the reviewed changes. Changed data or access rules require a new review. After approval, the requesting operator explicitly applies the change.")}
      </p>
      ${this.data!.approvals.map(
        (item) =>
          html`<article>
            <div class="row">
              <h3>${item.label}</h3>
              <span class="badge">${this.t("workflow_" + item.state)}</span>
            </div>
            <p>${this.text("תוקף האישור", "Approval expires")}: <bdi>${item.expires_at}</bdi></p>
            <ul>
              ${item.people.map((person) => html`<li>${person.name} · ${person.archive !== undefined ? this.t(person.archive ? "archive_person" : "unarchive_person") : person.delete ? this.t("delete") : person.fields.map((field) => this.t(field)).join(", ")}</li>`)}
            </ul>
            ${item.impact?.map(
              (impact) =>
                html`<div class="grid">
                    ${[impact.before, impact.after].map(
                      (side, index) =>
                        html`<section>
                          <b
                            >${index ? this.text("לאחר השינוי", "After") : this.text("לפני השינוי", "Before")}</b
                          >${
                            side
                              ? html`<p>
                                    ${side.display_name} · ${side.employee_no} ·
                                    ${side.archived_at ? this.t("filter_archived") : side.active ? this.t("active") : this.t("inactive")}
                                  </p>
                                  <p>
                                    ${String(side.valid_from ?? "—")} →
                                    ${String(side.valid_until ?? "—")}
                                  </p>
                                  <p>
                                    ${this.text("כרטיסים", "Cards")}: ${side.card_count} · PIN:
                                    ${side.pin_configured ? "✓" : "—"}
                                  </p>
                                  ${Object.entries(
                                    (side.assignments ?? {}) as Record<
                                      string,
                                      { enabled: boolean; allowed_locks: number[] }
                                    >,
                                  )
                                    .filter(([, a]) => a.enabled)
                                    .map(
                                      ([sid, a]) =>
                                        html`<p>
                                          ${this.stations.find((station) => station.id === sid)?.name ?? sid}
                                          · ${a.allowed_locks.join(", ")}
                                        </p>`,
                                    )}`
                              : html`<p>—</p>`
                          }
                        </section>`,
                    )}
                  </div>
                  ${impact.timing !== "unchanged" ? html`<pre>${JSON.stringify(impact.timing, null, 2)}</pre>` : nothing}`,
            )}
            ${item.inventory?.map((card) => html`<p>${card.label} · ${this.t("workflow_" + card.status)}</p>`)}
            <div class="actions">
              ${["pending", "approved"].includes(item.state) && item.actor === this.hass?.user?.id ? html`<button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/withdraw", { request_id: item.id })}>${this.text("משוך בקשה", "Withdraw request")}</button>` : nothing}
              ${item.state === "pending" && item.actor !== this.hass?.user?.id ? html`<button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/decide", { request_id: item.id, approve: true })}>${this.text("אשר", "Approve")}</button><button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/decide", { request_id: item.id, approve: false })}>${this.text("דחה", "Reject")}</button>` : nothing}${item.state === "approved" && item.actor === this.hass?.user?.id ? html`<button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/apply", { request_id: item.id })}>${this.text("הפעל שינוי מאושר", "Apply approved change")}</button>` : nothing}
            </div>
          </article>`,
      )}${!this.data!.approvals.length ? html`<p>${this.text("אין בקשות אישור.", "No approval requests.")}</p>` : nothing}`;
  }
  private transfers() {
    const person = this.people.find((p) => p.id === this.source);
    return html`<article>
        <h3>${this.text("העברה מבוקרת", "Controlled transfer")}</h3>
        <p class="sub">
          ${this.text("תחילה תבוטל הזהות או הכרטיס המקוריים. ההשלמה זמינה רק אחרי אישור הביטול מכל התחנות. במיזוג נשמרות הרשאות משתמש היעד; לא מאחדים דלתות וזמנים. ביטול תהליך אינו משחזר גישה שבוטלה.", "First the source identity or card is revoked. Completion requires confirmed removal from all stations. A merge preserves target access; doors and schedules are not combined. Cancelling never restores revoked access.")}
        </p>
        <div class="grid">
          <label
            >${this.text("סוג פעולה", "Operation")}<select
              .value=${this.transferKind}
              @change=${(e: Event) => {
                this.transferKind = (e.target as HTMLSelectElement).value;
                this.transferValue = "";
                this.requestUpdate();
              }}
            >
              <option value="card">${this.text("העברת כרטיס", "Transfer card")}</option>
              <option value="identity">
                ${this.text("החלפת מספר עובד", "Change employee number")}
              </option>
              <option value="merge">
                ${this.text("מיזוג למשתמש אחר", "Merge into another person")}
              </option>
            </select></label
          >${this.personPicker(this.source, (value) => void this.selectSource(value), this.text("משתמש מקור", "Source person"))}${this.transferKind !== "identity" ? this.personPicker(this.target, (value) => (this.target = value), this.text("משתמש יעד", "Target person")) : html`<label>${this.t("employee_no")}<input .value=${this.transferValue} @input=${(e: Event) => (this.transferValue = (e.target as HTMLInputElement).value)} /></label>`}
        </div>
        ${
          this.transferKind === "card"
            ? html`<label
                >${this.text("כרטיס להעברה", "Card to transfer")}<select
                  .value=${this.transferValue}
                  @change=${(e: Event) => (this.transferValue = (e.target as HTMLSelectElement).value)}
                >
                  <option value="">${this.t("select")}</option>
                  ${this.sourceCards.map((card) => html`<option value=${card.id}>${card.label} ${card.masked_number}</option>`)}
                </select></label
              >`
            : nothing
        }
        <label class="check"
          ><input
            id="transfer-confirm"
            type="checkbox"
          />${this.text("בדקתי את המקור והיעד ואני מאשר את הביטול וההעברה", "I reviewed source and target and approve revocation and transfer")}</label
        ><button
          ?disabled=${this.busy || !person}
          @click=${() => {
            if (!this.renderRoot.querySelector<HTMLInputElement>("#transfer-confirm")?.checked) {
              this.error = this.t("confirmation_required");
              return;
            }
            void this.mutate("workflows/transfer_start", {
              kind: this.transferKind,
              source: this.source,
              target: this.transferKind === "identity" ? "" : this.target,
              revision: person!.revision,
              value: this.transferValue,
              confirmed: true,
            });
          }}
        >
          ${this.text("תחילת העברה", "Start transfer")}
        </button>
      </article>
      ${this.data!.transfers.map(
        (item) =>
          html`<article>
            <h3>${item.source_name} · ${this.t("workflow_" + item.kind)}</h3>
            <p>
              ${this.t("workflow_" + item.state)} ·
              ${item.state === "awaiting_revocation" ? (item.ready ? this.text("הביטול אושר, ניתן להשלים", "Revocation confirmed; ready to complete") : this.text("ממתין לאישור ביטול מהתחנות", "Waiting for station revocation confirmation")) : nothing}
            </p>
            <div class="actions">
              ${["awaiting_approval", "awaiting_revocation"].includes(item.state) && item.actor !== this.hass?.user?.id && !item.approved_by ? html`<button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/transfer_review", { transfer_id: item.id, approve: true })}>${this.text("אשר העברה", "Approve transfer")}</button><button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/transfer_review", { transfer_id: item.id, approve: false })}>${this.text("דחה", "Reject")}</button>` : nothing}
              ${item.actor === this.hass?.user?.id && item.state === "approved" ? html`<button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/transfer_begin", { transfer_id: item.id })}>${this.text("הפעל ביטול מקור", "Revoke source")}</button>` : nothing}
              ${item.actor === this.hass?.user?.id && item.state === "awaiting_revocation" ? html`<button ?disabled=${this.busy || !item.ready || (this.data!.settings.dual_approval && !item.approved_by)} @click=${() => void this.mutate("workflows/transfer_finish", { transfer_id: item.id, cancel: false, confirmed: true })}>${this.text("השלם העברה", "Complete transfer")}</button><button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/transfer_recheck", { transfer_id: item.id })}>${this.text("אשר מחדש את פרטי היעד", "Review changed destination")}</button>` : nothing}
              ${item.actor === this.hass?.user?.id && ["awaiting_revocation", "awaiting_approval", "approved"].includes(item.state) ? html`<button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/transfer_finish", { transfer_id: item.id, cancel: true, confirmed: true })}>${this.t("cancel")}</button>` : nothing}
            </div>
          </article>`,
      )}`;
  }
  private inventory() {
    return html`<article>
        <h3>
          ${this.text("מלאי כרטיסים ומחזיקים זמניים", "Card inventory and temporary holders")}
        </h3>
        <p class="sub">
          ${this.text("סימון אבוד או חסום מבטל את הכרטיס בפועל וממתין לסנכרון. מועד החזרה הוא תזכורת תפעולית; הוא אינו תחליף להגבלת תוקף המשתמש בתחנה.", "Lost or blocked cards are revoked and await synchronization. Return date is an operational reminder, not a replacement for station-enforced person validity.")}
        </p>
        <div class="grid">
          <label
            >${this.text("מספר כרטיס", "Card number")}<input
              autocomplete="off"
              ?disabled=${!!this.inventoryEdit}
              .value=${this.cardNo}
              @input=${(e: Event) => (this.cardNo = (e.target as HTMLInputElement).value)} /></label
          ><label
            >${this.t("name")}<input
              .value=${this.cardLabel}
              @input=${(e: Event) => (this.cardLabel = (e.target as HTMLInputElement).value)} /></label
          ><label
            >${this.text("מצב", "Status")}<select
              .value=${this.cardStatus}
              @change=${(e: Event) => (this.cardStatus = (e.target as HTMLSelectElement).value)}
            >
              ${["available", "temporary", "lost", "blocked"].map((status) => html`<option value=${status}>${this.t("workflow_" + status)}</option>`)}
            </select></label
          ><label
            >${this.text("מועד החזרה", "Return date")}<input
              type="datetime-local"
              .value=${this.cardDue}
              @change=${(e: Event) => (this.cardDue = (e.target as HTMLInputElement).value)}
          /></label>
        </div>
        <button
          ?disabled=${this.busy}
          @click=${() =>
            void this.work(async () => {
              await this.call("workflows/inventory_save", {
                card_id: this.inventoryEdit?.id ?? "",
                revision: this.inventoryEdit?.revision ?? 0,
                values: {
                  card_no: this.cardNo,
                  label: this.cardLabel,
                  status: this.cardStatus,
                  return_by: this.cardDue ? new Date(this.cardDue).toISOString() : null,
                },
              });
              this.inventoryEdit = undefined;
              this.cardNo = "";
              this.cardLabel = "";
              this.data = await this.call<CenterData>("workflows/get", { days: this.days });
            })}
        >
          ${this.t("save")}</button
        ><button
          @click=${() => {
            this.inventoryEdit = undefined;
            this.cardNo = "";
            this.cardLabel = "";
            this.cardStatus = "available";
            this.requestUpdate();
          }}
        >
          ${this.text("כרטיס חדש", "New card")}</button
        >${this.personPicker(this.cardHolder, (value) => (this.cardHolder = value), this.text("משתמש לשיוך זמני", "Temporary holder"))}
      </article>
      ${this.data!.inventory.map(
        (item) =>
          html`<article>
            <div class="row">
              <strong>${item.label}</strong><bdi>${item.masked_number}</bdi
              ><span>${this.t("workflow_" + item.status)}</span>
            </div>
            <p>
              ${item.holder ?? this.text("ללא מחזיק", "Unassigned")}
              ${item.return_by ? html`· <bdi>${item.return_by}</bdi>` : nothing}
            </p>
            <div class="actions">
              <button
                @click=${() => {
                  this.inventoryEdit = item;
                  this.cardLabel = item.label;
                  this.cardNo = "";
                  this.cardStatus = item.status;
                  this.cardDue = item.return_by ? item.return_by.slice(0, 16) : "";
                  this.requestUpdate();
                }}
              >
                ${this.t("edit")}</button
              >${
                !item.holder && ["available", "temporary"].includes(item.status)
                  ? html`<button
                      ?disabled=${this.busy || !this.cardHolder}
                      @click=${() => {
                        const person = this.people.find((p) => p.id === this.cardHolder);
                        if (person)
                          void this.mutate("workflows/inventory_issue", {
                            card_id: item.id,
                            user_id: person.id,
                            revision: person.revision,
                            confirmed: true,
                          });
                      }}
                    >
                      ${this.text("שייך למחזיק שנבחר", "Assign to selected holder")}
                    </button>`
                  : nothing
              }
              ${
                item.holder
                  ? html`<button
                      ?disabled=${this.busy}
                      @click=${() => void this.mutate("workflows/inventory_return", { card_id: item.id, revision: item.revision, delete: false, confirmed: true })}
                    >
                      ${this.text("החזר למלאי ובטל שיוך", "Return to inventory and revoke")}
                    </button>`
                  : html`<button
                      ?disabled=${this.busy}
                      @click=${() => {
                        if (
                          confirm(
                            this.text(
                              "למחוק כרטיס לא משויך מהמלאי?",
                              "Delete this unassigned inventory card?",
                            ),
                          )
                        )
                          void this.mutate("workflows/inventory_return", {
                            card_id: item.id,
                            revision: item.revision,
                            delete: true,
                            confirmed: true,
                          });
                      }}
                    >
                      ${this.t("delete")}
                    </button>`
              }
            </div>
          </article>`,
      )}`;
  }
  private newPreset() {
    this.preset = {
      id: "",
      revision: 0,
      label: "",
      data: { profile: {}, group_ids: [], assignments: {} },
      message: "",
    };
  }
  private presets() {
    const preset = this.preset;
    return html`<p class="sub">
        ${this.text("תבנית ממלאת טיוטת משתמש בלבד. יש לבדוק, לשמור ולסנכרן. לא נשמרים בה PIN או כרטיסים.", "A preset fills a person draft only. Review, save and synchronize it. PINs and cards are never stored in a preset.")}
      </p>
      ${!this.picker ? html`<button @click=${() => this.newPreset()}>${this.text("תבנית חדשה", "New preset")}</button>` : nothing}${this.data!.templates.map(
        (item) =>
          html`<article>
            <h3>${item.label}</h3>
            <div class="actions">
              <button
                @click=${() => this.dispatchEvent(new CustomEvent("staff-template-apply", { detail: structuredClone(item), bubbles: true, composed: true }))}
              >
                ${this.text("השתמש בתבנית", "Use preset")}</button
              >${!this.picker ? html`<button @click=${() => (this.preset = structuredClone(item))}>${this.t("edit")}</button><button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/template_delete", { template_id: item.id, revision: item.revision })}>${this.t("delete")}</button>` : nothing}
            </div>
          </article>`,
      )}${
        preset
          ? html`<article>
              <label
                >${this.t("name")}<input
                  .value=${preset.label}
                  @input=${(e: Event) => (preset.label = (e.target as HTMLInputElement).value)}
              /></label>
              <h3>${this.text("קבוצות", "Groups")}</h3>
              ${this.groups
                .filter((g) => g.enabled)
                .map(
                  (group) =>
                    html`<label class="check"
                      ><input
                        type="checkbox"
                        .checked=${(preset.data.group_ids as string[]).includes(group.id)}
                        @change=${(e: Event) => {
                          const ids = new Set(preset.data.group_ids as string[]);
                          (e.target as HTMLInputElement).checked
                            ? ids.add(group.id)
                            : ids.delete(group.id);
                          preset.data.group_ids = [...ids];
                        }}
                      />${group.label}</label
                    >`,
                )}
              <h3>${this.text("דלתות", "Doors")}</h3>
              ${this.stations
                .filter((s) => s.lock_enabled)
                .map(
                  (station) =>
                    html`<div class="row">
                      <span>${station.name}</span>${station.integrated_locks.map((lock) => {
                        const assignments = preset.data.assignments as Record<
                          string,
                          { allowed_locks: number[] }
                        >;
                        return html`<label class="check"
                          ><input
                            type="checkbox"
                            .checked=${!!assignments[station.id]?.allowed_locks.includes(lock.physical_index)}
                            @change=${(e: Event) => {
                              const locks = new Set(assignments[station.id]?.allowed_locks ?? []);
                              (e.target as HTMLInputElement).checked
                                ? locks.add(lock.physical_index)
                                : locks.delete(lock.physical_index);
                              if (locks.size)
                                assignments[station.id] = { allowed_locks: [...locks] };
                              else delete assignments[station.id];
                            }}
                          />${lock.name}</label
                        >`;
                      })}
                    </div>`,
                )}
              <h3>${this.text("שדות מותאמים", "Custom fields")}</h3>
              ${this.fields.filter((f) => f.enabled).map((field) => html`<label>${field.label}<input .value=${(preset.data.profile as Record<string, string>)[field.id] ?? ""} @input=${(e: Event) => ((preset.data.profile as Record<string, string>)[field.id] = (e.target as HTMLInputElement).value)} /></label>`)}<label
                class="check"
                ><input
                  type="checkbox"
                  .checked=${!!preset.data.access_timing_policy}
                  @change=${(e: Event) => {
                    preset.data.access_timing_policy = (e.target as HTMLInputElement).checked
                      ? {
                          mode: "ha",
                          bindings: {},
                          schedule: {
                            mode: "weekly",
                            timezone: "Asia/Jerusalem",
                            days: ["Monday"],
                            dates: [],
                            periods: [{ start: "09:00", end: "17:00" }],
                          },
                        }
                      : null;
                    this.requestUpdate();
                  }}
                />${this.text("לוח ימים ושעות", "Days and hours")}</label
              >${
                preset.data.access_timing_policy
                  ? html`<hikvision-user-timing
                      .value=${(preset.data.access_timing_policy as { schedule: UserTimingDraft }).schedule}
                      .language=${this.hass?.language}
                      enforcement="ha"
                      .canEnforce=${true}
                      @timing-change=${(e: CustomEvent<UserTimingDraft>) => {
                        (
                          preset.data.access_timing_policy as { schedule: UserTimingDraft }
                        ).schedule = e.detail;
                        this.requestUpdate();
                      }}
                    ></hikvision-user-timing>`
                  : nothing
              }<label
                >${this.text("הודעת תבנית — ניתנת לעריכה לפני שליחה", "Preset message — editable before sending")}<textarea
                  .value=${preset.message}
                  @input=${(e: Event) => (preset.message = (e.target as HTMLTextAreaElement).value)}
                ></textarea></label
              ><button
                ?disabled=${this.busy}
                @click=${() =>
                  void this.work(async () => {
                    await this.call("workflows/template_save", {
                      template_id: preset.id,
                      revision: preset.revision,
                      values: { label: preset.label, data: preset.data, message: preset.message },
                    });
                    this.preset = undefined;
                    this.data = await this.call<CenterData>("workflows/get", { days: this.days });
                  })}
              >
                ${this.t("save")}</button
              ><button @click=${() => (this.preset = undefined)}>${this.t("cancel")}</button>
            </article>`
          : nothing
      }`;
  }
  private reminders() {
    return html`<p class="sub">
        ${this.text("התזכורות נוצרות לפי תוקף האנשים. שום הודעה אינה נשלחת אוטומטית. פתיחת הודעה מציגה אותה לעריכה ולאישור שליחה.", "Reminders follow person validity. Nothing is sent automatically. Opening a message presents it for editing and explicit sending.")}
      </p>
      <label
        >${this.text("ימים קדימה", "Look ahead days")}<input
          type="number"
          min="1"
          max="365"
          .value=${String(this.days)}
          @change=${(e: Event) => {
            this.days = Number((e.target as HTMLInputElement).value);
            void this.load();
          }} /></label
      >${this.data!.reminders.map(
        (item) =>
          html`<article>
            <h3>${item.name}</h3>
            <p>${this.t("workflow_" + item.kind)} · <bdi>${item.at}</bdi></p>
            <div class="actions">
              <button
                @click=${() => this.dispatchEvent(new CustomEvent("reminder-message", { detail: item, bubbles: true, composed: true }))}
              >
                ${this.text("הכן הודעה לאישור", "Prepare message for review")}</button
              ><button
                ?disabled=${this.busy}
                @click=${() => void this.mutate("workflows/reminder_action", { reminder_id: item.id, action: "acknowledge" })}
              >
                ${this.text("טופל", "Acknowledge")}</button
              ><button
                ?disabled=${this.busy}
                @click=${() => void this.mutate("workflows/reminder_action", { reminder_id: item.id, action: "snooze" })}
              >
                ${this.text("דחה למחר", "Snooze until tomorrow")}
              </button>
            </div>
          </article>`,
      )}`;
  }
  private renewals() {
    return html`<article>
        <h3>${this.text("בקשת חידוש לאישור אחראי", "Renewal request for owner approval")}</h3>
        <p class="sub">
          ${this.text("הבקשה אינה מרחיבה דלתות או משנה לוח שבועי. מפעיל אחר מאשר את הארכת התוקף. אפשר להגיש אותה גם דרך ממשק החיבור החיצוני בהרשאת עריכת משתמש.", "A request never expands doors or changes weekly hours. Another operator approves the validity extension. An authorized external client can also submit it.")}
        </p>
        ${this.personPicker(this.renewUser, (value) => (this.renewUser = value), this.t("name"))}<label
          >${this.t("valid_until")}<input
            type="datetime-local"
            .value=${this.renewUntil}
            @change=${(e: Event) => (this.renewUntil = (e.target as HTMLInputElement).value)} /></label
        ><label
          >${this.text("סיבת החידוש", "Reason")}<input
            .value=${this.renewReason}
            @input=${(e: Event) => (this.renewReason = (e.target as HTMLInputElement).value)} /></label
        ><button
          ?disabled=${this.busy || !this.renewUser || !this.renewUntil}
          @click=${() => {
            const person = this.people.find((p) => p.id === this.renewUser);
            if (person)
              void this.mutate("workflows/renew_request", {
                user_id: person.id,
                revision: person.revision,
                until: new Date(this.renewUntil).toISOString(),
                reason: this.renewReason,
              });
          }}
        >
          ${this.text("שלח בקשה", "Submit request")}
        </button>
      </article>
      ${this.data!.renewals.map(
        (item) =>
          html`<article>
            <h3>${item.name}</h3>
            <p>${item.reason} · <bdi>${item.until}</bdi> · ${this.t("workflow_" + item.state)}</p>
            ${item.state === "pending" && item.actor !== this.hass?.user?.id ? html`<div class="actions"><button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/renew_decide", { request_id: item.id, approve: true })}>${this.text("אשר חידוש", "Approve renewal")}</button><button ?disabled=${this.busy} @click=${() => void this.mutate("workflows/renew_decide", { request_id: item.id, approve: false })}>${this.text("דחה", "Reject")}</button></div>` : nothing}
          </article>`,
      )}`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    if (this.picker) return this.data ? this.presets() : nothing;
    return html`<section dir=${this.he() ? "rtl" : "ltr"}>
      <div class="row">
        <h2>${this.text("ניהול מתקדם", "Advanced operations")}</h2>
        <button ?disabled=${this.busy} @click=${() => void this.load()}>
          ${this.t("refresh")}
        </button>
      </div>
      <nav>
        ${[
          "backup",
          "security",
          "approvals",
          "transfers",
          "inventory",
          "presets",
          "reminders",
          "renewals",
        ].map(
          (tab) =>
            html`<button
              aria-current=${this.tab === tab ? "page" : nothing}
              @click=${() => {
                this.tab = tab;
                this.error = "";
                this.review = undefined;
                this.passphrase = "";
                this.requestUpdate();
              }}
            >
              ${this.t("workflow_tab_" + tab)}
            </button>`,
        )}
      </nav>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.notice ? html`<p role="status">${this.notice}</p>` : nothing}${!this.data ? html`<p>${this.t("loading")}</p>` : this.tab === "backup" ? this.backup() : this.tab === "security" ? this.security() : this.tab === "approvals" ? this.approvals() : this.tab === "transfers" ? this.transfers() : this.tab === "inventory" ? this.inventory() : this.tab === "presets" ? this.presets() : this.tab === "reminders" ? this.reminders() : this.renewals()}
    </section>`;
  }
}
customElements.define("wiskey-workflow-center", WorkflowCenter);
