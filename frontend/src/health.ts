import "./fleet-clocks";
import "./event-tools";
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { formatTime, UTC_ZONE } from "./time";
import { downloadText } from "./download";
import { boundedRequest } from "./request";
import "./call-controls";
import type { Hass, Station, StationClock } from "./types";

interface HealthRead {
  id: string;
  refresh: boolean;
  epoch: number;
}

interface QualityMetric {
  requests: number;
  sample_count: number;
  p95_ms: number | null;
  failure_percent: number | null;
  window_failure_percent: number | null;
  baseline_samples: number;
  baseline_p95_ms: number | null;
  comparison_samples: number;
  p95_delta_ms: number | null;
  repeat_attempts_after_failure?: number;
}

interface Health {
  integration_version: string;
  model?: string;
  firmware?: string;
  online?: boolean;
  generated_at: string;
  clock?: Partial<StationClock>;
  access?: { queue_depth: number; errors: Record<string, number>; last_error?: string | null };
  quality?: {
    requests: QualityMetric;
    door_commands: QualityMetric;
    synchronization: QualityMetric;
  };
  events?: {
    stream: string;
    history: string;
    reconnects: number;
    telemetry?: {
      stream_arrival_delay: { samples: number; median: number | null; p95: number | null };
      accepted: number;
      duplicates: number;
      transport_gaps?: {
        count: number;
        disconnected_seconds: number;
        open: boolean;
        lost_event_count: null;
      };
    };
  };
  media?: {
    checked_at?: string;
    call_commands?: string[];
    audio_channels?: { id: number; enabled: boolean | null; codec: string }[];
    errors?: Record<string, string>;
  } | null;
  camera?: { snapshot: boolean; stream: boolean };
  audio?: {
    active: boolean;
    source: string | null;
    last_result: { acknowledged?: boolean | null; physical_result?: string } | null;
  };
}
interface Acceptance {
  revision: number;
  steps: string[];
  basis: string;
  results: Record<string, { state: string; checked_at: string; basis: string }>;
}
interface UpgradeReadiness {
  ready: boolean;
  generated_at: string;
  blockers: string[];
  warnings: string[];
  checks: { id: string; state: "passed" | "warning" | "failed"; count: number }[];
  summary: { stations: number; entries: number };
}
interface FleetExport {
  filename: string;
  mime_type: string;
  content: string;
}
interface StationHealthHistory {
  station_id: string;
  period_days: number;
  storage_failed: boolean;
  records: { at: string; online: boolean; poll_ms: number | null; sync: string; events: string }[];
}

function stationAttention(station: Station, report?: Health): string[] {
  const reasons: string[] = [];
  if (!station.online) reasons.push("health_triage_offline");
  if (report?.access?.queue_depth && report.access.queue_depth > 0)
    reasons.push("health_triage_pending");
  if (
    report?.access?.last_error ||
    Object.values(report?.access?.errors ?? {}).some((count) => count > 0)
  )
    reasons.push("health_triage_sync_error");
  if (
    report?.clock?.status === "ready" &&
    ["ahead", "behind", "repeated_ahead", "repeated_behind"].includes(
      report.clock.drift_state ?? "",
    )
  )
    reasons.push("health_triage_clock");
  return reasons;
}

export class IntercomHealth extends LitElement {
  static styles = [
    styles,
    css`
      .health-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
        gap: 16px;
      }
      .health-card {
        background: var(--surface, white);
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: var(--hik-radius, 14px);
        padding: 18px;
        margin-block: 12px;
        min-width: 0;
      }
      .health-card p {
        overflow-wrap: anywhere;
      }
      .health-card .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .health-card .toolbar label {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      input[type="checkbox"] {
        width: auto;
      }
      .field-tests form {
        margin-block: 16px;
      }
      .health-timeline {
        display: flex;
        gap: 2px;
        min-height: 28px;
        align-items: stretch;
      }
      .health-timeline span {
        flex: 1;
        min-width: 2px;
        border-radius: 3px;
        background: #b34a50;
      }
      .health-timeline span[data-online="true"] {
        background: #438b68;
      }
      .health-triage {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-block: 16px;
      }
      .health-triage .badge {
        padding: 8px 12px;
      }
      .health-attention {
        margin-block: 10px;
        color: var(--error-color, #b34a50);
        font-weight: 600;
      }
      .health-quality {
        margin-block: 14px;
      }
      .quality-values {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
        gap: 8px;
        margin-block: 8px 16px;
      }
      .quality-values div {
        min-width: 0;
      }
      .quality-values dt {
        font-size: 0.85em;
        color: var(--secondary-text-color);
        overflow-wrap: anywhere;
      }
      .quality-values dd {
        margin: 0;
        font-variant-numeric: tabular-nums;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    callBusy: { attribute: false },
    onCallBusy: { attribute: false },
    _callDetails: { state: true },
    stations: { attribute: false },
    supportBundle: { type: Boolean },
    fleetInventory: { type: Boolean },
    upgradeReadiness: { type: Boolean },
    _readiness: { state: true },
    _operationalBusy: { state: true },
    _operationalError: { state: true },
    _reports: { state: true },
    _history: { state: true },
    _busy: { state: true },
    _errors: { state: true },
    _fieldErrors: { state: true },
    _acceptance: { state: true },
    _selected: { state: true },
    _haConnected: { state: true },
    _bundleBusy: { state: true },
    _bundleError: { state: true },
    _attentionOnly: { state: true },
  };
  hass?: Hass;
  callBusy: ReadonlySet<string> = new Set();
  onCallBusy?: (station: string, busy: boolean) => void;
  private _callDetails = new Set<string>();
  stations: Station[] = [];
  supportBundle = false;
  fleetInventory = false;
  upgradeReadiness = false;
  private _readiness?: UpgradeReadiness;
  private _operationalBusy = "";
  private _operationalError = "";
  private _reports: Record<string, Health> = {};
  private _history: Record<string, StationHealthHistory> = {};
  private _busy = new Set<string>();
  private _errors: Record<string, string> = {};
  private _fieldErrors: Record<string, string> = {};
  private _acceptance: Record<string, Acceptance> = {};
  private _selected = new Set<string>();
  private epoch = 0;
  private reads: HealthRead[] = [];
  private activeReads = 0;
  private attempted = new Set<string>();
  private pending = new Set<AbortController>();
  private fieldWrites = new Set<string>();
  private connection?: Hass["connection"];
  private _haConnected = true;
  private _bundleBusy = false;
  private _bundleError = "";
  private _attentionOnly = false;
  private haDisconnected = () => {
    this._haConnected = false;
    for (const id of this.fieldWrites) this.uncertainField(id);
    this.cancelPending();
  };
  private haReady = () => {
    this._haConnected = true;
    // Reconnect may refresh cached diagnostics, never device commands or saves.
    this.attempted.clear();
    for (const station of this.stations) this.read(station.id, false);
  };
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    if (!this.hass?.user?.is_admin) {
      this.clear();
      this.bindConnection(undefined);
      return;
    }
    const replaced = this.connection !== this.hass.connection;
    if (replaced) {
      this.clear();
      this.bindConnection(this.hass.connection);
    }
    if (replaced || changed.has("stations")) this.loadMissing();
  }
  connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated) this.requestUpdate();
  }
  private loadMissing() {
    for (const station of this.stations)
      if (!this._reports[station.id] && !this.attempted.has(station.id))
        this.read(station.id, false);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.clear();
    this.bindConnection(undefined);
  }
  private bindConnection(connection?: Hass["connection"]) {
    this.connection?.removeEventListener?.("disconnected", this.haDisconnected);
    this.connection?.removeEventListener?.("ready", this.haReady);
    this.connection = connection;
    this._haConnected = connection?.connected !== false;
    connection?.addEventListener?.("disconnected", this.haDisconnected);
    connection?.addEventListener?.("ready", this.haReady);
  }
  private cancelPending() {
    this.epoch++;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    this.fieldWrites.clear();
    this.reads = [];
    this.activeReads = 0;
    this.attempted.clear();
    if (this._busy.size) this._busy = new Set();
  }
  private clear() {
    this.cancelPending();
    // Avoid an update loop after role loss.
    if (Object.keys(this._reports).length) this._reports = {};
    if (Object.keys(this._history).length) this._history = {};
    if (this._callDetails.size) this._callDetails = new Set();
    if (Object.keys(this._acceptance).length) this._acceptance = {};
    if (Object.keys(this._errors).length) this._errors = {};
    if (Object.keys(this._fieldErrors).length) this._fieldErrors = {};
    if (this._selected.size) this._selected = new Set();
    this._bundleBusy = false;
    this._bundleError = "";
    this._readiness = undefined;
    this._operationalBusy = "";
    this._operationalError = "";
    if (this._attentionOnly) this._attentionOnly = false;
  }
  private valid(epoch: number) {
    return (
      epoch === this.epoch &&
      this.isConnected &&
      !!this.hass?.user?.is_admin &&
      this._haConnected &&
      this.hass.connection.connected !== false
    );
  }
  private read(id: string, refresh: boolean) {
    if (!this.valid(this.epoch) || this._busy.has(id)) return;
    this.attempted.add(id);
    this._busy = new Set([...this._busy, id]);
    this.reads.push({ id, refresh, epoch: this.epoch });
    this.pumpReads();
  }
  private pumpReads() {
    while (this.activeReads < 3 && this.reads.length && this.valid(this.epoch)) {
      const read = this.reads.shift()!;
      if (!this.stations.some((station) => station.id === read.id)) {
        this._busy.delete(read.id);
        this._busy = new Set(this._busy);
        continue;
      }
      this.activeReads++;
      void this.performRead(read);
    }
  }
  private async performRead({ id, refresh, epoch }: HealthRead) {
    const controller = new AbortController();
    const hass = this.hass!;
    this.pending.add(controller);
    try {
      // Live device inspection has a 35s server budget; cached snapshots do not.
      const report = await boundedRequest(
        () =>
          hass.callWS<Health>({
            type: `hikvision_intercom/health/${refresh ? "refresh" : "get"}`,
            station_id: id,
          }),
        refresh ? 45000 : 20000,
        controller.signal,
      );
      if (
        this.valid(epoch) &&
        hass.connection === this.hass?.connection &&
        this.stations.some((station) => station.id === id)
      ) {
        this._reports = { ...this._reports, [id]: report };
        this._errors = { ...this._errors, [id]: "" };
        // Older installations do not publish history; retain their live health card.
        try {
          const history = await boundedRequest(
            () =>
              hass.callWS<StationHealthHistory>({
                type: "hikvision_intercom/health/history",
                station_id: id,
              }),
            20000,
            controller.signal,
          );
          if (
            this.valid(epoch) &&
            hass.connection === this.hass?.connection &&
            history.station_id === id
          )
            this._history = { ...this._history, [id]: history };
        } catch {
          /* Health history is optional on older servers. */
        }
      }
    } catch {
      if (this.valid(epoch)) this._errors = { ...this._errors, [id]: this.t("health_read_failed") };
    } finally {
      this.pending.delete(controller);
      // An old connection must not consume a slot owned by its replacement.
      if (epoch === this.epoch) {
        this.activeReads--;
        this._busy.delete(id);
        this._busy = new Set(this._busy);
        this.pumpReads();
      }
    }
  }
  private refreshSelected() {
    for (const station of this.stations)
      if (this._selected.has(station.id)) this.read(station.id, true);
  }
  private async downloadBundle() {
    if (!this.valid(this.epoch) || this._bundleBusy) return;
    const epoch = this.epoch;
    const hass = this.hass!;
    const connection = hass.connection;
    const controller = new AbortController();
    this.pending.add(controller);
    this._bundleBusy = true;
    this._bundleError = "";
    try {
      const report = await boundedRequest(
        () =>
          hass.callWS<Record<string, unknown>>({
            type: "hikvision_intercom/support/bundle",
          }),
        30000,
        controller.signal,
      );
      if (this.valid(epoch) && this.hass?.connection === connection)
        downloadText(
          JSON.stringify(report, null, 2),
          "wiskey-support-bundle.json",
          "application/json",
        );
    } catch {
      if (this.valid(epoch)) this._bundleError = this.t("support_bundle_failed");
    } finally {
      this.pending.delete(controller);
      if (epoch === this.epoch) this._bundleBusy = false;
    }
  }
  private async downloadFleet(format: "json" | "csv") {
    if (!this.valid(this.epoch) || this._operationalBusy) return;
    const epoch = this.epoch;
    const connection = this.hass!.connection;
    const controller = new AbortController();
    this.pending.add(controller);
    this._operationalBusy = `fleet-${format}`;
    this._operationalError = "";
    try {
      const result = await boundedRequest(
        () =>
          this.hass!.callWS<FleetExport>({
            type: "hikvision_intercom/fleet/inventory_export",
            format,
          }),
        30000,
        controller.signal,
      );
      if (this.valid(epoch) && this.hass?.connection === connection)
        downloadText(result.content, result.filename, result.mime_type);
    } catch {
      if (this.valid(epoch)) this._operationalError = this.t("fleet_inventory_failed");
    } finally {
      this.pending.delete(controller);
      if (epoch === this.epoch) this._operationalBusy = "";
    }
  }
  private async checkUpgradeReadiness() {
    if (!this.valid(this.epoch) || this._operationalBusy) return;
    const epoch = this.epoch;
    const connection = this.hass!.connection;
    const controller = new AbortController();
    this.pending.add(controller);
    this._operationalBusy = "upgrade";
    this._operationalError = "";
    try {
      const result = await boundedRequest(
        () =>
          this.hass!.callWS<UpgradeReadiness>({
            type: "hikvision_intercom/upgrade/readiness",
          }),
        30000,
        controller.signal,
      );
      if (this.valid(epoch) && this.hass?.connection === connection) this._readiness = result;
    } catch {
      if (this.valid(epoch)) this._operationalError = this.t("upgrade_readiness_failed");
    } finally {
      this.pending.delete(controller);
      if (epoch === this.epoch) this._operationalBusy = "";
    }
  }
  private uncertainField(id: string) {
    const acceptance = { ...this._acceptance };
    delete acceptance[id];
    this._acceptance = acceptance;
    this._fieldErrors = { ...this._fieldErrors, [id]: this.t("field_save_unknown") };
  }
  private async field(id: string, step?: string, state?: string) {
    if (!this.valid(this.epoch) || this._busy.has(id) || (step && !this._acceptance[id])) return;
    const epoch = this.epoch;
    const hass = this.hass!;
    const controller = new AbortController();
    this.pending.add(controller);
    if (step) this.fieldWrites.add(id);
    this._busy = new Set([...this._busy, id]);
    try {
      const result = await boundedRequest(
        () =>
          hass.callWS<Acceptance>({
            type: `hikvision_intercom/acceptance/${step ? "update" : "get"}`,
            station_id: id,
            ...(step ? { step, state, revision: this._acceptance[id].revision } : {}),
          }),
        step ? 30000 : 20000,
        controller.signal,
      );
      if (this.valid(epoch) && hass.connection === this.hass?.connection) {
        this._acceptance = { ...this._acceptance, [id]: result };
        this._fieldErrors = { ...this._fieldErrors, [id]: "" };
      }
    } catch {
      if (this.valid(epoch)) {
        if (step) this.uncertainField(id);
        else this._fieldErrors = { ...this._fieldErrors, [id]: this.t("failed") };
      }
    } finally {
      this.pending.delete(controller);
      if (epoch === this.epoch) {
        this.fieldWrites.delete(id);
        this._busy.delete(id);
        this._busy = new Set(this._busy);
      }
    }
  }
  private fieldView(station: Station) {
    const data = this._acceptance[station.id];
    if (!data) return nothing;
    return html`<div class="field-tests">
      <p>${this.t("field_hint")}</p>
      ${data.steps.map(
        (step) =>
          html`<form
            class="toolbar"
            @submit=${(e: Event) => {
              e.preventDefault();
              const state = String(new FormData(e.target as HTMLFormElement).get("state"));
              void this.field(station.id, step, state);
            }}
          >
            <label
              >${this.t("field_" + step)}<select
                name="state"
                aria-label=${this.t("field_" + step)}
                .value=${data.results[step]?.state ?? "unverified"}
              >
                ${["unverified", "passed", "failed", "deferred"].map((state) => html`<option value=${state} ?selected=${(data.results[step]?.state ?? "unverified") === state}>${this.t("field_" + state)}</option>`)}
              </select></label
            ><button ?disabled=${!this._haConnected || this._busy.has(station.id)}>
              ${this.t("save")}
            </button>
            <small
              >${data.results[step] ? formatTime(data.results[step].checked_at, this.hass?.language, station.clock?.zone ?? UTC_ZONE) : ""}</small
            >
          </form>`,
      )}
      <button
        @click=${() => downloadText(JSON.stringify({ format: "hikvision_intercom.field_results", ...data }, null, 2), "hikvision-field-results.json", "application/json")}
      >
        ${this.t("field_export")}
      </button>
    </div>`;
  }
  private qualityView(report: Health) {
    if (!report.quality) return nothing;
    const value = (number: number | null | undefined, suffix = "") =>
      number === null || number === undefined ? "—" : `${number}${suffix}`;
    const gaps = report.events?.telemetry?.transport_gaps;
    return html`<details class="health-quality">
      <summary>${this.t("quality_title")}</summary>
      <p class="sub">${this.t("quality_scope")}</p>
      ${(["requests", "synchronization", "door_commands"] as const).map((key) => {
        const metric = report.quality![key];
        if (!metric) return nothing;
        return html`<section>
          <strong>${this.t("quality_" + key)}</strong>
          <dl class="quality-values">
            <div>
              <dt>${this.t("quality_attempts")}</dt>
              <dd>${metric.requests}</dd>
            </div>
            <div>
              <dt>${this.t("quality_failure")}</dt>
              <dd>${value(metric.failure_percent, "%")}</dd>
            </div>
            <div>
              <dt>${this.t("quality_window_failure")}</dt>
              <dd>${value(metric.window_failure_percent, "%")}</dd>
            </div>
            <div>
              <dt>${this.t("quality_p95")}</dt>
              <dd>${value(metric.p95_ms, " ms")}</dd>
            </div>
            <div>
              <dt>${this.t("quality_baseline")}</dt>
              <dd>${value(metric.baseline_p95_ms, " ms")}</dd>
            </div>
            <div>
              <dt>${this.t("quality_change")}</dt>
              <dd>${value(metric.p95_delta_ms, " ms")}</dd>
            </div>
            ${
              metric.repeat_attempts_after_failure !== undefined
                ? html`<div>
                    <dt>${this.t("quality_repeats")}</dt>
                    <dd>${metric.repeat_attempts_after_failure}</dd>
                  </div>`
                : nothing
            }
          </dl>
        </section>`;
      })}
      ${gaps ? html`<p>${this.t("quality_gaps")}: ${gaps.count} · ${value(gaps.disconnected_seconds, " s")} · ${this.t(gaps.open ? "quality_gap_open" : "quality_gap_closed")}</p>` : nothing}
      <p class="field-note">${this.t("quality_reference_hint")}</p>
      <p class="field-note">${this.t("quality_evidence_hint")}</p>
    </details>`;
  }
  private card(station: Station) {
    const report = this._reports[station.id];
    const attention = stationAttention(station, report);
    const delays = report?.events?.telemetry?.stream_arrival_delay;
    const history = this._history[station.id];
    const recent = history?.records.slice(-48) ?? [];
    const onlineCount = recent.filter((sample) => sample.online).length;
    return html`<article class="card health-card">
      <div class="toolbar">
        <label
          ><input
            type="checkbox"
            aria-label=${station.name}
            .checked=${this._selected.has(station.id)}
            @change=${(e: Event) => {
              const next = new Set(this._selected);
              (e.target as HTMLInputElement).checked
                ? next.add(station.id)
                : next.delete(station.id);
              this._selected = next;
            }}
          />
          ${station.name}</label
        >
        <span class="badge">${this.t(station.online ? "online" : "offline")}</span>
      </div>
      ${attention.length ? html`<p class="health-attention">${attention.map((reason) => this.t(reason)).join(" · ")}</p>` : nothing}
      <p>${report?.model ?? station.model ?? ""} · ${report?.firmware ?? station.firmware ?? ""}</p>
      <p>
        ${this.t("health_stream")}:
        ${report?.events?.stream ? this.t("event_" + report.events.stream) : "—"} ·
        ${this.t("health_history")}:
        ${report?.events?.history ? this.t("event_" + report.events.history) : "—"}
      </p>
      <p>${this.t("health_queue")}: ${report?.access?.queue_depth ?? "—"}</p>
      <p>
        ${this.t("health_errors")}:
        ${
          Object.entries(report?.access?.errors ?? {})
            .map(([code, n]) => `${this.t(code)} (${n})`)
            .join(" · ") || this.t(report?.access?.last_error ?? "none")
        }
      </p>
      <p>${this.t("health_skew")}: ${report?.clock?.skew_seconds ?? "—"}</p>
      ${report?.clock?.status === "ready" && ["ahead", "behind", "repeated_ahead", "repeated_behind"].includes(report.clock.drift_state ?? "") ? html`<p class="notice error">${this.t("health_clock_warning")}</p>` : nothing}
      <p>${this.t("health_delay")}: ${delays?.median ?? "—"} / ${delays?.p95 ?? "—"}</p>
      <p class="sub">${this.t("event_clock_hint")}</p>
      ${report ? this.qualityView(report) : nothing}
      ${
        report
          ? html`<details class="media-path-evidence">
              <summary>${this.t("health_media_path")}</summary>
              <p>
                ${this.t("health_video_path")}:
                ${report.camera?.stream ? this.t("health_capability_advertised") : report.camera ? this.t("health_capability_missing") : this.t("not_verified")}
              </p>
              <p>
                ${this.t("health_incoming_path")}:
                ${report.media?.audio_channels?.length ? report.media.audio_channels.map((channel) => `${channel.codec} · ${channel.enabled === null ? this.t("not_verified") : this.t(channel.enabled ? "configured" : "not_configured")}`).join(", ") : this.t("not_verified")}
              </p>
              <p>
                ${this.t("health_outgoing_path")}:
                ${report.audio?.active ? this.t("health_audio_session_active") : report.audio?.last_result ? this.t("health_last_audio_result") : this.t("not_verified")}
              </p>
              <p class="field-note">${this.t("health_media_limit")}</p>
            </details>`
          : nothing
      }
      ${
        history
          ? html`<div class="health-history">
              <strong>${this.t("health_timeline")}</strong>
              <p class="sub">
                ${this.t("health_samples")}: ${onlineCount}/${recent.length} ·
                ${this.t("health_observational")}
              </p>
              <div
                class="health-timeline"
                role="img"
                aria-label=${`${this.t("health_samples")}: ${onlineCount}/${recent.length}`}
              >
                ${recent.map((sample) => html`<span data-online=${sample.online ? "true" : "false"} title=${`${sample.at} · ${this.t(sample.online ? "online" : "offline")} · ${sample.poll_ms ?? "—"} ms · ${sample.sync}`}></span>`)}
              </div>
              ${history.storage_failed ? html`<p class="notice error">${this.t("health_history_save_failed")}</p>` : nothing}
            </div>`
          : nothing
      }
      <div class="toolbar">
        <button
          ?disabled=${!this._haConnected || this._busy.has(station.id)}
          @click=${() => this.read(station.id, true)}
        >
          ${this.t("refresh")}
        </button>
        <button
          ?disabled=${!report}
          @click=${() => downloadText(JSON.stringify(report, null, 2), "hikvision-compatibility.json", "application/json")}
        >
          ${this.t("health_export")}
        </button>
        <button
          ?disabled=${!this._haConnected || this._busy.has(station.id)}
          @click=${() => this.field(station.id)}
        >
          ${this.t("field_tests")}
        </button>
      </div>
      ${this._busy.has(station.id) ? html`<p role="status">${this.t("loading")}</p>` : nothing}
      ${this._errors[station.id] ? html`<p role="status">${this._errors[station.id]}</p>` : nothing}
      ${report?.generated_at ? html`<small>${formatTime(report.generated_at, this.hass?.language, station.clock?.zone ?? UTC_ZONE)}</small>` : nothing}
      ${
        report?.media
          ? html`<details
              .open=${this._callDetails.has(station.id)}
              @toggle=${(event: Event) => {
                const open = (event.currentTarget as HTMLDetailsElement).open;
                const next = new Set(this._callDetails);
                open ? next.add(station.id) : next.delete(station.id);
                this._callDetails = next;
              }}
            >
              <summary>${this.t("media_signals")}</summary>
              ${
                this._callDetails.has(station.id)
                  ? html`<hikvision-intercom-call-controls
                      .hass=${this.hass}
                      .station=${station}
                      .blocked=${this.callBusy.has(station.id)}
                      .onBusy=${this.onCallBusy}
                    ></hikvision-intercom-call-controls>`
                  : nothing
              }
              <p>
                ${report.media.audio_channels?.map((c) => `${c.id}: ${c.codec} · ${c.enabled === true ? "enabled" : c.enabled === false ? "disabled" : "unknown"}`).join(" · ")}
              </p>
              ${Object.values(report.media.errors ?? {}).map((code) => html`<p>${this.t(code)}</p>`)}
            </details>`
          : nothing
      }
      <hikvision-intercom-event-tools
        .hass=${this.hass}
        .station=${station}
      ></hikvision-intercom-event-tools>
      ${this._fieldErrors[station.id] ? html`<p class="notice error" role="alert">${this._fieldErrors[station.id]}</p>` : nothing}
      ${this.fieldView(station)}
    </article>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const attention = this.stations.filter(
      (station) => stationAttention(station, this._reports[station.id]).length,
    );
    const visibleStations = this._attentionOnly ? attention : this.stations;
    return html`<section>
      <h2>${this.t("health")}</h2>
      <p>${this.t("health_cached")}</p>
      <p>${this.t("health_scope")}</p>
      <div class="health-triage" aria-label=${this.t("health_triage_title")}>
        <strong>${this.t("health_triage_title")}</strong>
        <span class="badge">${this.t("health_triage_stations")}: ${this.stations.length}</span>
        <span class="badge"
          >${this.t("health_triage_online")}:
          ${this.stations.filter((station) => station.online).length}</span
        >
        <span class="badge">${this.t("health_triage_attention")}: ${attention.length}</span>
        <label
          ><input
            type="checkbox"
            .checked=${this._attentionOnly}
            @change=${(event: Event) => (this._attentionOnly = (event.target as HTMLInputElement).checked)}
          />${this.t("health_triage_filter")}</label
        >
        <small>${this.t("health_triage_scope")}</small>
      </div>
      ${!this._haConnected ? html`<p class="notice error" role="alert">${this.t("health_disconnected")}</p>` : nothing}
      <div class="toolbar">
        <button
          ?disabled=${!this._haConnected || !this._selected.size}
          @click=${this.refreshSelected}
        >
          ${this.t("health_refresh")}
        </button>
        ${
          this.supportBundle
            ? html`<button
                ?disabled=${!this._haConnected || this._bundleBusy}
                @click=${this.downloadBundle}
              >
                ${this.t("support_bundle_download")}
              </button>`
            : nothing
        }
        ${
          this.fleetInventory
            ? html`<button
                  ?disabled=${!this._haConnected || !!this._operationalBusy}
                  @click=${() => this.downloadFleet("json")}
                >
                  ${this.t("fleet_inventory_json")}
                </button>
                <button
                  ?disabled=${!this._haConnected || !!this._operationalBusy}
                  @click=${() => this.downloadFleet("csv")}
                >
                  ${this.t("fleet_inventory_csv")}
                </button>`
            : nothing
        }
        ${
          this.upgradeReadiness
            ? html`<button
                ?disabled=${!this._haConnected || !!this._operationalBusy}
                @click=${this.checkUpgradeReadiness}
              >
                ${this.t("upgrade_readiness_check")}
              </button>`
            : nothing
        }
      </div>
      ${this.supportBundle ? html`<p class="sub">${this.t("support_bundle_hint")}</p>` : nothing}
      ${this.fleetInventory ? html`<p class="sub">${this.t("fleet_inventory_hint")}</p>` : nothing}
      ${this._bundleError ? html`<p class="notice error" role="alert">${this._bundleError}</p>` : nothing}
      ${this._operationalError ? html`<p class="notice error" role="alert">${this._operationalError}</p>` : nothing}
      ${
        this._readiness
          ? html`<article class="card health-card" aria-label=${this.t("upgrade_readiness_title")}>
              <div class="toolbar">
                <h3>${this.t("upgrade_readiness_title")}</h3>
                <span class="badge ${this._readiness.ready ? "" : "error"}">
                  ${this.t(this._readiness.ready ? "upgrade_ready" : "upgrade_attention")}
                </span>
              </div>
              <p>
                ${this.t("upgrade_readiness_summary")
                  .replace("{stations}", String(this._readiness.summary.stations))
                  .replace("{entries}", String(this._readiness.summary.entries))}
              </p>
              <ul>
                ${this._readiness.checks.map(
                  (check) =>
                    html`<li>
                      ${this.t("upgrade_check_" + check.id)}:
                      ${this.t("upgrade_state_" + check.state)}
                      ${check.count ? html` (${check.count})` : nothing}
                    </li>`,
                )}
              </ul>
              <p class="sub">${this.t("upgrade_readiness_hint")}</p>
            </article>`
          : nothing
      }
      <hikvision-intercom-fleet-clocks
        .hass=${this.hass}
        .stations=${this.stations}
        .reports=${this._reports}
      ></hikvision-intercom-fleet-clocks>
      <div class="health-grid">${visibleStations.map((station) => this.card(station))}</div>
      ${this._attentionOnly && !visibleStations.length ? html`<p>${this.t("health_triage_empty")}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-intercom-health", IntercomHealth);
