import { formatTime, UTC_ZONE } from "./time";
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
import type { Hass, Station } from "./types";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
interface Period {
  start: string;
  end: string;
}
interface Holiday {
  name: string;
  start: string;
  end: string;
  periods: Period[];
}
interface Schedule {
  id?: string;
  revision?: number;
  name: string;
  weekly: Record<string, Period[]>;
  holidays: Holiday[];
  updated_at?: string;
}
interface Preview {
  within_window: boolean;
  source: string;
  holiday: string | null;
  periods: Period[];
  date: string;
  time: string;
}
interface Readiness {
  checked_at: string;
  can_apply: false;
  checks: {
    kind: string;
    advertised: boolean | null;
    capabilities: { ids: number[]; max_periods?: number; precision?: string } | null;
    sample_id: number | null;
    read_state: string;
    error: string | null;
  }[];
}
interface Baseline {
  state: string;
  revision: number;
  checked_at: string | null;
  token: string | null;
  checks: {
    kind: string;
    state: string;
    modified: number;
    added: number;
    removed: number;
    modified_ids: number[];
    added_ids: number[];
    removed_ids: number[];
    unverified_new: number;
    unverified_missing: number;
    coverage_complete: boolean;
    capability_changed: boolean;
  }[];
}
interface BatchRow {
  id: string;
  name: string;
  state: "queued" | "running" | "done" | "failed" | "skipped" | "cancelled";
  report?: Assessment;
  error?: string;
}
interface Dependencies {
  checked_at: string;
  mapping_complete: boolean;
  users: {
    state: string;
    error: string | null;
    read: number | null;
    explicit: number;
    implicit: number;
    malformed: number;
  };
  checks: {
    kind: string;
    coverage: string;
    referenced: number;
    observed: number;
    not_observed: number;
    disabled: number;
    ids: number[];
    not_observed_ids: number[];
  }[];
}
interface Assessment {
  baseline?: Baseline;
  checked_at: string;
  complete: boolean;
  can_apply: false;
  checks: {
    kind: string;
    state: string;
    error: string | null;
    read: number;
    total: number | null;
    enabled: number | null;
    disabled: number | null;
    referenced: number | null;
  }[];
  assessment: {
    state: string;
    can_apply: false;
    limits: { key: string; needed: number; available: number | null; state: string }[];
    blockers: string[];
  };
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class IntercomSchedules extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        height: auto;
        overflow: visible;
      }
      .layout {
        display: grid;
        grid-template-columns: 230px minmax(0, 1fr);
        gap: 20px;
        align-items: start;
      }
      .library,
      .editor,
      .check {
        background: var(--surface);
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 14px;
        padding: 16px;
        min-width: 0;
      }
      .library button {
        display: block;
        width: 100%;
        margin-block: 8px;
        text-align: start;
        overflow-wrap: anywhere;
      }
      .toolbar,
      .period {
        display: flex;
        gap: 8px;
        align-items: end;
        flex-wrap: wrap;
        margin-block: 8px;
      }
      fieldset {
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 10px;
        margin: 12px 0;
        min-width: 0;
        padding: 12px;
      }
      .period label {
        width: 110px;
      }
      label {
        display: grid;
        gap: 6px;
        margin-block: 8px;
        min-width: 0;
      }
      input,
      select {
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      h3 {
        margin: 4px 0 12px;
      }
      .check {
        margin-block: 16px;
      }
      .check-row {
        border-top: 1px solid var(--divider-color, #dce5e6);
        padding-block: 10px;
        overflow-wrap: anywhere;
      }
      .hint {
        line-height: 1.6;
        overflow-wrap: anywhere;
      }
      @media (max-width: 700px) {
        .layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .period label {
          width: 100px;
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    _items: { state: true },
    _draft: { state: true },
    _busy: { state: true },
    _reading: { state: true },
    _error: { state: true },
    _notice: { state: true },
    _preview: { state: true },
    _readiness: { state: true },
    _batch: { state: true },
    _batchRunning: { state: true },
    _dependencies: { state: true },
    _assessment: { state: true },
    _assessing: { state: true },
    _uncertain: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  private _items: Schedule[] = [];
  private _draft?: Schedule;
  private _busy = false;
  private _reading = false;
  private _uncertain = false;
  private _error = "";
  private _notice = "";
  private _dirty = false;
  private _preview?: Preview;
  private _readiness?: Readiness;
  private _batch: BatchRow[] = [];
  private _batchRunning = false;
  private _batchSequence = 0;
  private _batchCancelled = false;
  private _batchName = "";
  private _dependencies?: Dependencies;
  private _assessment?: Assessment;
  private _assessing = false;
  private _assessmentSequence = 0;
  private _assessmentStation = "";
  private _station = "";
  private _checkStation = "";
  private _date = today();
  private _time = "12:00";
  private _epoch = 0;
  private _loaded = false;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (changed.has("hass") && !this.hass?.user?.is_admin) this.clear();
    else if (!this._loaded && this.hass?.user?.is_admin) {
      this._loaded = true;
      void this.load();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clear();
  }
  private clear() {
    this._epoch++;
    this.invalidateAssessment();
    this._assessing = false;
    this._items = [];
    this._draft = undefined;
    this._readiness = undefined;
    this._preview = undefined;
    this._loaded = false;
    this._busy = false;
    this._reading = false;
    this._dirty = false;
    this._uncertain = false;
    this._error = "";
    this._notice = "";
  }
  private current(epoch: number) {
    return epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin;
  }
  private api<T>(command: string, data: Record<string, unknown> = {}) {
    return this.hass!.callWS<T>({ type: `hikvision_intercom/schedules/${command}`, ...data });
  }
  canLeave() {
    return !this._busy && this.discard();
  }
  private discard() {
    return !this._dirty || window.confirm(this.t("schedule_discard"));
  }
  private async load() {
    if (this._busy || !this.discard()) return;
    const epoch = this._epoch;
    this._busy = true;
    this._error = "";
    try {
      const items = await this.api<Schedule[]>("list");
      if (this.current(epoch)) {
        this._items = items;
        this.invalidateAssessment();
        this._draft = undefined;
        this._dirty = false;
        this._uncertain = false;
        this._preview = undefined;
      }
    } catch (e) {
      if (this.current(epoch)) this._error = this.errorText(e);
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private edit(item?: Schedule) {
    if (this._busy || this._uncertain || !this.discard()) return;
    this.invalidateAssessment();
    this._draft = item
      ? structuredClone(item)
      : { name: "", weekly: Object.fromEntries(days.map((day) => [day, []])), holidays: [] };
    this._dirty = false;
    this._preview = undefined;
    this._error = "";
    this._notice = "";
  }
  private change(action: () => void) {
    action();
    this.invalidateAssessment();
    this._dirty = true;
    this._preview = undefined;
    this._notice = "";
    this.requestUpdate();
  }
  private data() {
    const d = this._draft!;
    return structuredClone({ name: d.name, weekly: d.weekly, holidays: d.holidays });
  }
  private async save(event: SubmitEvent) {
    event.preventDefault();
    if (this._busy || this._uncertain || !this._draft) return;
    const d = this._draft,
      epoch = this._epoch;
    this._busy = true;
    this._error = "";
    try {
      const item = await this.api<Schedule>(d.id ? "update" : "create", {
        data: this.data(),
        ...(d.id ? { schedule_id: d.id, revision: d.revision } : {}),
      });
      if (this.current(epoch)) {
        this._items = [...this._items.filter((s) => s.id !== item.id), item];
        this.invalidateAssessment();
        this._draft = structuredClone(item);
        this._dirty = false;
        this._notice = this.t("schedule_saved");
      }
    } catch (e) {
      if (this.current(epoch)) this.mutationError(e);
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private errorText(e: unknown) {
    const code = (e as { code?: string })?.code;
    return this.t(
      code === "revision_conflict"
        ? "schedule_revision_conflict"
        : code === "invalid_storage"
          ? "schedule_storage_unavailable"
          : (code ?? "failed"),
    );
  }
  private mutationError(e: unknown) {
    const code = (e as { code?: string })?.code;
    const rejected = new Set([
      "revision_conflict",
      "schedule_not_found",
      "schedule_limit",
      "invalid_fields",
      "invalid_text",
      "invalid_id",
      "invalid_storage",
      "storage_stopping",
      "storage_write_failed",
      "schedule_invalid_time",
      "schedule_period_limit",
      "schedule_overlap",
      "schedule_invalid_date",
      "schedule_invalid_week",
      "schedule_holiday_limit",
      "schedule_holiday_overlap",
      "unauthorized",
      "rate_limited",
    ]);
    this._error = this.errorText(e);
    if (!code || !rejected.has(code)) {
      this._uncertain = true;
      this._error = this.t("schedule_save_unknown");
    }
  }
  private async deleteDraft() {
    if (
      this._busy ||
      this._uncertain ||
      !this._draft?.id ||
      !window.confirm(this.t("schedule_delete_confirm"))
    )
      return;
    const epoch = this._epoch,
      d = this._draft;
    this._busy = true;
    this._error = "";
    try {
      await this.api("delete", { schedule_id: d.id, revision: d.revision });
      if (this.current(epoch)) {
        this._items = this._items.filter((s) => s.id !== d.id);
        this.invalidateAssessment();
        this._draft = undefined;
        this._dirty = false;
        this._preview = undefined;
        this._notice = this.t("schedule_deleted");
      }
    } catch (e) {
      if (this.current(epoch)) this.mutationError(e);
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private async preview() {
    if (this._busy || !this._draft) return;
    const epoch = this._epoch;
    this._busy = true;
    this._error = "";
    this._preview = undefined;
    try {
      const result = await this.api<Preview>("preview", {
        data: this.data(),
        date: this._date,
        time: this._time,
      });
      if (this.current(epoch)) this._preview = result;
    } catch (e) {
      if (this.current(epoch)) this._error = this.errorText(e);
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private async readiness() {
    if (this._batchRunning || this._assessing || this._reading || !this._station) return;
    const epoch = this._epoch,
      station = this._station;
    this._reading = true;
    this._error = "";
    this._readiness = undefined;
    try {
      const report = await this.api<Readiness>("readiness", { station_id: station });
      if (this.current(epoch)) {
        this._checkStation = station;
        this._readiness = report;
      }
    } catch (e) {
      if (this.current(epoch)) this._error = this.errorText(e);
    } finally {
      if (this.current(epoch)) this._reading = false;
    }
  }
  private invalidateAssessment() {
    this._batchSequence++;
    this._batch = [];
    this._batchRunning = false;
    this._assessmentSequence++;
    this._assessment = undefined;
    this._dependencies = undefined;
  }
  private async assessDraft() {
    if (
      this._batchRunning ||
      this._assessing ||
      this._reading ||
      this._busy ||
      this._uncertain ||
      !this._draft ||
      !this._station
    )
      return;
    this.invalidateAssessment();
    const epoch = this._epoch,
      sequence = this._assessmentSequence,
      station = this._station;
    this._assessing = true;
    this._error = "";
    try {
      const report = await this.api<Assessment>("assess", {
        station_id: station,
        data: this.data(),
      });
      if (
        this.current(epoch) &&
        sequence === this._assessmentSequence &&
        station === this._station
      ) {
        this._assessmentStation = station;
        this._assessment = report;
      }
    } catch (e) {
      if (this.current(epoch) && sequence === this._assessmentSequence)
        this._error = this.errorText(e);
    } finally {
      if (this.current(epoch)) this._assessing = false;
    }
  }
  private async assessStations() {
    if (
      this._busy ||
      this._uncertain ||
      this._batchRunning ||
      this._reading ||
      this._assessing ||
      !this._draft
    )
      return;
    this.invalidateAssessment();
    const epoch = this._epoch,
      sequence = this._batchSequence,
      data = this.data();
    this._batchName = data.name;
    this._batchCancelled = false;
    this._batch = this.stations.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.online && s.loaded && s.lock_enabled ? "queued" : "skipped",
    }));
    this._batchRunning = true;
    this._error = "";
    const active = () => this.current(epoch) && sequence === this._batchSequence;
    const worker = async () => {
      while (active() && !this._batchCancelled) {
        const row = this._batch.find((r) => r.state === "queued");
        if (!row) return;
        row.state = "running";
        this.requestUpdate();
        try {
          const report = await this.api<Assessment>("assess", {
            station_id: row.id,
            data: structuredClone(data),
          });
          if (!active()) return;
          row.report = report;
          row.state = "done";
        } catch (e) {
          if (!active()) return;
          row.state = "failed";
          row.error = this.errorText(e);
        }
        this.requestUpdate();
      }
    };
    await Promise.all([worker(), worker()]);
    if (active()) this._batchRunning = false;
  }
  private cancelBatch() {
    this._batchCancelled = true;
    for (const row of this._batch) if (row.state === "queued") row.state = "cancelled";
    this.requestUpdate();
  }
  private batchView() {
    if (!this._batch.length) return nothing;
    const complete = this._batch.filter((r) => !["running", "queued"].includes(r.state)).length;
    return html`<section aria-label=${this.t("schedule_batch_title")}>
      <h3>${this.t("schedule_batch_title")} · ${this._batchName}</h3>
      <p role="status">${this.t("schedule_batch_progress")}: ${complete} / ${this._batch.length}</p>
      <p class="hint">${this.t("schedule_batch_hint")}</p>
      ${this._batch.map(
        (row) =>
          html`<div class="check-row" aria-label=${row.name}>
            <strong>${row.name}</strong> · ${this.t("schedule_batch_" + row.state)}
            ${row.error ? html`<p class="danger">${row.error}</p>` : nothing}
            ${
          row.report
            ? html`<p>${this.t("schedule_assessment_" + row.report.assessment.state)}</p>
                <button
                  ?disabled=${this._busy || this._batchRunning}
                  @click=${() => {
                    this._assessment = row.report;
                    this._assessmentStation = row.id;
                    this._station = row.id;
                    this._dependencies = undefined;
                  }}
                >
                  ${this.t("schedule_batch_details")}
                </button>`
            : nothing
        }
          </div>`,
      )}
      ${this._batchRunning ? html`<button @click=${() => this.cancelBatch()}>${this.t("schedule_batch_cancel")}</button>` : nothing}
      <button
        ?disabled=${this._batchRunning}
        @click=${() =>
        downloadText(
          JSON.stringify(
            { draft_name: this._batchName, can_apply: false, stations: this._batch },
            (key, value) => (key === "token" ? undefined : value),
            2,
          ),
          "hikvision-schedule-stations.json",
          "application/json",
        )}
      >
        ${this.t("schedule_batch_export")}
      </button>
    </section>`;
  }
  private async dependencies() {
    if (this._batchRunning || this._busy || this._reading || this._assessing || !this._station)
      return;
    this.invalidateAssessment();
    const epoch = this._epoch,
      sequence = this._assessmentSequence,
      station = this._station;
    this._assessing = true;
    this._error = "";
    try {
      const result = await this.api<Dependencies>("dependencies", { station_id: station });
      if (
        this.current(epoch) &&
        sequence === this._assessmentSequence &&
        station === this._station
      ) {
        this._assessmentStation = station;
        this._dependencies = result;
      }
    } catch (e) {
      if (this.current(epoch) && sequence === this._assessmentSequence)
        this._error = this.errorText(e);
    } finally {
      if (this.current(epoch)) this._assessing = false;
    }
  }
  private dependenciesView() {
    const report = this._dependencies;
    if (!report) return nothing;
    const station = this.stations.find((s) => s.id === this._assessmentStation);
    return html`<section aria-label=${this.t("schedule_dependencies")}>
      <h3>${this.t("schedule_dependencies")}</h3>
      <p>
        ${station?.name} ·
        <bdi
          >${formatTime(report.checked_at, this.hass?.language, station?.clock?.zone ?? UTC_ZONE)}</bdi
        >
      </p>
      <p class="hint">${this.t("schedule_dependencies_hint")}</p>
      <p role="status">
        ${this.t(report.mapping_complete ? "schedule_dependencies_complete" : "schedule_dependencies_partial")}
      </p>
      <p>
        ${this.t("schedule_dependency_users")}: ${report.users.read ?? "—"} ·
        ${this.t("schedule_dependency_explicit")}: ${report.users.explicit} ·
        ${this.t("schedule_dependency_implicit")}: ${report.users.implicit} ·
        ${this.t("schedule_dependency_malformed")}: ${report.users.malformed}
      </p>
      ${report.users.error ? html`<p class="danger">${this.t(report.users.error)}</p>` : nothing}
      ${report.checks.map(
        (c) =>
          html`<div class="check-row">
            <strong>${this.t("schedule_kind_" + c.kind)}</strong> ·
            ${this.t("schedule_inventory_" + c.coverage)}
            <p>
              ${this.t("schedule_dependency_refs")}:
              ${report.users.state === "complete" ? c.referenced : "—"} ·
              ${this.t("schedule_dependency_observed")}:
              ${report.users.state === "complete" ? c.observed : "—"} ·
              ${this.t("schedule_dependency_missing")}:
              ${report.users.state === "complete" ? c.not_observed : "—"}
            </p>
            ${c.ids.length ? html`<p>${this.t("schedule_ids")}: <bdi>${c.ids.join(", ")}${c.referenced > 20 ? "…" : ""}</bdi></p>` : nothing}
            ${c.not_observed_ids.length ? html`<p>${this.t("schedule_dependency_missing")}: <bdi>${c.not_observed_ids.join(", ")}${c.not_observed > 20 ? "…" : ""}</bdi></p>` : nothing}
          </div>`,
      )}
      <button
        @click=${() => downloadText(JSON.stringify(report, null, 2), "hikvision-schedule-dependencies.json", "application/json")}
      >
        ${this.t("schedule_dependencies_export")}
      </button>
    </section>`;
  }
  private async baselineAction(action: "save" | "clear") {
    const report = this._assessment,
      baseline = report?.baseline;
    if (this._batchRunning || this._busy || this._reading || this._assessing || !baseline) return;
    if (action === "save" && !baseline.token) return;
    if (
      !window.confirm(
        this.t(
          action === "clear" ? "schedule_baseline_clear_confirm" : "schedule_baseline_save_confirm",
        ),
      )
    )
      return;
    const epoch = this._epoch;
    this._busy = true;
    this._error = "";
    try {
      await this.api(`baseline_${action}`, {
        station_id: this._assessmentStation,
        ...(action === "save" ? { token: baseline.token } : { revision: baseline.revision }),
      });
      if (this.current(epoch)) {
        this.invalidateAssessment();
        this._notice = this.t(
          action === "save" ? "schedule_baseline_saved" : "schedule_baseline_cleared",
        );
      }
    } catch (e) {
      if (this.current(epoch)) {
        this.invalidateAssessment();
        const code = (e as { code?: string })?.code;
        const known = [
          "schedule_baseline_expired",
          "schedule_baseline_limit",
          "schedule_baseline_unavailable",
          "revision_conflict",
          "station_offline",
          "station_unloaded",
          "storage_write_failed",
          "storage_stopping",
        ];
        this._error =
          code && known.includes(code) ? this.errorText(e) : this.t("schedule_baseline_unknown");
      }
    } finally {
      if (this.current(epoch)) this._busy = false;
    }
  }
  private baselineView(baseline?: Baseline) {
    if (!baseline) return nothing;
    const station = this.stations.find((s) => s.id === this._assessmentStation);
    return html`<section aria-label=${this.t("schedule_baseline_title")}>
      <h3>${this.t("schedule_baseline_title")}</h3>
      <p class="notice" role="status">${this.t("schedule_baseline_state_" + baseline.state)}</p>
      <p class="hint">${this.t("schedule_baseline_hint")}</p>
      ${baseline.checked_at ? html`<p>${this.t("schedule_baseline_date")}: <bdi>${formatTime(baseline.checked_at, this.hass?.language, station?.clock?.zone ?? UTC_ZONE)}</bdi> · ${this.t("schedule_baseline_revision")}: ${baseline.revision}</p>` : nothing}
      ${baseline.checks.map(
        (c) =>
          html`<div class="check-row">
            <strong>${this.t("schedule_kind_" + c.kind)}</strong> ·
            ${this.t("schedule_baseline_state_" + c.state)}
            ${(["modified", "added", "removed"] as const).map((key) => html`<p>${this.t("schedule_baseline_" + key)}: ${c[key]} ${c[key] ? html`<bdi>(${c[(key + "_ids") as "modified_ids" | "added_ids" | "removed_ids"].join(", ")}${c[key] > 20 ? "…" : ""})</bdi>` : nothing}</p>`)}
            ${c.capability_changed ? html`<p>${this.t("schedule_baseline_capability_changed")}</p>` : nothing}
            ${!c.coverage_complete ? html`<p class="hint">${this.t("schedule_baseline_partial")} ${this.t("schedule_baseline_unverified_new")}: ${c.unverified_new} · ${this.t("schedule_baseline_unverified_missing")}: ${c.unverified_missing}</p>` : nothing}
          </div>`,
      )}
      <div class="toolbar">
        <button
          ?disabled=${this._batchRunning || this._busy || this._assessing || this._reading || !baseline.token}
          @click=${() => this.baselineAction("save")}
        >
          ${this.t(baseline.revision ? "schedule_baseline_replace" : "schedule_baseline_save")}
        </button>
        ${baseline.revision ? html`<button ?disabled=${this._batchRunning || this._busy || this._assessing || this._reading} @click=${() => this.baselineAction("clear")}>${this.t("schedule_baseline_clear")}</button>` : nothing}
      </div>
    </section>`;
  }
  private assessmentView() {
    const report = this._assessment;
    if (!report) return nothing;
    const station = this.stations.find((s) => s.id === this._assessmentStation);
    return html`<section class="assessment" aria-label=${this.t("schedule_assessment")}>
      <h3>${this.t("schedule_assessment")}</h3>
      <p>
        <strong>${station?.name}</strong> ·
        <bdi
          >${formatTime(report.checked_at, this.hass?.language, station?.clock?.zone ?? UTC_ZONE)}</bdi
        >
      </p>
      <p class="notice" role="status">
        ${this.t("schedule_assessment_" + report.assessment.state)}
      </p>
      <p class="hint">${this.t("schedule_limits_hint")}</p>
      ${report.assessment.limits.map(
        (limit) =>
          html`<div class="check-row">
            <strong>${this.t("schedule_limit_" + limit.key)}</strong> ·
            ${this.t("schedule_limit_state_" + limit.state)}
            ${!limit.key.endsWith("precision") && limit.key !== "weekdays" ? html`<p>${this.t("schedule_needed")}: ${limit.needed} · ${this.t("schedule_advertised_limit")}: ${limit.available ?? "—"}</p>` : nothing}
          </div>`,
      )}
      <h3>${this.t("schedule_inventory")}</h3>
      <p class="hint">${this.t("schedule_inventory_hint")}</p>
      ${report.checks.map(
        (item) =>
          html`<div class="check-row inventory-row">
            <strong>${this.t("schedule_kind_" + item.kind)}</strong> ·
            ${this.t("schedule_inventory_" + item.state)}
            <p>
              ${this.t("schedule_records_read")}: <bdi>${item.read} / ${item.total ?? "—"}</bdi>
            </p>
            <p>
              ${this.t("schedule_enabled_records")}: ${item.enabled ?? "—"} ·
              ${this.t("schedule_disabled_records")}: ${item.disabled ?? "—"}
            </p>
            ${item.referenced !== null ? html`<p>${this.t("schedule_referenced_records")}: ${item.referenced}</p>` : nothing}
            ${item.error ? html`<p class="danger">${this.t(item.error)}</p>` : nothing}
          </div>`,
      )}
      ${this.baselineView(report.baseline)}
      <p class="hint">${report.assessment.blockers.map((key) => this.t(key)).join(" ")}</p>
      <button
        @click=${() =>
          downloadText(
            JSON.stringify(report, (key, value) => (key === "token" ? undefined : value), 2),
            "hikvision-schedule-assessment.json",
            "application/json",
          )}
      >
        ${this.t("schedule_export_assessment")}
      </button>
    </section>`;
  }
  private periodRows(items: Period[]) {
    return html`${items.map(
        (p, index) =>
          html`<div class="period">
            <label
              >${this.t("schedule_start")}<input
                aria-label=${this.t("schedule_start")}
                dir="ltr"
                placeholder="09:00"
                required
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                .value=${p.start}
                @input=${(e: Event) => this.change(() => (p.start = (e.target as HTMLInputElement).value))}
            /></label>
            <label
              >${this.t("schedule_end")}<input
                aria-label=${this.t("schedule_end")}
                dir="ltr"
                placeholder="17:00"
                required
                pattern="(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)"
                .value=${p.end}
                @input=${(e: Event) => this.change(() => (p.end = (e.target as HTMLInputElement).value))}
            /></label>
            <button type="button" @click=${() => this.change(() => items.splice(index, 1))}>
              ${this.t("remove")}
            </button>
          </div>`,
      )}${!items.length ? html`<p class="sub">${this.t("schedule_closed_day")}</p>` : nothing}
      <button
        type="button"
        ?disabled=${items.length >= 8}
        @click=${() => this.change(() => items.push({ start: "09:00", end: "17:00" }))}
      >
        ${this.t("schedule_add_period")}
      </button>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const d = this._draft;
    return html`<h2>${this.t("schedules")}</h2>
      <p class="hint">${this.t("schedule_intro")}</p>
      ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
      ${this._notice ? html`<p class="notice" role="status">${this._notice}</p>` : nothing}
      <div class="layout">
        <aside class="library">
          <h3>${this.t("schedule_library")}</h3>
          <button ?disabled=${this._busy} @click=${() => this.load()}>
            ${this.t("schedule_reload")}
          </button>
          <button
            class="primary"
            ?disabled=${this._busy || this._uncertain}
            @click=${() => this.edit()}
          >
            ${this.t("schedule_new")}
          </button>
          ${this._items.map((item) => html`<button ?disabled=${this._busy || this._uncertain} aria-current=${d?.id === item.id ? "true" : nothing} @click=${() => this.edit(item)}>${item.name}</button>`)}
          ${!this._items.length ? html`<p>${this.t("schedule_empty")}</p>` : nothing}
        </aside>
        <section class="editor">
          ${
            d
              ? html`<form @submit=${(e: SubmitEvent) => this.save(e)}>
                    <fieldset ?disabled=${this._busy || this._uncertain}>
                      <legend>${this.t("schedule_draft")}</legend>
                      <label
                        >${this.t("schedule_name")}<input
                          required
                          maxlength="32"
                          .value=${d.name}
                          @input=${(e: Event) => this.change(() => (d.name = (e.target as HTMLInputElement).value))}
                      /></label>
                      <p class="hint">${this.t("schedule_time_hint")}</p>
                      <h3>${this.t("schedule_week")}</h3>
                      ${days.map(
                        (day) =>
                          html`<fieldset aria-label=${this.t("day_" + day)}>
                            <legend>${this.t("day_" + day)}</legend>
                            ${this.periodRows(d.weekly[day])}
                          </fieldset>`,
                      )}
                      <h3>${this.t("schedule_holidays")}</h3>
                      <p class="hint">${this.t("schedule_holiday_hint")}</p>
                      ${d.holidays.map(
                        (h, index) =>
                          html`<fieldset class="holiday">
                            <legend>${this.t("schedule_holiday")} ${index + 1}</legend>
                            <label
                              >${this.t("schedule_holiday_name")}<input
                                required
                                maxlength="32"
                                .value=${h.name}
                                @input=${(e: Event) => this.change(() => (h.name = (e.target as HTMLInputElement).value))}
                            /></label>
                            <label
                              >${this.t("schedule_first_date")}<input
                                type="date"
                                min="2000-01-01"
                                max="2037-12-31"
                                required
                                .value=${h.start}
                                @input=${(e: Event) => this.change(() => (h.start = (e.target as HTMLInputElement).value))}
                            /></label>
                            <label
                              >${this.t("schedule_last_date")}<input
                                type="date"
                                min="2000-01-01"
                                max="2037-12-31"
                                required
                                .value=${h.end}
                                @input=${(e: Event) => this.change(() => (h.end = (e.target as HTMLInputElement).value))}
                            /></label>
                            ${this.periodRows(h.periods)}<button
                              type="button"
                              @click=${() => this.change(() => d.holidays.splice(index, 1))}
                            >
                              ${this.t("schedule_remove_holiday")}
                            </button>
                          </fieldset>`,
                      )}
                      <button
                        type="button"
                        ?disabled=${d.holidays.length >= 64}
                        @click=${() => this.change(() => d.holidays.push({ name: "", start: today(), end: today(), periods: [] }))}
                      >
                        ${this.t("schedule_add_holiday")}
                      </button>
                      <div class="toolbar">
                        <button class="primary" type="submit">${this.t("schedule_save")}</button>
                        ${d.id ? html`<button type="button" @click=${() => this.deleteDraft()}>${this.t("schedule_delete")}</button>` : nothing}
                      </div>
                    </fieldset>
                  </form>
                  <section aria-label=${this.t("schedule_preview")}>
                    <h3>${this.t("schedule_preview")}</h3>
                    <p class="hint">${this.t("schedule_preview_hint")}</p>
                    <div class="toolbar">
                      <label
                        >${this.t("schedule_date")}<input
                          type="date"
                          .value=${this._date}
                          ?disabled=${this._busy}
                          @input=${(e: Event) => {
                            this._date = (e.target as HTMLInputElement).value;
                            this._preview = undefined;
                          }}
                      /></label>
                      <label
                        >${this.t("schedule_time")}<input
                          type="time"
                          .value=${this._time}
                          ?disabled=${this._busy}
                          @input=${(e: Event) => {
                            this._time = (e.target as HTMLInputElement).value;
                            this._preview = undefined;
                          }}
                      /></label>
                      <button ?disabled=${this._busy} @click=${() => this.preview()}>
                        ${this.t("schedule_evaluate")}
                      </button>
                    </div>
                    ${
                      this._preview
                        ? html`<div class="notice" role="status">
                            <div>
                              <strong
                                >${this.t(this._preview.within_window ? "schedule_inside" : "schedule_outside")}</strong
                              >
                              <p>
                                ${this.t("schedule_source_" + this._preview.source)}
                                ${this._preview.holiday ?? ""}
                              </p>
                              <bdi
                                >${this._preview.periods.map((p) => `${p.start}–${p.end}`).join(", ") || this.t("schedule_closed_day")}</bdi
                              >
                            </div>
                          </div>`
                        : nothing
                    }
                  </section>`
              : html`<p>${this.t("schedule_select")}</p>`
          }
        </section>
      </div>
      <section class="check">
        <h3>${this.t("schedule_readiness")}</h3>
        <p class="hint">${this.t("schedule_readiness_hint")}</p>
        <div class="toolbar">
          <label
            >${this.t("station")}<select
              aria-label=${this.t("station")}
              .value=${this._station}
              ?disabled=${this._reading || this._busy}
              @change=${(e: Event) => {
                this._station = (e.target as HTMLSelectElement).value;
                this._readiness = undefined;
                this.invalidateAssessment();
                this.requestUpdate();
              }}
            >
              <option value="">${this.t("select_station")}</option>
              ${this.stations.filter((s) => s.lock_enabled).map((s) => html`<option value=${s.id} ?disabled=${!s.online}>${s.name}</option>`)}
            </select></label
          >
          <button
            ?disabled=${this._batchRunning || this._assessing || this._reading || !this.stations.some((s) => s.id === this._station && s.online && s.lock_enabled)}
            @click=${() => this.readiness()}
          >
            ${this.t(this._reading ? "loading" : "schedule_check")}
          </button>
          <button
            ?disabled=${this._batchRunning || this._reading || this._assessing || this._busy || this._uncertain || !d || !this.stations.some((s) => s.id === this._station && s.online && s.lock_enabled)}
            @click=${() => this.assessDraft()}
          >
            ${this.t(this._assessing ? "loading" : "schedule_assess")}
          </button>
        </div>
        ${
          this._readiness
            ? html`<p>
                  <strong>${this.stations.find((s) => s.id === this._checkStation)?.name}</strong> ·
                  <bdi
                    >${formatTime(this._readiness.checked_at, this.hass.language, this.stations.find((s) => s.id === this._checkStation)?.clock?.zone ?? UTC_ZONE)}</bdi
                  >
                </p>
                ${this._readiness.checks.map(
                  (c) =>
                    html`<div class="check-row">
                      <strong>${this.t("schedule_kind_" + c.kind)}</strong> ·
                      ${this.t("schedule_read_" + c.read_state)}
                      ${c.capabilities ? html`<p>${this.t("schedule_ids")}: <bdi>${c.capabilities.ids.join("–")}</bdi> · ${this.t("schedule_sample")}: ${c.sample_id}</p>` : nothing}
                      ${c.error ? html`<p>${this.t(c.error)}</p>` : nothing}
                    </div>`,
                )}
                <button
                  @click=${() => downloadText(JSON.stringify(this._readiness, null, 2), "hikvision-schedule-readiness.json", "application/json")}
                >
                  ${this.t("schedule_export_check")}
                </button>`
            : nothing
        }
        <button
          ?disabled=${this._batchRunning || this._busy || this._reading || this._assessing || !this.stations.some((s) => s.id === this._station && s.online && s.lock_enabled)}
          @click=${() => this.dependencies()}
        >
          ${this.t("schedule_dependencies")}
        </button>
        <button
          ?disabled=${this._busy || this._uncertain || this._reading || this._assessing || this._batchRunning || !d || !this.stations.length}
          @click=${() => this.assessStations()}
        >
          ${this.t("schedule_batch_start")}
        </button>
        ${this.batchView()} ${this.dependenciesView()} ${this.assessmentView()}
        <p class="hint">${this.t("schedule_apply_blocked")}</p>
      </section>`;
  }
}
customElements.define("hikvision-intercom-schedules", IntercomSchedules);
