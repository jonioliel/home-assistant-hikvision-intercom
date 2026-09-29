import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import type { Hass } from "./types";
import { translate } from "./i18n";

type Values = Record<string, unknown>;
interface Row {
  station_id: string;
  name: string;
  door?: number;
  before?: Values;
  after?: Values;
  expected?: Values;
  changes?: Values;
  window?: { enabled: boolean; days: number[]; start: string; end: string; timezone: string };
  state?: string;
  code?: string;
  error?: string;
}
interface Job {
  id: string;
  fingerprint: string;
  actor: string;
  own_request: boolean;
  state: string;
  rows: Row[];
  created_at: string;
  expires_at: string;
  consent: unknown;
}
interface Review {
  review_id: string | null;
  rows: Row[];
  queue_count: number;
}

class MaintenanceQueue extends LitElement {
  static properties = {
    hass: { attribute: false },
    stationIds: { attribute: false },
    door: { type: Number },
    changes: { attribute: false },
    jobs: { state: true },
    review: { state: true },
    busy: { state: true },
    error: { state: true },
    confirmed: { state: true },
    consentId: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        background: transparent;
        height: auto;
        overflow: visible;
      }
      section,
      article {
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        padding: 12px;
        margin-block: 12px;
        background: var(--surface);
      }
      h3,
      p {
        margin-block: 0 10px;
      }
      .row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .scroll {
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: start;
        padding: 8px;
        border-bottom: 1px solid var(--divider-color);
        vertical-align: top;
      }
      label {
        display: flex;
        gap: 8px;
        margin-block: 10px;
      }
      .error {
        color: var(--error-color);
      }
      .sub {
        color: var(--muted);
        overflow-wrap: anywhere;
      }
    `,
  ];
  hass?: Hass;
  stationIds: string[] = [];
  door = 1;
  changes: Values = {};
  private jobs: Job[] = [];
  private review?: Review;
  private busy = false;
  private error = "";
  private confirmed = false;
  private consentId = "";
  private actor = "";
  private selectionStamp = "";
  private epoch = 0;
  private timer?: ReturnType<typeof setInterval>;
  private requests = new ScopedRequests(() => this.hass);
  private copy(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  connectedCallback() {
    super.connectedCallback();
    this.timer = setInterval(() => {
      if (!document.hidden) void this.action(() => this.load());
    }, 30000);
  }
  disconnectedCallback() {
    this.epoch++;
    this.requests.cancel();
    clearInterval(this.timer);
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    const actor = this.hass?.user?.is_admin ? (this.hass.user.id ?? "") : "";
    if (changed.has("stationIds") || changed.has("door") || changed.has("changes")) {
      const stamp = JSON.stringify([this.stationIds, this.door, this.changes]);
      if (stamp !== this.selectionStamp) {
        this.selectionStamp = stamp;
        this.epoch++;
        this.requests.cancel();
        this.busy = false;
        this.review = undefined;
        this.confirmed = false;
      }
    }
    if (actor !== this.actor) {
      this.epoch++;
      this.requests.cancel();
      this.actor = actor;
      this.jobs = [];
      this.review = undefined;
      this.error = this.consentId = "";
      this.confirmed = false;
      this.busy = false;
      if (actor) void this.action(() => this.load());
    }
  }
  private async api<T>(command: string, values: Values = {}): Promise<T> {
    return this.requests.run<T>(
      { type: "hikvision_intercom/platform/maintenance_" + command, api_contract: 1, ...values },
      command === "preview" ? 600000 : 60000,
    );
  }
  private async load() {
    const epoch = this.epoch;
    const result = await this.api<{ records: Job[] }>("jobs");
    if (epoch === this.epoch && this.isConnected) this.jobs = result.records;
  }
  private async action(task: () => Promise<unknown>) {
    if (this.busy || !this.hass?.user?.is_admin || this.hass.connection.connected === false) return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = "";
    try {
      await task();
    } catch (err) {
      if (epoch === this.epoch)
        this.error = translate(
          this.hass?.language ?? "en",
          (err as { code?: string }).code ?? "action_failed",
        );
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private summary(values?: Values) {
    if (!values) return "—";
    const labels: Record<string, [string, string]> = {
      doorName: ["Door name", "שם דלת"],
      openDuration: ["Opening seconds", "שניות פתיחה"],
      relayReverseEnabled: ["Reverse relay", "היפוך ממסר"],
    };
    return Object.entries(values)
      .filter(([k]) => k in labels)
      .map(
        ([key, value]) =>
          html`<div>
            ${this.copy(...labels[key])}:
            ${typeof value === "boolean" ? (value ? this.copy("Enabled", "מופעל") : this.copy("Disabled", "כבוי")) : String(value)}
          </div>`,
      );
  }
  private window(row: Row) {
    const w = row.window;
    if (!w) return "—";
    if (!w.enabled) return this.copy("Next queue cycle", "בהרצה הקרובה של התור");
    return html`<div>
        ${w.days.map((d) => this.copy(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d], ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"][d])).join(", ")}
      </div>
      <div dir="ltr">${w.start}–${w.end} · ${w.timezone}</div>`;
  }
  private status(state?: string) {
    const labels: Record<string, [string, string]> = {
      queued: ["Waiting for window", "ממתינה לחלון"],
      awaiting_approval: ["Waiting for second approval", "ממתינה לאישור נוסף"],
      pending: ["Waiting", "ממתינה"],
      writing: ["Write outcome pending", "תוצאת כתיבה ממתינה לאימות"],
      verified: ["Readback verified", "קריאה חוזרת אומתה"],
      failed: ["Failed; new review required", "נכשלה; נדרשת סקירה חדשה"],
      uncertain: ["Outcome unknown; no replay", "תוצאה לא ידועה; אין שידור חוזר"],
      cancelled: ["Cancelled", "בוטלה"],
      rejected: ["Rejected", "נדחתה"],
      expired: ["Expired", "פג תוקף התוכנית"],
      completed_with_errors: ["Completed with issues", "הסתיימה עם תקלות"],
    };
    return state && labels[state] ? this.copy(...labels[state]) : "—";
  }
  private rows(rows: Row[]) {
    return html`<div class="scroll">
      <table>
        <thead>
          <tr>
            <th>${this.copy("Station", "תחנה")}</th>
            <th>${this.copy("Before", "לפני")}</th>
            <th>${this.copy("After", "אחרי")}</th>
            <th>${this.copy("Window / result", "חלון / תוצאה")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr>
                <td>${r.name}</td>
                <td>${this.summary(r.before ?? r.expected)}</td>
                <td>
                  ${this.summary(r.after ?? (r.expected ? { ...r.expected, ...r.changes } : undefined))}
                </td>
                <td>
                  ${this.window(r)}
                  <div>${this.status(r.state)}</div>
                  ${r.error || r.code ? html`<div class="error">${translate(this.hass?.language ?? "en", r.error || r.code || "")}</div>` : nothing}
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }
  private async decide(job: Job, approve: boolean) {
    if (this.consentId !== job.id) return;
    await this.api("decide", {
      job_id: job.id,
      fingerprint: job.fingerprint,
      confirmed: true,
      approve,
    });
    this.consentId = "";
    await this.load();
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<section aria-label=${this.copy("Maintenance queue", "תור תחזוקה")}>
      <h3>${this.copy("Schedule reviewed changes", "תזמון שינויים שנסקרו")}</h3>
      <p class="sub">
        ${this.copy("A saved job waits for each station's configured window, with an eight-day expiry. Cancel stops pending changes and does not undo completed writes. Interrupted writes are read back without replay. Failed or changed plans require a new review.", "תוכנית שמורה ממתינה לחלון שהוגדר לכל תחנה, עם תוקף של שמונה ימים. ביטול עוצר שינויים ממתינים ואינו מבטל כתיבה שכבר הושלמה. כתיבה שנקטעה נבדקת בקריאה חוזרת ללא שידור חוזר. כשל או שינוי בתוכנית דורשים סקירה חדשה.")}
      </p>
      <div class="row">
        <button
          ?disabled=${this.busy || !this.stationIds.length || !Object.keys(this.changes).length}
          @click=${() =>
            void this.action(async () => {
              const epoch = this.epoch;
              const review = await this.api<Review>("preview", {
                station_ids: this.stationIds,
                door: this.door,
                changes: this.changes,
              });
              if (epoch === this.epoch && this.isConnected) {
                this.review = review;
                this.confirmed = false;
              }
            })}
        >
          ${this.copy("Review scheduled job", "סקור תוכנית מתוזמנת")}</button
        ><button ?disabled=${this.busy} @click=${() => void this.action(() => this.load())}>
          ${this.copy("Refresh saved jobs", "רענן תוכניות שמורות")}
        </button>
      </div>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${
        this.review
          ? html`${this.rows(this.review.rows)}
              <p>${this.copy("Stations included", "תחנות בתוכנית")}: ${this.review.queue_count}</p>
              <label
                ><input
                  type="checkbox"
                  .checked=${this.confirmed}
                  ?disabled=${this.busy}
                  @change=${(e: Event) => (this.confirmed = (e.target as HTMLInputElement).checked)}
                />${this.copy("I approve this exact plan and its windows", "אני מאשר את התוכנית המדויקת וחלונות ההחלה שלה")}</label
              ><button
                ?disabled=${this.busy || !this.confirmed || !this.review.review_id}
                @click=${() =>
                  void this.action(async () => {
                    await this.api("enqueue", {
                      review_id: this.review!.review_id,
                      confirmed: true,
                    });
                    this.review = undefined;
                    this.confirmed = false;
                    await this.load();
                  })}
              >
                ${this.copy("Queue approved plan", "הכנס תוכנית מאושרת לתור")}
              </button>`
          : nothing
      }
      ${
        this.jobs.length
          ? this.jobs.map(
              (job) =>
                html`<article>
                  <strong>${this.status(job.state)}</strong>
                  <p class="sub">
                    ${this.copy("Created", "נוצרה")}:
                    ${new Date(job.created_at).toLocaleString(this.hass?.language)} ·
                    ${this.copy("Expires", "בתוקף עד")}:
                    ${new Date(job.expires_at).toLocaleString(this.hass?.language)}
                  </p>
                  ${this.rows(job.rows)}
                  ${
                    ["queued", "awaiting_approval"].includes(job.state)
                      ? html`<label
                            ><input
                              type="checkbox"
                              .checked=${this.consentId === job.id}
                              ?disabled=${this.busy}
                              @change=${(e: Event) => (this.consentId = (e.target as HTMLInputElement).checked ? job.id : "")}
                            />${this.copy("I reviewed this saved plan", "קראתי את התוכנית השמורה הזו")}</label
                          >
                          <div class="row">
                            ${job.state === "awaiting_approval" && !job.own_request && !job.consent ? html`<button ?disabled=${this.busy || this.consentId !== job.id} @click=${() => void this.action(() => this.decide(job, true))}>${this.copy("Second approval", "אישור מנהל נוסף")}</button><button ?disabled=${this.busy || this.consentId !== job.id} @click=${() => void this.action(() => this.decide(job, false))}>${this.copy("Reject plan", "דחה תוכנית")}</button>` : nothing}<button
                              ?disabled=${this.busy || this.consentId !== job.id}
                              @click=${() =>
                                void this.action(async () => {
                                  await this.api("cancel", {
                                    job_id: job.id,
                                    fingerprint: job.fingerprint,
                                    confirmed: true,
                                  });
                                  this.consentId = "";
                                  await this.load();
                                })}
                            >
                              ${this.copy("Cancel pending changes", "בטל שינויים ממתינים")}
                            </button>
                          </div>`
                      : nothing
                  }
                </article>`,
            )
          : html`<p class="sub">${this.copy("No saved jobs", "אין תוכניות שמורות")}</p>`
      }
    </section>`;
  }
}
customElements.define("wiskey-maintenance-queue", MaintenanceQueue);
