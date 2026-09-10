import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { Hass } from "./types";
export type ReportQuery = Record<string, unknown>;
interface SavedReport {
  id: string;
  name: string;
  filters: ReportQuery;
}
export function checkedReportQuery(value: unknown): ReportQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
  const allowed = [
    "station_id",
    "person",
    "result",
    "authentication",
    "door",
    "start",
    "end",
    "current_group",
    "current_profile",
  ];
  const v = value as ReportQuery;
  if (Object.keys(v).some((k) => !allowed.includes(k))) throw Error();
  for (const [key, raw] of Object.entries(v)) {
    if (key === "current_profile") {
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        !Object.keys(raw).length ||
        Object.keys(raw).length > 12
      )
        throw Error();
      for (const [id, item] of Object.entries(raw))
        if (
          !/^[a-z][a-z0-9_]{0,47}$/.test(id) ||
          typeof item !== "string" ||
          !item ||
          item.length > 100 ||
          /[\x00-\x1f]/.test(item)
        )
          throw Error();
    } else if (key === "door") {
      if (raw !== 1) throw Error();
    } else if (typeof raw !== "string" || !raw || raw.length > 128 || /[\x00-\x1f]/.test(raw))
      throw Error();
    else if (
      ["start", "end"].includes(key) &&
      (!/(Z|[+-]\d\d:\d\d)$/.test(raw) || !Number.isFinite(Date.parse(raw)))
    )
      throw Error();
    else if (key === "result" && !["granted", "denied", "unknown"].includes(raw)) throw Error();
    else if (key === "authentication" && !["card", "pin", "unknown"].includes(raw)) throw Error();
  }
  if (v.start && v.end && Date.parse(String(v.start)) >= Date.parse(String(v.end))) throw Error();
  return structuredClone(v);
}
export class SavedReports extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
        margin-block: 12px;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      select,
      input {
        max-width: 100%;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    filters: { attribute: false },
    locked: { type: Boolean },
    items: { state: true },
    selected: { state: true },
    name: { state: true },
    error: { state: true },
  };
  hass?: Hass;
  filters: ReportQuery = {};
  locked = false;
  private items: SavedReport[] = [];
  private selected = "";
  private name = "";
  private error = "";
  private actor?: string;
  private authorized = false;
  private raw: string | null = null;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private key() {
    return "wiskey:report-queries:v1:" + this.actor;
  }
  protected updated(_changes: PropertyValues) {
    if (this.actor !== this.hass?.user?.id || this.authorized !== !!this.hass?.user?.is_admin) {
      this.actor = this.hass?.user?.id;
      this.authorized = !!this.hass?.user?.is_admin;
      this.items = [];
      this.selected = this.name = this.error = "";
      this.raw = null;
      if (this.authorized) this.read();
    }
  }
  private read() {
    try {
      this.raw = localStorage.getItem(this.key());
      if (this.raw && this.raw.length > 100000) throw Error();
      const data = this.raw ? JSON.parse(this.raw) : [];
      if (!Array.isArray(data) || data.length > 20) throw Error();
      const ids = new Set<string>();
      this.items = data.map((v) => {
        if (
          !v ||
          typeof v.id !== "string" ||
          v.id.length > 64 ||
          ids.has(v.id) ||
          typeof v.name !== "string" ||
          !v.name.trim() ||
          v.name.length > 64
        )
          throw Error();
        ids.add(v.id);
        return { id: v.id, name: v.name, filters: checkedReportQuery(v.filters) };
      });
    } catch {
      this.items = [];
      this.error = "views_storage_failed";
    }
  }
  private store(items: SavedReport[]) {
    if (!this.hass?.user?.is_admin || this.locked || this.actor !== this.hass.user.id) return false;
    try {
      if (localStorage.getItem(this.key()) !== this.raw) {
        this.read();
        this.error = "views_changed";
        return false;
      }
      const raw = JSON.stringify(items);
      localStorage.setItem(this.key(), raw);
      this.raw = raw;
      this.items = items;
      this.error = "";
      return true;
    } catch {
      this.error = "views_storage_failed";
      return false;
    }
  }
  private save() {
    if (!this.name.trim() || this.name.length > 64 || (!this.selected && this.items.length >= 20))
      return;
    try {
      const item = {
        id: this.selected || crypto.randomUUID(),
        name: this.name.trim(),
        filters: checkedReportQuery(this.filters),
      };
      if (this.store([...this.items.filter((v) => v.id !== item.id), item]))
        this.selected = item.id;
    } catch {
      this.error = "views_storage_failed";
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<details>
      <summary>${this.t("saved_reports")}</summary>
      <p class="sub">${this.t("saved_reports_hint")}</p>
      <div class="toolbar">
        <label
          >${this.t("saved_reports")}<select
            .value=${this.selected}
            ?disabled=${this.locked}
            @change=${(e: Event) => {
              this.selected = (e.target as HTMLSelectElement).value;
              this.name = this.items.find((v) => v.id === this.selected)?.name ?? "";
            }}
          >
            <option value="">${this.t("new_report_query")}</option>
            ${this.items.map((v) => html`<option value=${v.id}>${v.name}</option>`)}
          </select></label
        >
        <label
          >${this.t("report_query_name")}<input
            maxlength="64"
            .value=${this.name}
            ?disabled=${this.locked}
            @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
        /></label>
        <button ?disabled=${this.locked || !this.name.trim()} @click=${this.save}>
          ${this.t("save_report_query")}
        </button>
        <button
          ?disabled=${this.locked || !this.selected}
          @click=${() => {
            const item = this.items.find((v) => v.id === this.selected);
            if (item)
              this.dispatchEvent(
                new CustomEvent("report-query", { detail: checkedReportQuery(item.filters) }),
              );
          }}
        >
          ${this.t("load_report_query")}
        </button>
        <button
          ?disabled=${this.locked || !this.selected}
          @click=${() => {
            if (this.store(this.items.filter((v) => v.id !== this.selected)))
              this.selected = this.name = "";
          }}
        >
          ${this.t("delete")}
        </button>
      </div>
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
    </details>`;
  }
}
customElements.define("wiskey-saved-reports", SavedReports);

export interface PrintableReport {
  generated_at: string;
  totals: { records: number; authentication: number; granted: number; denied: number };
  filters?: ReportQuery;
  membership_basis?: string | null;
  storage_failed: boolean;
  stations: Record<string, { history: string }>;
  print_records?: Record<string, unknown>[];
}
export function printableReport(
  report: PrintableReport,
  language: string,
  filterLabels: Record<string, string> = {},
): string {
  const t = (key: string) => translate(language, key);
  const escape = (value: unknown) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const queryLabels: Record<string, string> = {
    station_id: "station",
    person: "person",
    result: "result",
    authentication: "authentication",
    door: "door",
    start: "from_time",
    end: "until_time",
    current_group: "report_current_group",
  };
  const query = Object.entries(report.filters ?? {}).flatMap(([key, value]) =>
    key === "current_profile"
      ? Object.entries(value as Record<string, string>).map(([id, v]) => [
          filterLabels["profile:" + id] ?? id,
          v,
        ])
      : [[t(queryLabels[key] ?? key), filterLabels[key] ?? String(value)]],
  );
  const rows = report.print_records;
  if (!rows || rows.length !== report.totals.records || rows.length > 5000)
    throw Error("incomplete_print_report");
  const columns = [
    "display_timestamp",
    "display_timezone",
    "station",
    "person_name",
    "employee_no",
    "event_type",
    "authentication",
    "result",
    "door",
    "card",
    "recovered",
    "time_source",
    "timestamp",
  ];
  const labels = [
    "report_date",
    "clock_filter_basis",
    "station",
    "person",
    "employee_no",
    "event_detail",
    "authentication",
    "result",
    "door",
    "card",
    "historical_record",
    "report_time_source",
    "report_stored_time",
  ];
  return `<!doctype html><html lang="${language.startsWith("he") ? "he" : "en"}" dir="${language.startsWith("he") ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>WisKey — ${escape(t("activity_report"))}</title><style>body{font:12px Arial,sans-serif;color:#172333;margin:16px}h1{font-size:22px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #ccd3dc;padding:5px;overflow-wrap:anywhere;text-align:start}th{background:#eef2f7}thead{display:table-header-group}tr{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere} @page{size:A4 landscape;margin:10mm}@media print{body{margin:0;font-size:8px}}</style></head><body><h1>WisKey — ${escape(t("activity_report"))}</h1><p>${escape(t("report_generated"))}: ${escape(report.generated_at)}</p><p>${escape(t("report_records"))}: ${report.totals.records} · ${escape(t("report_auth"))}: ${report.totals.authentication} · ${escape(t("granted"))}: ${report.totals.granted} · ${escape(t("denied"))}: ${report.totals.denied}</p><p>${escape(t("report_scope"))}</p>${report.membership_basis ? `<p>${escape(t("report_current_membership"))}</p>` : ""}${report.storage_failed ? `<p>${escape(t("audit_save_failed"))}</p>` : ""}${Object.values(report.stations).some((s) => !["recovered", "pending"].includes(s.history)) ? `<p>${escape(t("history_incomplete"))}</p>` : ""}<p>${escape(t("event_filters"))}</p><pre dir="ltr">${escape(query.map(([label, value]) => label + ": " + value).join("\n") || t("all"))}</pre><table><thead><tr>${labels.map((key) => `<th>${escape(t(key))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((key) => `<td>${escape(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}
