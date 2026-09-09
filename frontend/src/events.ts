import { formatTime, fromLocalInput, UTC_ZONE, type DisplayZone } from "./time";
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { adminStyles } from "./admin-styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
import { boundedRequest } from "./request";
import type { Hass, Station } from "./types";

interface AuditEvent {
  received_at?: string;
  time_source?: string;
  evidence?: { identity_state: string; origin: string; arrival_delay_seconds: number | null };
  id: string;
  station_id: string;
  timestamp: string;
  person_name: string | null;
  employee_no: string | null;
  door: number | null;
  authentication: string;
  result: string;
  event_type: string;
  card: string | null;
  recovered: boolean;
  major: number | null;
  minor: number | null;
}
interface Counts {
  records: number;
  authentication: number;
  granted: number;
  denied: number;
  unknown: number;
  other: number;
  recovered: number;
}
interface ActivityReport {
  day_timezone?: string;
  generated_at: string;
  oldest: string | null;
  newest: string | null;
  totals: Counts;
  methods: Record<string, number>;
  by_station: (Counts & { station_id: string })[];
  by_day: (Counts & { day: string })[];
  storage_failed: boolean;
  stations: Record<string, { history: string }>;
  csv?: string;
}
interface AuditPage {
  records: AuditEvent[];
  next: string | null;
  storage_failed: boolean;
  stations: Record<string, { stream: string; history: string }>;
}

export class IntercomEvents extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        height: auto;
        overflow: visible;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        align-items: end;
      }
      .audit-row {
        background: var(--surface);
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
      }
      input,
      select {
        min-width: 0;
        width: 100%;
      }
      @media (max-width: 650px) {
        .form-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `,
    adminStyles,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    defaultZone: { attribute: false },
    _data: { state: true },
    _filterDirty: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _listError: { state: true },
    _reportError: { state: true },
    _haConnected: { state: true },
    _report: { state: true },
    _reportBusy: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  defaultZone: DisplayZone = UTC_ZONE;
  private _filterStation = "";
  private _filterDirty = false;
  private _data?: AuditPage;
  private _busy = false;
  private _error = "";
  private _listError = "";
  private _reportError = "";
  private _haConnected = true;
  private connection?: Hass["connection"];
  private _lifecycle = 0;
  private _reloadQueued = false;
  private requests = new Set<AbortController>();
  private listRequest?: AbortController;
  private reportRequest?: AbortController;
  private haDisconnected = () => {
    this._haConnected = false;
    this._reloadQueued = false;
    this.cancelRequests();
  };
  private haReady = () => {
    this._haConnected = true;
    void this.load();
  };
  private bindConnection(connection?: Hass["connection"]) {
    this.connection?.removeEventListener?.("disconnected", this.haDisconnected);
    this.connection?.removeEventListener?.("ready", this.haReady);
    this.connection = connection;
    this._haConnected = connection?.connected !== false;
    connection?.addEventListener?.("disconnected", this.haDisconnected);
    connection?.addEventListener?.("ready", this.haReady);
  }
  private cancelRequests() {
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
  }
  private invalidate() {
    this.renderRoot.querySelector<HTMLFormElement>("form")?.reset();
    this._lifecycle++;
    this._generation++;
    this._reloadQueued = false;
    this.cancelRequests();
    this._busy = false;
    this._data = undefined;
    this._error = "";
    this._listError = "";
    this._filters = {};
    this._filterStation = "";
    this._filterDirty = false;
    this.clearReport();
  }
  private async request<T>(
    command: string,
    data: Record<string, unknown>,
    timeout: number,
    controller = new AbortController(),
  ): Promise<T> {
    if (
      !this.isConnected ||
      !this.hass?.user?.is_admin ||
      !this._haConnected ||
      this.hass.connection.connected === false
    )
      throw new Error("disconnected");
    const hass = this.hass,
      lifecycle = this._lifecycle;
    this.requests.add(controller);
    try {
      const result = await boundedRequest(
        () =>
          hass.callWS<T>({
            type: `hikvision_intercom/events/${command}`,
            ...data,
          }),
        timeout,
        controller.signal,
      );
      if (
        !this.isConnected ||
        !this.hass?.user?.is_admin ||
        lifecycle !== this._lifecycle ||
        this.hass.connection !== hass.connection
      )
        throw new Error("discarded");
      return result;
    } finally {
      this.requests.delete(controller);
    }
  }
  private _filters: Record<string, unknown> = {};
  private _generation = 0;
  private _report?: ActivityReport;
  private _reportBusy = false;
  private _reportEpoch = 0;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  connectedCallback() {
    super.connectedCallback();
    if (this.hass?.user?.is_admin) {
      this.bindConnection(this.hass.connection);
      if (this.hasUpdated) void this.load();
    }
  }
  protected updated(changed: PropertyValues) {
    if (!this.isConnected) return;
    const connection = this.hass?.user?.is_admin ? this.hass.connection : undefined;
    const replaced = this.connection !== connection;
    if (replaced) {
      this.invalidate();
      this.bindConnection(connection);
    }
    if (!this.hass?.user?.is_admin) {
      if (changed.has("hass") && !replaced) this.invalidate();
      return;
    }
    if (replaced || changed.has("stations")) void this.load();
  }
  disconnectedCallback() {
    this.invalidate();
    this.bindConnection(undefined);
    super.disconnectedCallback();
  }
  private cancelList() {
    this._generation++;
    this.listRequest?.abort();
    this._reloadQueued = false;
    this._busy = false;
  }
  private async load(more = false) {
    if (
      !this.hass?.user?.is_admin ||
      !this.isConnected ||
      !this._haConnected ||
      this.hass.connection.connected === false
    )
      return;
    if (this._busy) {
      if (!more) this._reloadQueued = true;
      return;
    }
    const generation = ++this._generation;
    this._busy = true;
    this.listRequest = new AbortController();
    try {
      const data = await this.request<AuditPage>(
        "list",
        {
          filters: {
            ...this._filters,
            limit: 100,
            ...(more && this._data?.next ? { before: this._data.next } : {}),
          },
        },
        20000,
        this.listRequest,
      );
      if (generation !== this._generation || !this.isConnected || !this.hass?.user?.is_admin)
        return;
      this._data = {
        ...data,
        records: more ? [...(this._data?.records ?? []), ...data.records] : data.records,
      };
      this._listError = "";
    } catch {
      if (generation === this._generation) this._listError = this.t("events_load_failed");
    } finally {
      if (generation === this._generation) {
        this._busy = false;
        this.listRequest = undefined;
        if (this._reloadQueued) {
          this._reloadQueued = false;
          void this.load();
        }
      }
    }
  }
  private apply(event: Event) {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const filters: Record<string, unknown> = {};
    const selected = this.stations.find((s) => s.id === form.get("station_id"));
    const zone = selected ? (selected.clock?.zone ?? UTC_ZONE) : this.defaultZone;
    try {
      for (const [key, raw] of form.entries()) {
        if (!raw) continue;
        filters[key] =
          key === "door"
            ? Number(raw)
            : key === "start" || key === "end"
              ? fromLocalInput(String(raw), zone)
              : raw;
      }
    } catch (e) {
      this._error = this.t((e as Error).message);
      return;
    }
    this.cancelList();
    this._error = "";
    this._data = undefined;
    this._filters = filters;
    this._filterDirty = false;
    this.clearReport();
    void this.load();
  }
  private resetFilters() {
    this.cancelList();
    this._error = "";
    this._data = undefined;
    this.renderRoot.querySelector<HTMLFormElement>("form")?.reset();
    this._filterStation = "";
    this._filterDirty = false;
    this._filters = {};
    this.clearReport();
    void this.load();
  }
  private clearReport() {
    this._reportEpoch++;
    this.reportRequest?.abort();
    this.reportRequest = undefined;
    this._reportError = "";
    this._report = undefined;
    this._reportBusy = false;
  }
  private async report(exportCsv = false) {
    if (
      this._reportBusy ||
      !this.hass?.user?.is_admin ||
      !this.isConnected ||
      !this._haConnected ||
      this.hass.connection.connected === false
    )
      return;
    const epoch = this._reportEpoch;
    this._reportBusy = true;
    this._reportError = "";
    this.reportRequest = new AbortController();
    try {
      const result = await this.request<ActivityReport>(
        exportCsv ? "export" : "report",
        {
          filters: { ...this._filters },
        },
        60000,
        this.reportRequest,
      );
      if (epoch !== this._reportEpoch || !this.isConnected || !this.hass?.user?.is_admin) return;
      const { csv, ...report } = result;
      this._report = report;
      if (exportCsv && csv !== undefined) downloadText(csv, "hikvision-events.csv");
    } catch {
      if (epoch === this._reportEpoch) this._reportError = this.t("events_report_failed");
    } finally {
      if (epoch === this._reportEpoch) {
        this._reportBusy = false;
        this.reportRequest = undefined;
      }
    }
  }
  private reportView() {
    const report = this._report;
    if (!report) return nothing;
    return html`<section class="card activity-report" aria-label=${this.t("activity_report")}>
      <h3>${this.t("activity_report")}</h3>
      <p class="sub">
        ${this.t("report_generated")}:
        ${formatTime(report.generated_at, this.hass?.language, this.defaultZone)}
      </p>
      <p>
        ${this.t("report_records")}: <strong>${report.totals.records}</strong> ·
        ${this.t("report_auth")}: <strong>${report.totals.authentication}</strong> ·
        ${this.t("granted")}: <strong>${report.totals.granted}</strong> · ${this.t("denied")}:
        <strong>${report.totals.denied}</strong>
      </p>
      <p>
        ${this.t("report_other")}: ${report.totals.other} · ${this.t("historical_record")}:
        ${report.totals.recovered}
      </p>
      <p class="field-note">${this.t("report_scope")}</p>
      ${report.storage_failed ? html`<p class="notice error">${this.t("audit_save_failed")}</p>` : nothing}
      ${Object.entries(report.stations)
        .filter(([, station]) => !["recovered", "pending"].includes(station.history))
        .map(
          ([id]) =>
            html`<p class="notice">
              ${this.stations.find((station) => station.id === id)?.name ?? this.t("removed_station")}:
              ${this.t("history_incomplete")}
            </p>`,
        )}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>${this.t("station")}</th>
              <th>${this.t("report_records")}</th>
              <th>${this.t("granted")}</th>
              <th>${this.t("denied")}</th>
            </tr>
          </thead>
          <tbody>
            ${report.by_station.map(
              (row) =>
                html`<tr>
                  <td>
                    ${this.stations.find((station) => station.id === row.station_id)?.name ?? this.t("removed_station")}
                  </td>
                  <td>${row.records}</td>
                  <td>${row.granted}</td>
                  <td>${row.denied}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <p>
        ${Object.entries(report.methods)
          .map(([method, count]) => `${this.t(method)}: ${count}`)
          .join(" · ")}
      </p>
      <details>
        <summary>${this.t("report_daily")}</summary>
        <p class="sub">
          ${this.t(report.day_timezone === "station" ? "report_station_time" : "report_utc")}
        </p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>${this.t("report_date")}</th>
                <th>${this.t("report_records")}</th>
                <th>${this.t("granted")}</th>
                <th>${this.t("denied")}</th>
              </tr>
            </thead>
            <tbody>
              ${report.by_day.map(
                (row) =>
                  html`<tr>
                    <td><bdi>${row.day}</bdi></td>
                    <td>${row.records}</td>
                    <td>${row.granted}</td>
                    <td>${row.denied}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>`;
  }
  private async support(id: string) {
    const epoch = this._generation;
    if (!this.hass?.user?.is_admin) return;
    try {
      const report = await this.request("support", { event_id: id }, 20000);
      if (epoch === this._generation && this.isConnected && this.hass?.user?.is_admin)
        downloadText(JSON.stringify(report, null, 2), "hikvision-event.json", "application/json");
    } catch {
      if (epoch === this._generation) this._error = this.t("failed");
    }
  }
  private evidenceView(row: AuditEvent) {
    const evidence = row.evidence;
    if (!evidence) return nothing;
    const zone = this.stations.find((s) => s.id === row.station_id)?.clock?.zone ?? UTC_ZONE;
    return html`<p class="sub">${this.t(evidence.origin)}</p>
      ${evidence.identity_state !== "identified" ? html`<p class="sub">${this.t(evidence.identity_state)}</p>` : nothing}
      <details>
        <summary>${this.t("event_detail")}</summary>
        <p>
          ${this.t("event_received")}:
          ${row.received_at ? formatTime(row.received_at, this.hass?.language, zone) : this.t("unknown")}
        </p>
        <p>${this.t("event_delay")}: ${evidence.arrival_delay_seconds ?? this.t("unknown")}</p>
        <p class="sub">${this.t("event_clock_hint")}</p>
        <p>ISAPI: ${row.major ?? "?"} / ${row.minor ?? "?"}</p>
        <p class="sub">${this.t("event_export_hint")}</p>
        <button ?disabled=${!this._haConnected} @click=${() => this.support(row.id)}>
          ${this.t("event_support")}
        </button>
      </details>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<section aria-label=${this.t("events")}>
      ${!this._haConnected ? html`<p class="notice" role="status">${this.t("events_connection_lost")}</p>` : nothing}
      <div class="page-heading">
        <div>
          <h2>${this.t("events")}</h2>
          <p>${this.t("events_intro")}</p>
        </div>
        <button ?disabled=${this._busy || !this._haConnected} @click=${() => this.load()}>
          ${this.t("refresh")}
        </button>
      </div>
      <form
        @submit=${this.apply}
        @input=${() => {
          this._filterDirty = true;
        }}
        @change=${() => {
          this._filterDirty = true;
        }}
        class="form-grid filter-panel"
      >
        <label
          >${this.t("station")}<select
            name="station_id"
            aria-label=${this.t("station")}
            @change=${(e: Event) => {
              this._filterStation = (e.target as HTMLSelectElement).value;
              this.requestUpdate();
            }}
          >
            <option value="">${this.t("all")}</option>
            ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        >
        <label>${this.t("person")}<input name="person" maxlength="128" /></label>
        <label
          >${this.t("result")}<select name="result" aria-label=${this.t("result")}>
            <option value="">${this.t("all")}</option>
            ${["granted", "denied", "unknown"].map((v) => html`<option value=${v}>${this.t(v)}</option>`)}
          </select></label
        >
        <label
          >${this.t("authentication")}<select
            name="authentication"
            aria-label=${this.t("authentication")}
          >
            <option value="">${this.t("all")}</option>
            ${["card", "pin", "unknown"].map((v) => html`<option value=${v}>${this.t(v)}</option>`)}
          </select></label
        >
        <label
          >${this.t("door")}<select name="door" aria-label=${this.t("door")}>
            <option value="">${this.t("all")}</option>
            <option value="1">1</option>
          </select></label
        >
        <label>${this.t("from_time")}<input type="datetime-local" name="start" /></label>
        <label>${this.t("until_time")}<input type="datetime-local" name="end" /></label>
        <button class="primary" type="submit" ?disabled=${!this._haConnected}>
          ${this.t("filter")}
        </button>
      </form>
      ${this._filterDirty ? html`<p class="filter-pending" role="status">${this.t("filters_not_applied")}</p>` : nothing}
      <div class="toolbar">
        <button @click=${() => this.resetFilters()}>${this.t("clear_user_filters")}</button>
        <button ?disabled=${this._reportBusy || !this._haConnected} @click=${() => this.report()}>
          ${this.t("report_generate")}</button
        ><button
          ?disabled=${this._reportBusy || !this._haConnected}
          @click=${() => this.report(true)}
        >
          ${this.t("report_export")}
        </button>
      </div>
      <p class="sub">
        ${this.t("clock_filter_basis")}:
        <bdi
          >${this._filterStation ? (this.stations.find((s) => s.id === this._filterStation)?.clock?.zone ?? UTC_ZONE).name : this.defaultZone.name}</bdi
        >
      </p>
      <details class="report-help">
        <summary>${this.t("report_help")}</summary>
        <p class="sub">${this.t("report_filter_hint")}</p>
        <p class="record-meta">${this.t("audit_retention")}</p>
      </details>
      ${this.reportView()}
      ${[this._error, this._listError, this._reportError].filter(Boolean).map((error) => html`<p role="alert" class="notice error">${error}</p>`)}
      ${this._data?.storage_failed ? html`<p role="alert" class="notice error">${this.t("audit_save_failed")}</p>` : nothing}
      ${Object.entries(this._data?.stations ?? {})
        .filter(([, s]) => !["recovered", "pending"].includes(s.history))
        .map(
          ([id]) =>
            html`<p class="notice">
              ${this.stations.find((s) => s.id === id)?.name ?? id}: ${this.t("history_incomplete")}
            </p>`,
        )}
      <div class="result-summary" role="status">
        ${this._busy ? this.t("loading") : this.t("loaded_records") + ": " + (this._data?.records.length ?? 0)}
      </div>
      <div class="audit-list" aria-busy=${this._busy}>
        ${(this._data?.records ?? []).map(
          (row) =>
            html`<article class="card audit-row">
              <div class="record-heading">
                <h3>${this.t(row.event_type)}</h3>
                <time datetime=${row.timestamp}
                  ><bdi
                    >${formatTime(row.timestamp, this.hass?.language, this.stations.find((s) => s.id === row.station_id)?.clock?.zone ?? UTC_ZONE)}</bdi
                  ></time
                >
              </div>
              <div class="record-meta">
                <strong
                  >${this.stations.find((s) => s.id === row.station_id)?.name ?? this.t("removed_station")}</strong
                >
              </div>
              <p class="record-person">
                ${row.person_name ?? this.t("unknown")}${row.employee_no ? html` · <bdi>${row.employee_no}</bdi>` : nothing}
                · ${this.t("door")}: ${row.door ?? this.t("unknown")}
              </p>
              <p>
                ${this.t(row.authentication)} ·
                <span class="badge ${row.result === "denied" ? "error" : ""}"
                  >${this.t(row.result)}</span
                >${row.card ? html` · <bdi>${row.card}</bdi>` : nothing}
              </p>
              ${row.recovered ? html`<small class="muted">${this.t("historical_record")}</small>` : nothing}
              ${this.evidenceView(row)}
              ${row.event_type === "unknown" ? html`<small> · ${row.major}/${row.minor}</small>` : nothing}
            </article>`,
        )}
      </div>
      ${!this._data?.records.length && !this._busy && !this._error ? html`<p class="empty">${this.t("no_events")}</p>` : nothing}
      ${this._data?.next ? html`<button ?disabled=${this._busy || !this._haConnected} @click=${() => this.load(true)}>${this.t("load_more")}</button>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-intercom-events", IntercomEvents);
