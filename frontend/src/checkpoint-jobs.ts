import { LitElement, html, nothing } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { downloadText } from "./download";
import type { Hass } from "./types";

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
}
export class CheckpointJobsPanel extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    rows: { state: true },
    error: { state: true },
    busy: { state: true },
  };
  hass?: Hass;
  private rows: Job[] = [];
  private error = "";
  private busy = false;
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
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has("hass")) {
      const actor = this.hass?.user?.id ?? "";
      if (actor !== this.actor) {
        this.actor = actor;
        this.requests.cancel();
        this.rows = [];
        this.error = "";
        this.busy = false;
      }
      if (!this.rows.length) void this.load();
    }
  }
  private async load() {
    if (!this.hass?.user?.is_admin || this.busy || !this.isConnected) return;
    this.busy = true;
    try {
      const result = await this.requests.run<{ records: Job[] }>(
        { type: "hikvision_intercom/jobs/list" },
        10000,
      );
      if (this.isConnected) this.rows = result.records;
    } catch {
      /* Servers predating this optional endpoint retain the existing jobs view. */
    } finally {
      this.busy = false;
      clearTimeout(this.timer);
      if (this.isConnected) this.timer = setTimeout(() => void this.load(), 3000);
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
    if (!this.hass?.user?.is_admin || !this.rows.length) return nothing;
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
            ${job.state === "running" ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "pause")}>${this.text("Pause", "השהיה")}</button>` : nothing}
            ${job.state === "paused" ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "resume")}>${this.text("Resume", "חידוש")}</button>` : nothing}
            ${job.state === "completed_with_errors" ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "retry_failed")}>${this.text("Retry failed rows", "ניסיון נוסף לשורות שנכשלו")}</button>` : nothing}
            ${["running", "paused"].includes(job.state) ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "cancel")}>${this.text("Cancel unsaved rows", "ביטול שורות שטרם נשמרו")}</button>` : nothing}
            ${job.failed ? html`<button ?disabled=${this.busy} @click=${() => this.action(job, "errors")}>${this.text("Download errors", "הורדת דוח שגיאות")}</button>` : nothing}
          </article>`,
      )}
    </section>`;
  }
}
customElements.define("wiskey-checkpoint-jobs", CheckpointJobsPanel);
