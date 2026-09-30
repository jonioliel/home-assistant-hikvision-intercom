import { LitElement, html, nothing } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { downloadText } from "./download";
import type { Hass, Station, UserTimingDraft } from "./types";
import { visitTimingSummary } from "./guest-templates";
import { translate } from "./i18n";

interface Job {
  id: string;
  revision: number;
  kind: string;
  state: string;
  total: number;
  saved: number;
  failed: number;
  pending: number;
  errors: { row: number; code: string }[];
  approval?: { state: string; action: string; expires_at: string } | null;
}
interface Review extends Job {
  review_id: string;
  own_request: boolean;
  impact: {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    fields: string[];
    delete: boolean;
  }[];
}
export class CheckpointJobsPanel extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    rows: { state: true },
    error: { state: true },
    busy: { state: true },
    reviews: { state: true },
    review: { state: true },
    dual: { state: true },
    reviewPage: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  private rows: Job[] = [];
  private error = "";
  private busy = false;
  private reviews: Job[] = [];
  private review?: Review;
  private dual = false;
  private reviewPage = 0;
  private actor = "";
  private timer?: ReturnType<typeof setTimeout>;
  private requests = new ScopedRequests(() => this.hass);
  private text(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.timer);
    this.requests.cancel();
    this.rows = [];
    this.reviews = [];
    this.review = undefined;
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has("hass")) {
      const actor = this.hass?.user?.id ?? "";
      if (
        actor !== this.actor ||
        !this.hass?.user?.is_admin ||
        this.hass.connection.connected === false
      ) {
        this.actor = actor;
        this.requests.cancel();
        this.rows = [];
        this.reviews = [];
        this.review = undefined;
        this.error = "";
        this.busy = false;
      }
      if (!this.rows.length) void this.load();
    }
  }
  private async load() {
    if (
      !this.hass?.user?.is_admin ||
      this.hass.connection.connected === false ||
      this.busy ||
      !this.isConnected
    )
      return;
    this.busy = true;
    try {
      const result = await this.requests.run<{
        records: Job[];
        reviews?: Job[];
        dual_approval?: boolean;
      }>({ type: "hikvision_intercom/jobs/list" }, 10000);
      if (this.isConnected) {
        this.rows = result.records;
        this.reviews = result.reviews ?? [];
        this.dual = result.dual_approval ?? false;
      }
    } catch {
      /* Servers predating this optional endpoint retain the existing jobs view. */
    } finally {
      this.busy = false;
      clearTimeout(this.timer);
      if (this.isConnected) this.timer = setTimeout(() => void this.load(), 3000);
    }
  }
  private async requestApproval(job: Job) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await this.requests.run({
        type: "hikvision_intercom/jobs/approval_request",
        job_id: job.id,
        revision: job.revision,
        action: job.state === "completed_with_errors" ? "retry_failed" : "resume",
        confirmed: true,
      });
    } catch (error) {
      this.error = String((error as { code?: string })?.code ?? "failed");
    } finally {
      this.busy = false;
      void this.load();
    }
  }
  private async inspectApproval(job: Job) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.review = undefined;
    this.reviewPage = 0;
    try {
      this.review = await this.requests.run<Review>({
        type: "hikvision_intercom/jobs/approval_review",
        job_id: job.id,
      });
    } catch (error) {
      this.error = String((error as { code?: string })?.code ?? "failed");
    } finally {
      this.busy = false;
    }
  }
  private async decideApproval(approve: boolean) {
    const review = this.review;
    if (this.busy || !review || review.own_request) return;
    this.busy = true;
    this.error = "";
    try {
      await this.requests.run({
        type: "hikvision_intercom/jobs/approval_decide",
        job_id: review.id,
        revision: review.revision,
        review_id: review.review_id,
        approve,
        confirmed: true,
      });
      this.review = undefined;
    } catch (error) {
      this.error = String((error as { code?: string })?.code ?? "failed");
      // A changed plan or lost response must be reread, never resent automatically.
      this.review = undefined;
    } finally {
      this.busy = false;
      void this.load();
    }
  }
  private async action(job: Job, action: string) {
    if (this.busy || !this.hass?.user?.is_admin) return;
    if (
      action === "cancel" &&
      !confirm(
        this.text(
          "Cancel unsaved rows? Saved changes keep synchronizing.",
          "לבטל את השורות שטרם נשמרו? שינויים שנשמרו ממשיכים להסתנכרן.",
        ),
      )
    )
      return;
    this.busy = true;
    this.error = "";
    try {
      if (action === "errors") {
        const result = await this.requests.run<{ csv: string }>(
          { type: "hikvision_intercom/jobs/errors", job_id: job.id },
          10000,
        );
        downloadText(result.csv, "wiskey-job-errors.csv", "text/csv;charset=utf-8");
      } else
        await this.requests.run(
          {
            type: "hikvision_intercom/jobs/action",
            job_id: job.id,
            revision: job.revision,
            action,
          },
          15000,
        );
    } catch (error) {
      this.error = String((error as { code?: string })?.code ?? "failed");
    } finally {
      this.busy = false;
      void this.load();
    }
  }
  render() {
    if (!this.hass?.user?.is_admin || (!this.rows.length && !this.reviews.length)) return nothing;
    const states: Record<string, string> = {
      paused: this.text("Paused", "מושהה"),
      running: this.text("Running", "פועל"),
      completed: this.text("Completed", "הושלם"),
      completed_with_errors: this.text("Completed with errors", "הושלם עם שגיאות"),
      cancelled: this.text("Cancelled", "בוטל"),
    };
    return html`<section>
      <h3>${this.text("Resumable jobs", "עבודות עם נקודת המשך")}</h3>
      <p class="sub">
        ${this.text("Pause and cancel affect unsaved rows only. After a restart, jobs wait for manual resume. Saved changes continue synchronizing.", "השהיה וביטול חלים על שורות שטרם נשמרו. אחרי הפעלה מחדש העבודה ממתינה לחידוש ידני. שינויים שנשמרו ממשיכים להסתנכרן.")}
      </p>
      ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}
      ${
        this.reviews.length
          ? html`<section>
              <h4>${this.text("Jobs awaiting your review", "עבודות הממתינות לסקירה שלך")}</h4>
              ${this.reviews.map((job) => html`<article class="card"><span>${job.total} ${this.text("rows", "שורות")} · ${job.kind === "csv" ? "CSV" : this.text("Bulk changes", "שינויים מרוכזים")}</span><button ?disabled=${this.busy} @click=${() => this.inspectApproval(job)}>${this.text("Review job", "סקירת עבודה")}</button></article>`)}
            </section>`
          : nothing
      }
      ${
        this.review
          ? html`<article class="card job-approval-review">
              <h4>${this.text("Review proposed changes", "סקירת השינויים המוצעים")}</h4>
              <p>
                ${this.text("Consent expires after 24 hours and does not start the job. The owner resumes it explicitly. Codes and card numbers are hidden.", "האישור תקף ל־24 שעות ואינו מפעיל את העבודה. המקים מחדש אותה במפורש. קודים ומספרי כרטיסים מוסתרים.")}
              </p>
              ${this.review.impact.slice(this.reviewPage * 50, (this.reviewPage + 1) * 50).map(
                (impact) =>
                  html`<section class="card">
                    <strong
                      >${impact.after?.display_name ?? impact.before?.display_name ?? "—"}</strong
                    >
                    <p>
                      ${impact.fields.map((field) => translate(this.hass?.language ?? "en", field)).join(", ")}
                      ·
                      ${impact.delete ? this.text("Delete", "מחיקה") : this.text("Change", "שינוי")}
                    </p>
                    ${[impact.before, impact.after].map(
                      (side, index) =>
                        html`<details>
                          <summary>
                            ${index ? this.text("After", "אחרי") : this.text("Before", "לפני")}
                          </summary>
                          ${
                            side
                              ? html`<p>
                                    ${side.active ? this.text("Active", "פעיל") : this.text("Inactive", "לא פעיל")}
                                    · PIN: ${side.pin_configured ? "✓" : "—"} ·
                                    ${this.text("Cards", "כרטיסים")}: ${side.card_count}
                                  </p>
                                  <p>
                                    ${String(side.valid_from ?? "—")} →
                                    ${String(side.valid_until ?? "—")}
                                  </p>
                                  ${Object.entries(
                                    (side.assignments ?? {}) as Record<
                                      string,
                                      { enabled: boolean; allowed_locks: number[] }
                                    >,
                                  )
                                    .filter(([, assignment]) => assignment.enabled)
                                    .map(
                                      ([sid, assignment]) =>
                                        html`<p>
                                          ${this.stations.find((station) => station.id === sid)?.name ?? this.text("Unloaded station", "תחנה שאינה נטענת")}
                                          · ${this.text("Doors", "דלתות")}:
                                          ${assignment.allowed_locks.join(", ")}
                                        </p>`,
                                    )}
                                  <p>
                                    ${side.timing ? visitTimingSummary((side.timing as { schedule: UserTimingDraft }).schedule, this.hass?.language ?? "en") : this.text("No weekly or calendar restriction", "ללא הגבלת ימים ושעות")}
                                  </p>
                                  ${side.timing ? html`<p>${translate(this.hass?.language ?? "en", "user_timing_" + (side.timing as { mode: string }).mode)}</p>` : nothing}`
                              : html`<p>—</p>`
                          }
                        </details>`,
                    )}
                  </section>`,
              )}
              <div class="actions">
                <button ?disabled=${this.reviewPage === 0} @click=${() => this.reviewPage--}>
                  ${this.text("Previous", "הקודם")}</button
                ><span
                  >${this.reviewPage + 1}/${Math.max(1, Math.ceil(this.review.impact.length / 50))}</span
                ><button
                  ?disabled=${(this.reviewPage + 1) * 50 >= this.review.impact.length}
                  @click=${() => this.reviewPage++}
                >
                  ${this.text("Next", "הבא")}
                </button>
              </div>
              <div class="actions">
                ${!this.review.own_request ? html`<button ?disabled=${this.busy} @click=${() => this.decideApproval(true)}>${this.text("Approve reviewed job", "אישור העבודה שנסקרה")}</button><button ?disabled=${this.busy} @click=${() => this.decideApproval(false)}>${this.text("Reject job", "דחיית עבודה")}</button>` : nothing}<button
                  ?disabled=${this.busy}
                  @click=${() => (this.review = undefined)}
                >
                  ${this.text("Close review", "סגירת סקירה")}
                </button>
              </div>
            </article>`
          : nothing
      }
      ${this.rows.map(
        (job) =>
          html`<article class="card">
            <strong
              >${job.kind === "csv" ? "CSV" : this.text("Bulk changes", "שינויים מרוכזים")} ·
              ${states[job.state]}</strong
            >
            <p>
              ${job.saved}/${job.total} · ${this.text("Failed", "נכשלו")}: ${job.failed} ·
              ${this.text("Pending", "ממתינות")}: ${job.pending}
            </p>
            ${
              this.dual && ["paused", "completed_with_errors"].includes(job.state)
                ? html`<p>
                      ${this.text("Second approval", "אישור נוסף")}:
                      ${job.approval?.state === "approved" ? this.text("Approved", "מאושר") : job.approval?.state === "pending" ? this.text("Awaiting review", "ממתין לסקירה") : this.text("Required", "נדרש")}
                    </p>
                    ${job.approval?.state === "pending" ? html`<button ?disabled=${this.busy} @click=${() => this.inspectApproval(job)}>${this.text("Review job", "סקירת עבודה")}</button>` : html`<button ?disabled=${this.busy} @click=${() => this.requestApproval(job)}>${this.text("Request second approval", "בקשת אישור נוסף")}</button>`}`
                : nothing
            }
            ${job.state === "running" ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "pause")}>${this.text("Pause", "השהיה")}</button>` : nothing}
            ${job.state === "paused" ? html`<button ?disabled=${this.busy || (this.dual && job.approval?.state !== "approved")} @click=${() => this.action(job, "resume")}>${this.text("Resume", "חידוש")}</button>` : nothing}
            ${job.state === "completed_with_errors" ? html`<button ?disabled=${this.busy || (this.dual && (job.approval?.state !== "approved" || job.approval.action !== "retry_failed"))} @click=${() => this.action(job, "retry_failed")}>${this.text("Retry failed rows", "ניסיון נוסף לשורות שנכשלו")}</button>` : nothing}
            ${["running", "paused"].includes(job.state) ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "cancel")}>${this.text("Cancel unsaved rows", "ביטול שורות שטרם נשמרו")}</button>` : nothing}
            ${job.failed ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "errors")}>${this.text("Download errors", "הורדת דוח שגיאות")}</button>` : nothing}
          </article>`,
      )}
    </section>`;
  }
}
customElements.define("wiskey-checkpoint-jobs", CheckpointJobsPanel);
