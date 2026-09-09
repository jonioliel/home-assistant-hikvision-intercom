import { formatTime, fromLocalInput, UTC_ZONE, type DisplayZone } from "./time";
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
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
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    defaultZone: { attribute: false },
    _data: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _report: { state: true },
    _reportBusy: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  defaultZone: DisplayZone = UTC_ZONE;
  private _filterStation = "";
  private _data?: AuditPage;
  private _busy = false;
  private _error = "";
  private _filters: Record<string, unknown> = {};
  private _generation = 0;
  private _report?: ActivityReport;
  private _reportBusy = false;
  private _reportEpoch = 0;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (changed.has("stations") && this.hass?.user?.is_admin) void this.load();
    if (changed.has("hass") && !this.hass?.user?.is_admin) {
      this._generation++;
      this._data = undefined;
      this.clearReport();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._generation++;
    this._data = undefined;
    this.clearReport();
  }
  private async load(more = false) {
    if (!this.hass?.user?.is_admin || !this.isConnected || (more && this._busy)) return;
    const generation = ++this._generation;
    this._busy = true;
    try {
      const data = await this.hass.callWS<AuditPage>({
        type: "hikvision_intercom/events/list",
        filters: {
          ...this._filters,
          limit: 100,
          ...(more && this._data?.next ? { before: this._data.next } : {}),
        },
      });
      if (generation !== this._generation || !this.isConnected || !this.hass?.user?.is_admin)
        return;
      this._data = {
        ...data,
        records: more ? [...(this._data?.records ?? []), ...data.records] : data.records,
      };
      this._error = "";
    } catch {
      if (generation === this._generation) this._error = this.t("failed");
    } finally {
      if (generation === this._generation) this._busy = false;
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
    this._filters = filters;
    this.clearReport();
    void this.load();
  }
  private clearReport() {
    this._reportEpoch++;
    this._report = undefined;
    this._reportBusy = false;
  }
  private async report(exportCsv = false) {
    if (this._reportBusy || !this.hass?.user?.is_admin || !this.isConnected) return;
    const epoch = this._reportEpoch;
    this._reportBusy = true;
    this._error = "";
    try {
      const result = await this.hass.callWS<ActivityReport>({
        type: `hikvision_intercom/events/${exportCsv ? "export" : "report"}`,
        filters: { ...this._filters },
      });
      if (epoch !== this._reportEpoch || !this.isConnected || !this.hass?.user?.is_admin) return;
      const { csv, ...report } = result;
      this._report = report;
      if (exportCsv && csv !== undefined) downloadText(csv, "hikvision-events.csv");
    } catch {
      if (epoch === this._reportEpoch) this._error = this.t("failed");
    } finally {
      if (epoch === this._reportEpoch) this._reportBusy = false;
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
      const report = await this.hass.callWS({
        type: "hikvision_intercom/events/support",
        event_id: id,
      });
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
        <button @click=${() => this.support(row.id)}>${this.t("event_support")}</button>
      </details>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<section aria-label=${this.t("events")}>
      <h2>${this.t("events")}</h2>
      <p class="muted">${this.t("audit_retention")}</p>
      <form @submit=${this.apply} class="form-grid">
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
        <button class="primary" type="submit">${this.t("filter")}</button>
      </form>
      <div class="toolbar">
        <button ?disabled=${this._reportBusy} @click=${() => this.report()}>
          ${this.t("report_generate")}</button
        ><button ?disabled=${this._reportBusy} @click=${() => this.report(true)}>
          ${this.t("report_export")}
        </button>
      </div>
      <p class="sub">
        ${this.t("clock_filter_basis")}:
        <bdi
          >${this._filterStation ? (this.stations.find((s) => s.id === this._filterStation)?.clock?.zone ?? UTC_ZONE).name : this.defaultZone.name}</bdi
        >
      </p>
      <p class="sub">${this.t("report_filter_hint")}</p>
      ${this.reportView()}
      ${this._error ? html`<p role="alert" class="notice error">${this._error}</p>` : nothing}
      ${this._data?.storage_failed ? html`<p role="alert" class="notice error">${this.t("audit_save_failed")}</p>` : nothing}
      ${Object.entries(this._data?.stations ?? {})
        .filter(([, s]) => !["recovered", "pending"].includes(s.history))
        .map(
          ([id]) =>
            html`<p class="notice">
              ${this.stations.find((s) => s.id === id)?.name ?? id}: ${this.t("history_incomplete")}
            </p>`,
        )}
      <div class="audit-list" aria-busy=${this._busy}>
        ${(this._data?.records ?? []).map(
          (row) =>
            html`<article class="card audit-row">
              <div>
                <strong
                  >${this.stations.find((s) => s.id === row.station_id)?.name ?? this.t("removed_station")}</strong
                >
                ·
                <time datetime=${row.timestamp}
                  >${formatTime(row.timestamp, this.hass?.language, this.stations.find((s) => s.id === row.station_id)?.clock?.zone ?? UTC_ZONE)}</time
                >
              </div>
              <h3>${this.t(row.event_type)}</h3>
              <p>
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
      ${!this._data?.records.length && !this._busy ? html`<p class="empty">${this.t("no_events")}</p>` : nothing}
      ${this._data?.next ? html`<button ?disabled=${this._busy} @click=${() => this.load(true)}>${this.t("load_more")}</button>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-intercom-events", IntercomEvents);
