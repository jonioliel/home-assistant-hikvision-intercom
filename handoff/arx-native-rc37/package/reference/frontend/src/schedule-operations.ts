import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { ScopedRequests } from "./request";
import { styles } from "./styles";
import { translate } from "./i18n";
import { formatTime, UTC_ZONE } from "./time";
import { downloadText } from "./download";
import type { Hass, Station } from "./types";

interface Plan {
  id: string;
  revision: number;
  name: string;
  station_id: string;
}
interface Claim {
  id: string;
  revision: number;
  plan_id: string;
  station_id: string;
  resource_keys: string[];
}
interface Job {
  id: string;
  revision: number;
  plan_id: string;
  plan_revision: number;
  station_id: string;
  name: string;
  resource_keys: string[];
  status: string;
  error: string | null;
  blockers: string[];
  ownership: string;
  journal_id: string | null;
  updated_at: string;
  report: { checked_at: string } | null;
}
interface Workspace {
  claims: Claim[];
  jobs: Job[];
  archive: Job[];
  journal: {
    id: string;
    status: string;
    issue: string | null;
    steps: { key: string; state: string; attempted: boolean }[];
  }[];
  writes_enabled: false;
}
interface ClaimReview {
  token: string;
  resource_keys: string[];
  plan_id: string;
  plan_revision: number;
  report: { blockers: string[] };
}

export class ScheduleOperationsPanel extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
        margin-block: 24px;
      }
      section,
      details {
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        padding: 16px;
        margin-block: 12px;
        min-width: 0;
      }
      select {
        width: 100%;
        min-width: 0;
        margin-block: 8px;
      }
      .toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-block: 12px;
      }
      p,
      li,
      summary {
        overflow-wrap: anywhere;
        line-height: 1.6;
      }
      summary {
        cursor: pointer;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    plans: { attribute: false },
    _data: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _review: { state: true },
    _uncertain: { state: true },
    _selected: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  plans: Plan[] = [];
  private _data?: Workspace;
  private _review?: ClaimReview;
  private _busy = false;
  private _uncertain = false;
  private _error = "";
  private _selected = "";
  private _loaded = false;
  private requests = new ScopedRequests(() => this.hass);
  private connection?: Hass["connection"];
  private actor?: string;
  private _epoch = 0;
  private _sequence = 0;
  private _timer?: ReturnType<typeof setTimeout>;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    const connection = this.hass?.user?.is_admin ? this.hass.connection : undefined;
    const actor = this.hass?.user?.id;
    if (connection !== this.connection || actor !== this.actor) {
      this.clear();
      this.connection = connection;
      this.actor = actor;
    }
    if (!this.hass?.user?.is_admin) {
      if (this._loaded) this.clear();
      return;
    }
    if (!this._loaded) {
      this._loaded = true;
      void this.load();
    }
    if (
      changed.has("plans") &&
      this._review &&
      !this.plans.some(
        (p) => p.id === this._review!.plan_id && p.revision === this._review!.plan_revision,
      )
    ) {
      this._review = undefined;
      this._sequence++;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clear();
  }
  private clear() {
    this._epoch++;
    this.requests.cancel();
    this._sequence++;
    clearTimeout(this._timer);
    this._timer = undefined;
    this._data = undefined;
    this._review = undefined;
    this._loaded = false;
    this._busy = false;
    this._uncertain = false;
    this._error = "";
  }
  private current(epoch: number) {
    return epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin;
  }
  private api<T>(action: string, data: Record<string, unknown> = {}) {
    return this.requests.run<T>({
      type: `hikvision_intercom/schedules/operations_${action}`,
      ...data,
    });
  }
  private poll() {
    clearTimeout(this._timer);
    if (this._data?.jobs.some((j) => j.status === "queued" || j.status === "checking"))
      this._timer = setTimeout(() => {
        void this.load();
      }, 1500);
  }
  private async load() {
    if (this._busy) {
      this.poll();
      return;
    }
    this._busy = true;
    const epoch = this._epoch;
    try {
      const data = await this.api<Workspace>("list");
      if (this.current(epoch)) {
        this._data = data;
        this._uncertain = false;
        this._error = "";
      }
    } catch (e) {
      if (this.current(epoch)) this._error = this.t((e as { code?: string })?.code ?? "failed");
    } finally {
      if (this.current(epoch)) {
        this._busy = false;
        this.poll();
      }
    }
  }
  private async act(action: string, payload: Record<string, unknown>, mutation = true) {
    if (this._busy || this._uncertain) return;
    const epoch = this._epoch,
      sequence = this._sequence;
    this._busy = true;
    this._error = "";
    if (action !== "claim_preview") this._review = undefined;
    try {
      const result = await this.api<ClaimReview>(action, payload);
      if (!this.current(epoch)) return;
      if (action === "claim_preview") {
        if (
          sequence === this._sequence &&
          this.plans.some((p) => p.id === result.plan_id && p.revision === result.plan_revision)
        )
          this._review = result;
      } else if (action === "export") {
        downloadText(
          JSON.stringify(result, null, 2),
          "hikvision-schedule-operations.json",
          "application/json",
        );
      } else {
        this._busy = false;
        await this.load();
      }
    } catch (e) {
      if (this.current(epoch)) {
        const code = (e as { code?: string })?.code;
        this._uncertain =
          mutation &&
          (!code ||
            ![
              "revision_conflict",
              "schedule_claim_conflict",
              "schedule_claim_expired",
              "schedule_claim_in_use",
              "schedule_operation_exists",
              "schedule_operation_retained",
              "schedule_operation_not_found",
              "schedule_claim_not_found",
              "schedule_operation_limit",
              "schedule_source_changed",
              "schedule_plan_device_changed",
              "schedule_operations_unavailable",
              "schedule_read_busy",
              "station_offline",
              "station_unloaded",
              "storage_write_failed",
              "storage_stopping",
              "unauthorized",
              "rate_limited",
            ].includes(code));
        this._error = this.t(this._uncertain ? "operations_unknown" : (code ?? "failed"));
      }
    } finally {
      if (this.current(epoch)) {
        this._busy = false;
        this.poll();
      }
    }
  }
  private station(id: string) {
    return this.stations.find((s) => s.id === id)?.name ?? this.t("plan_station_missing");
  }
  private time(value: string, id: string) {
    return formatTime(
      value,
      this.hass?.language,
      this.stations.find((s) => s.id === id)?.clock?.zone ?? UTC_ZONE,
    );
  }
  private showJob(job: Job, archived = false) {
    const journal = this._data?.journal.find((j) => j.id === job.journal_id);
    return html`<details>
      <summary>
        ${job.name} · ${this.station(job.station_id)} · ${this.t("operations_state_" + job.status)}
      </summary>
      <p>
        ${this.t("operations_plan_revision")}: ${job.plan_revision} ·
        <bdi>${this.time(job.updated_at, job.station_id)}</bdi>
      </p>
      <p>${this.t("operations_ownership")}: ${this.t("operations_owner_" + job.ownership)}</p>
      <p><bdi>${job.resource_keys.join(", ")}</bdi></p>
      ${job.report ? html`<p>${this.t("operations_last_check")}: <bdi>${this.time(job.report.checked_at, job.station_id)}</bdi></p>` : nothing}
      ${job.error ? html`<p role="alert">${this.t(job.error)}</p>` : nothing}
      <ul>
        ${job.blockers.map((b) => html`<li>${this.t(b)}</li>`)}
      </ul>
      ${
        journal
          ? html`<p>
                ${this.t("operations_journal")}: ${this.t("operations_journal_" + journal.status)}
              </p>
              <ul>
                ${journal.steps.map((s) => html`<li><bdi>${s.key}</bdi> — ${this.t("operations_step_" + s.state)}</li>`)}
              </ul>`
          : nothing
      }
      ${
        archived
          ? nothing
          : html`<div class="toolbar">
              <button
                ?disabled=${this._busy || this._uncertain || ["queued", "checking", "cancelled", "verified"].includes(job.status)}
                @click=${() => this.act("check", { job_id: job.id, revision: job.revision })}
              >
                ${this.t("operations_check")}
              </button>
              <button
                ?disabled=${this._busy || this._uncertain || ["queued", "checking", "cancelled", "verified"].includes(job.status)}
                @click=${() => {
                  if (window.confirm(this.t("operations_cancel_confirm")))
                    void this.act("cancel", { job_id: job.id, revision: job.revision });
                }}
              >
                ${this.t("operations_cancel")}
              </button>
              <button
                ?disabled=${this._busy || this._uncertain || !["cancelled", "verified"].includes(job.status)}
                @click=${() => this.act("archive", { job_id: job.id, revision: job.revision })}
              >
                ${this.t("operations_archive")}
              </button>
            </div>`
      }
    </details>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const selected = this.plans.find((p) => p.id === this._selected);
    return html`<section aria-label=${this.t("operations_title")}>
      <h3>${this.t("operations_title")}</h3>
      <p>${this.t("operations_intro")}</p>
      ${this._error ? html`<p role="alert" class="notice error">${this._error}</p>` : nothing}
      <div class="toolbar">
        <button ?disabled=${this._busy} @click=${() => this.load()}>
          ${this.t("operations_reload")}</button
        ><button
          ?disabled=${this._busy || this._uncertain}
          @click=${() => this.act("export", {}, false)}
        >
          ${this.t("operations_export")}
        </button>
      </div>
      <label
        >${this.t("operations_select")}<select
          aria-label=${this.t("operations_select")}
          .value=${this._selected}
          @change=${(e: Event) => {
            this._selected = (e.target as HTMLSelectElement).value;
            this._sequence++;
            this._review = undefined;
          }}
        >
          <option value="">—</option>
          ${this.plans.map((p) => html`<option value=${p.id}>${p.name} · ${this.station(p.station_id)}</option>`)}
        </select></label
      >
      <div class="toolbar">
        <button
          ?disabled=${this._busy || this._uncertain || !selected}
          @click=${() => this.act("claim_preview", { plan_id: selected!.id, revision: selected!.revision }, false)}
        >
          ${this.t("operations_claim_preview")}</button
        ><button
          ?disabled=${this._busy || this._uncertain || !selected}
          @click=${() => this.act("create", { plan_id: selected!.id, revision: selected!.revision })}
        >
          ${this.t("operations_create")}
        </button>
      </div>
      ${
        this._review
          ? html`<section aria-label=${this.t("operations_claim_review")}>
              <h4>${this.t("operations_claim_review")}</h4>
              <p>${this.t("operations_claim_warning")}</p>
              <p><bdi>${this._review.resource_keys.join(", ")}</bdi></p>
              <ul>
                ${this._review.report.blockers.map((b) => html`<li>${this.t(b)}</li>`)}
              </ul>
              <button
                ?disabled=${this._busy || this._uncertain}
                @click=${() => this.act("claim_confirm", { token: this._review!.token })}
              >
                ${this.t("operations_claim_confirm")}
              </button>
            </section>`
          : nothing
      }
      <h4>${this.t("operations_claims")}</h4>
      ${this._data?.claims.map(
        (c) =>
          html`<details>
            <summary>
              ${this.station(c.station_id)} · <bdi>${c.resource_keys.join(", ")}</bdi>
            </summary>
            <p>${this.t("operations_claim_warning")}</p>
            <button
              ?disabled=${this._busy || this._uncertain}
              @click=${() => {
                if (window.confirm(this.t("operations_release_confirm")))
                  void this.act("claim_release", { claim_id: c.id, revision: c.revision });
              }}
            >
              ${this.t("operations_release")}
            </button>
          </details>`,
      )}
      <h4>${this.t("operations_jobs")}</h4>
      ${this._data?.jobs.length ? this._data.jobs.map((j) => this.showJob(j)) : html`<p>${this.t("operations_empty")}</p>`}
      <details>
        <summary>
          ${this.t("operations_archive_title")} (${this._data?.archive.length ?? 0})
        </summary>
        ${this._data?.archive.map((j) => this.showJob(j, true))}
      </details>
    </section>`;
  }
}
customElements.define("hikvision-schedule-operations", ScheduleOperationsPanel);
