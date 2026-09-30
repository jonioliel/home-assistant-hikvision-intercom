import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";
import { DataQuality } from "./data-quality";
interface Receipt {
  id: string;
  actor: string;
  at: string;
  due_at: string;
  decision: string;
  reason: string;
  cadence_days: number;
}
interface Central {
  active: boolean;
  archived: boolean;
  granted: boolean;
  valid_from: string | null;
  valid_until: string | null;
  timing_mode: string;
  schedule: {
    mode?: string;
    timezone?: string;
    days?: string[];
    dates?: string[];
    periods?: { start: string; end: string }[];
  } | null;
}
interface Row {
  user_id: string;
  display_name: string;
  person_revision: number;
  status: string;
  central: Central;
  latest: Receipt | null;
  sync_state: string;
}
interface Report {
  snapshot: string;
  stale: boolean;
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  previous_offset: number | null;
  records: Row[];
  summary: Record<string, number>;
}
interface Preview {
  user_id: string;
  station_id: string;
  lock_id: number;
  person_revision: number;
  fingerprint: string;
  latest_id: string;
  central: Central;
  history: Receipt[];
}
const copy: Record<string, [string, string]> = {
  title: ["Periodic access reviews", "ביקורת הרשאות תקופתית"],
  intro: [
    "Review one selected door. Recording a decision never grants or revokes access.",
    "סקירת הרשאות לדלת שנבחרה. תיעוד החלטה אינו מעניק או מבטל גישה.",
  ],
  station: ["Station", "תחנה"],
  door: ["Door", "דלת"],
  status: ["Review status", "מצב הביקורת"],
  all: ["All", "הכול"],
  pending: ["Not reviewed", "טרם נבדק"],
  due: ["Review due", "מועד ביקורת הגיע"],
  stale: ["Access changed", "ההרשאות השתנו"],
  completed: ["Reviewed", "נבדק"],
  followup: ["Follow-up needed", "דורש טיפול"],
  archived: ["Archived person", "משתמש בארכיון"],
  review: ["Review selected door", "סקור את הדלת"],
  decision: ["Decision", "החלטה"],
  keep: ["Reviewed; keep current policy", "נבדק — להשאיר את המדיניות הנוכחית"],
  reason: ["Review notes", "הערות הביקורת"],
  cadence: ["Next review in days", "ביקורת הבאה בעוד ימים"],
  next_due: ["Next review", "הביקורת הבאה"],
  confirm: [
    "I reviewed the policy for this person and selected door",
    "בדקתי את המדיניות לאדם ולדלת שנבחרה",
  ],
  record: ["Record review", "תעד ביקורת"],
  success: ["Review recorded. Access was not changed.", "הביקורת נשמרה. הרשאות הגישה לא שונו."],
  history: ["Previous decisions for this door", "החלטות קודמות לדלת זו"],
  actor: ["Authenticated reviewer ID", "מזהה המפעיל שביצע את הביקורת"],
  policy: ["Current central policy", "המדיניות הנוכחית במערכת"],
  granted: ["Door assigned", "הדלת מורשית"],
  denied: ["Door not assigned", "הדלת אינה מורשית"],
  active: ["Active person", "משתמש פעיל"],
  inactive: ["Inactive person", "משתמש לא פעיל"],
  unbounded: ["No date boundary", "ללא מגבלת תאריך"],
  unrestricted: ["No enforced weekly/date schedule", "ללא לוח ימים ושעות נאכף"],
  schedule: ["Enforced schedule", "לוח זמנים נאכף"],
  cached: ["Cached synchronization state", "מצב סנכרון שנשמר במערכת"],
  hint: [
    "This review covers only this door. Device synchronization and physical admission are separate checks. Change access through the existing person editor and approval flow.",
    "הביקורת חלה על הדלת הזו בלבד. סנכרון לציוד וכניסה בפועל נבדקים בנפרד. שינוי גישה מתבצע בעריכת המשתמש ובמסלול האישור הקיים.",
  ],
  empty: [
    "No visible people match the selected door and filter.",
    "אין משתמשים גלויים התואמים לדלת ולסינון שנבחרו.",
  ],
  unavailable: ["No visible station available", "אין תחנה זמינה בהיקף ההרשאות"],
  refreshed: ["Data changed. Refresh and review again.", "הנתונים השתנו. יש לרענן ולסקור שוב."],
  access_review_stale: [
    "The person or review changed. Open a new review before recording.",
    "פרטי המשתמש או הביקורת השתנו. יש לפתוח סקירה חדשה לפני תיעוד.",
  ],
  access_reviews_unavailable: [
    "The review store is unavailable. Repair storage before recording.",
    "מאגר הביקורות אינו זמין. יש לתקן את האחסון לפני תיעוד.",
  ],
  access_review_limit: [
    "The review archive reached its storage limit.",
    "ארכיון הביקורות הגיע למגבלת האחסון.",
  ],
};
export class PermissionReviewsView extends LitElement {
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    context: { type: String },
    canView: { type: Boolean },
    canManage: { type: Boolean },
    data: { state: true },
    busy: { state: true },
    error: { state: true },
    station: { state: true },
    lock: { state: true },
    state: { state: true },
    preview: { state: true },
    selected: { state: true },
    reason: { state: true },
    decision: { state: true },
    cadence: { state: true },
    confirmed: { state: true },
    notice: { state: true },
  };
  static styles = [
    DataQuality.styles,
    css`
      input,
      textarea {
        font: inherit;
        color: inherit;
        background: var(--surface, var(--card-background-color));
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 8px;
        padding: 10px;
        box-sizing: border-box;
        max-width: 100%;
      }
      textarea {
        width: 100%;
        min-height: 78px;
        resize: vertical;
      }
      .decision {
        display: grid;
        gap: 12px;
        background: var(--surface, var(--card-background-color));
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 10px;
        padding: 14px;
        margin-block: 12px;
      }
      .decision label {
        display: grid;
        gap: 5px;
      }
      .decision label.confirm {
        display: flex;
        align-items: start;
        gap: 8px;
      }
      .policy {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        overflow-wrap: anywhere;
      }
      .policy p {
        border-inline-start: 2px solid var(--accent, #407f73);
        padding-inline-start: 8px;
      }
      .history {
        padding: 8px;
        border-block-start: 1px solid var(--line, var(--divider-color));
        overflow-wrap: anywhere;
      }
      .summary {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }
      .primary {
        background: var(--accent, #407f73);
        color: var(--accent-ink, #fff);
      }
      @media (max-width: 650px) {
        .summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .policy {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];
  hass?: Hass;
  stations: Station[] = [];
  context = "";
  canView = false;
  canManage = false;
  private data?: Report;
  private preview?: Preview;
  private selected?: Row;
  private busy = false;
  private error = "";
  private station = "";
  private lock = 1;
  private state = "all";
  private reason = "";
  private decision = "keep";
  private cadence = 90;
  private confirmed = false;
  private notice = "";
  private key = "";
  private epoch = 0;
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(
    () => this.hass,
    () => this.canView,
  );
  private t = (key: string) =>
    copy[key]?.[this.hass?.language?.startsWith("he") ? 1 : 0] ??
    translate(this.hass?.language ?? "en", key);
  private reset() {
    this.epoch++;
    this.requests.cancel();
    this.data = undefined;
    this.preview = undefined;
    this.selected = undefined;
    this.busy = false;
    this.error = "";
    this.reason = "";
    this.confirmed = false;
    this.notice = "";
  }
  private disconnected = () => {
    this.reset();
    this.error = "connection_lost";
  };
  disconnectedCallback() {
    super.disconnectedCallback();
    this.reset();
    this.connection?.removeEventListener?.("disconnected", this.disconnected);
  }
  protected updated(_changes: PropertyValues) {
    const key = JSON.stringify([
      this.hass?.user?.id,
      this.context,
      this.canView,
      this.canManage,
      this.stations.map((s) => s.id),
    ]);
    if (key !== this.key || this.connection !== this.hass?.connection) {
      this.reset();
      this.key = key;
      this.connection?.removeEventListener?.("disconnected", this.disconnected);
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.disconnected);
      if (!this.stations.some((s) => s.id === this.station))
        this.station = this.stations[0]?.id ?? "";
      if (this.canView && this.station) void this.load();
    }
  }
  private async load(offset = 0, snapshot = "") {
    if (!this.canView || !this.station) return;
    const epoch = ++this.epoch;
    this.requests.cancel();
    this.busy = true;
    this.error = "";
    this.preview = undefined;
    this.selected = undefined;
    try {
      const report = await this.requests.run<Report>(
        {
          type: "hikvision_intercom/users/access_reviews",
          user_id: "",
          station_id: this.station,
          lock_id: this.lock,
          state: this.state,
          offset,
          limit: 25,
          snapshot,
        },
        15000,
      );
      if (epoch === this.epoch && this.isConnected) this.data = report;
    } catch (e) {
      if (epoch === this.epoch) {
        this.data = undefined;
        this.error = (e as { code?: string }).code ?? "action_failed";
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private change(field: "station" | "state" | "lock", e: Event) {
    if (this.busy) return;
    const value = (e.target as HTMLSelectElement).value;
    if (field === "lock") this.lock = Number(value);
    else this[field] = value;
    this.reason = "";
    this.confirmed = false;
    this.notice = "";
    void this.load();
  }
  private async inspect(row: Row) {
    if (this.busy || !this.canView) return;
    const epoch = ++this.epoch;
    this.requests.cancel();
    this.busy = true;
    this.error = "";
    this.notice = "";
    this.preview = undefined;
    this.reason = "";
    this.confirmed = false;
    this.decision = "keep";
    this.cadence = 90;
    this.selected = row;
    try {
      const data = await this.requests.run<Preview>(
        {
          type: "hikvision_intercom/users/access_review_preview",
          user_id: row.user_id,
          station_id: this.station,
          lock_id: this.lock,
        },
        15000,
      );
      if (epoch === this.epoch && this.isConnected) this.preview = data;
    } catch (e) {
      if (epoch === this.epoch) this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private async save() {
    const p = this.preview;
    if (!p || !this.canManage || this.busy || !this.confirmed || !this.reason.trim()) return;
    const epoch = ++this.epoch;
    this.busy = true;
    this.error = "";
    try {
      await this.requests.run(
        {
          type: "hikvision_intercom/users/access_review_decide",
          user_id: p.user_id,
          station_id: p.station_id,
          lock_id: p.lock_id,
          person_revision: p.person_revision,
          fingerprint: p.fingerprint,
          latest_id: p.latest_id,
          decision: this.decision,
          reason: this.reason,
          cadence_days: this.cadence,
          confirmed: true,
        },
        15000,
      );
      if (epoch === this.epoch && this.isConnected) {
        this.notice = this.t("success");
        this.preview = undefined;
        this.selected = undefined;
        this.reason = "";
        this.confirmed = false;
        await this.load();
      }
    } catch (e) {
      if (epoch === this.epoch) {
        this.error = (e as { code?: string }).code ?? "action_failed";
        this.preview = undefined;
        this.confirmed = false;
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private policy(c: Central) {
    return html`<div class="policy">
      <p>
        ${this.t(c.active ? "active" : "inactive")} ·
        ${this.t(c.granted ? "granted" : "denied")}${c.archived ? " · " + this.t("archived") : ""}
      </p>
      <p>
        <bdi>${c.valid_from ?? this.t("unbounded")} — ${c.valid_until ?? this.t("unbounded")}</bdi>
      </p>
      ${c.schedule ? html`<p>${this.t("schedule")}: ${(c.schedule.days?.length ? c.schedule.days : c.schedule.dates)?.join(", ")} · ${c.schedule.periods?.map((p) => p.start + "–" + p.end).join(", ")} · <bdi>${c.schedule.timezone}</bdi></p>` : html`<p>${this.t("unrestricted")}</p>`}
    </div>`;
  }
  render() {
    if (!this.canView) return nothing;
    const d = this.data,
      p = this.preview;
    return html`<div class="heading">
        <div>
          <h2>${this.t("title")}</h2>
          <p class="sub">${this.t("intro")}</p>
        </div>
        <button
          ?disabled=${this.busy || !this.station}
          @click=${() => {
            this.notice = "";
            void this.load();
          }}
        >
          ${this.t("refresh")}
        </button>
      </div>
      <div class="toolbar">
        <label
          >${this.t("station")}<select
            .value=${this.station}
            ?disabled=${this.busy}
            @change=${(e: Event) => this.change("station", e)}
          >
            ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        ><label
          >${this.t("door")}<select
            .value=${String(this.lock)}
            aria-label=${this.t("door")}
            ?disabled=${this.busy}
            @change=${(e: Event) => this.change("lock", e)}
          >
            ${[1, 2].map((id) => html`<option value=${id}>${id}</option>`)}
          </select></label
        ><label
          >${this.t("status")}<select
            .value=${this.state}
            ?disabled=${this.busy}
            @change=${(e: Event) => this.change("state", e)}
          >
            ${["all", "pending", "due", "stale", "completed", "followup", "archived"].map((s) => html`<option value=${s}>${this.t(s)}</option>`)}
          </select></label
        >
      </div>
      ${!this.station ? html`<p>${this.t("unavailable")}</p>` : nothing}${this.busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}${this.notice ? html`<p role="status">${this.notice}</p>` : nothing}
      ${
        d
          ? html`<div class="summary">
                ${["pending", "due", "stale", "completed", "followup"].map((s) => html`<div class="metric"><strong>${d.summary[s] ?? 0}</strong>${this.t(s)}</div>`)}
              </div>
              ${
                d.stale
                  ? html`<p role="alert">${this.t("refreshed")}</p>`
                  : html`<div class="list">
                        ${(p
                          ? d.records.filter((row) => row.user_id === p.user_id)
                          : d.records
                        ).map(
                          (row) =>
                            html`<article>
                              <div class="person">
                                <strong>${row.display_name}</strong
                                ><span>${this.t(row.status)}</span>
                                <div>
                                  <button
                                    ?disabled=${this.busy}
                                    @click=${() => this.dispatchEvent(new CustomEvent("open-user", { detail: row.user_id }))}
                                  >
                                    ${this.t("lifecycle_open_user")}</button
                                  ><button
                                    ?disabled=${this.busy}
                                    @click=${() => void this.inspect(row)}
                                  >
                                    ${this.t("review")}
                                  </button>
                                </div>
                              </div>
                              ${this.policy(row.central)}
                              <p class="sub">
                                ${this.t("cached")}:
                                ${translate(this.hass?.language ?? "en", row.sync_state)}
                              </p>
                              ${row.latest ? html`<p class="sub">${row.latest.at} · ${this.t("next_due")}: ${row.latest.due_at}</p>` : nothing}
                            </article>`,
                        )}
                      </div>
                      ${!d.records.length ? html`<p>${this.t("empty")}</p>` : nothing}
                      <div class="pager">
                        <button
                          ?disabled=${this.busy || d.previous_offset === null}
                          @click=${() => void this.load(d.previous_offset ?? 0, d.snapshot)}
                        >
                          ${this.t("previous")}</button
                        ><span
                          >${d.total ? d.offset + 1 : 0}–${Math.min(d.offset + d.records.length, d.total)}
                          / ${d.total}</span
                        ><button
                          ?disabled=${this.busy || d.next_offset === null}
                          @click=${() => void this.load(d.next_offset ?? 0, d.snapshot)}
                        >
                          ${this.t("next")}
                        </button>
                      </div>`
              }`
          : nothing
      }
      ${
        p
          ? html`<section class="decision" aria-label=${this.t("review")}>
              <button
                @click=${() => {
                  this.preview = undefined;
                  this.selected = undefined;
                  this.reason = "";
                  this.confirmed = false;
                }}
                ?disabled=${this.busy}
              >
                ${this.t("close")}
              </button>
              <h3>
                ${this.selected?.display_name} ·
                ${this.stations.find((s) => s.id === p.station_id)?.name} · ${this.t("door")}
                ${p.lock_id}
              </h3>
              <p class="sub">${this.t("hint")}</p>
              <h4>${this.t("policy")}</h4>
              ${this.policy(p.central)}${
                this.canManage
                  ? html`<label
                        >${this.t("decision")}<select
                          .value=${this.decision}
                          @change=${(e: Event) => {
                            this.decision = (e.target as HTMLSelectElement).value;
                            this.confirmed = false;
                          }}
                          ?disabled=${this.busy}
                        >
                          ${["keep", "followup"].map((s) => html`<option value=${s}>${this.t(s)}</option>`)}
                        </select></label
                      ><label
                        >${this.t("reason")}<textarea
                          maxlength="500"
                          .value=${this.reason}
                          @input=${(e: Event) => {
                            this.reason = (e.target as HTMLTextAreaElement).value;
                            this.confirmed = false;
                          }}
                          ?disabled=${this.busy}
                        ></textarea></label
                      ><label
                        >${this.t("cadence")}<input
                          type="number"
                          min="1"
                          max="365"
                          .value=${String(this.cadence)}
                          @input=${(e: Event) => {
                            this.cadence = Number((e.target as HTMLInputElement).value);
                            this.confirmed = false;
                          }}
                          ?disabled=${this.busy} /></label
                      ><label class="confirm"
                        ><input
                          type="checkbox"
                          .checked=${this.confirmed}
                          @change=${(e: Event) => (this.confirmed = (e.target as HTMLInputElement).checked)}
                          ?disabled=${this.busy}
                        />${this.t("confirm")}</label
                      ><button
                        class="primary"
                        ?disabled=${this.busy || !this.reason.trim() || !this.confirmed || !Number.isInteger(this.cadence) || this.cadence < 1 || this.cadence > 365}
                        @click=${() => void this.save()}
                      >
                        ${this.t("record")}
                      </button>`
                  : nothing
              }
              <details>
                <summary>${this.t("history")} (${p.history.length})</summary>
                ${p.history.map(
                  (row) =>
                    html`<div class="history">
                      <strong>${this.t(row.decision)}</strong>
                      <p>${row.reason}</p>
                      <p class="sub">
                        <bdi>${row.at}</bdi> · ${this.t("actor")}: <bdi>${row.actor}</bdi>
                      </p>
                    </div>`,
                )}
              </details>
            </section>`
          : nothing
      }`;
  }
}
customElements.define("wiskey-permission-reviews", PermissionReviewsView);
