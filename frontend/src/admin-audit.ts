import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { downloadText } from "./download";
import { formatTime, fromLocalInput, UTC_ZONE, type DisplayZone } from "./time";
import type { Hass, Person, Station } from "./types";
interface AuditRow {
  sequence: number;
  time: string;
  actor: string;
  action: string;
  user_id: string;
  stations: string[];
  fields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  revision_before: number | null;
  revision_after: number | null;
}
interface AuditReport {
  records: AuditRow[];
  actors: Record<string, string | null>;
  next_cursor: number | null;
  total: number;
  csv?: string;
}
interface PermissionRow {
  user_id: string | null;
  employee_no: string;
  display_name: string | null;
  status: string;
  differences: string[];
  error: string | null;
}
interface Permissions {
  station_id: string;
  checked_at: string;
  complete: boolean;
  rows: PermissionRow[];
  counts: Record<string, number>;
  total_candidates: number;
}
const actions = [
  "users/create",
  "users/update",
  "users/delete",
  "users/set_active",
  "cards/add",
  "cards/remove",
  "users/csv_apply",
  "users/adopt",
  "users/delete_unmanaged",
  "cards/capture_confirm",
  "conflicts/resolve",
  "conflicts/resolve_deletion",
  "bulk/enable",
  "bulk/disable",
  "bulk/assign",
  "bulk/unassign",
  "bulk/delete",
  "bulk/remove_pin",
  "bulk/remove_cards",
  "bulk/sync",
  "system",
];
export class AdminAudit extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
      }
      label {
        display: block;
        min-width: 0;
      }
      select,
      input {
        max-width: 100%;
        box-sizing: border-box;
      }
      article {
        padding: 16px;
        margin: 12px 0;
        border: 1px solid var(--divider-color, #ddd);
        border-radius: 12px;
      }
      p,
      bdi {
        overflow-wrap: anywhere;
      }
      .comparison {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .permission {
        margin-top: 28px;
      }
      .history {
        max-width: 100%;
      }
      .sub {
        font-size: 0.9em;
      }
      .error {
        color: var(--error-color, #a20);
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    users: { attribute: false },
    stations: { attribute: false },
    focusUser: { type: String },
    zone: { attribute: false },
    _report: { state: true },
    _permissions: { state: true },
    _user: { state: true },
    _station: { state: true },
    _action: { state: true },
    _actor: { state: true },
    _start: { state: true },
    _end: { state: true },
    _auditStation: { state: true },
    _shown: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };
  hass?: Hass;
  users: Person[] = [];
  stations: Station[] = [];
  focusUser = "";
  zone: DisplayZone = UTC_ZONE;
  private _report?: AuditReport;
  private _permissions?: Permissions;
  private _user = "";
  private _station = "";
  private _action = "";
  private _actor = "";
  private _start = "";
  private _end = "";
  private _auditStation = "";
  private _shown = 50;
  private _busy = false;
  private _error = "";
  private applied: Record<string, unknown> = {};
  private epoch = 0;
  private initialized = false;
  private lastFocus = "";
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (changed.has("hass") && !this.hass?.user?.is_admin) {
      this.epoch++;
      this._report = undefined;
      this._permissions = undefined;
      this._error = "";
      this._busy = false;
      this.initialized = false;
    }
    if (this.hass?.user?.is_admin && (!this.initialized || this.focusUser !== this.lastFocus)) {
      this.initialized = true;
      this.lastFocus = this.focusUser;
      this._user = this.focusUser;
      void this.load();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.epoch++;
  }
  private valid(epoch: number) {
    return epoch === this.epoch && this.isConnected && !!this.hass?.user?.is_admin;
  }
  private stationName(id: string) {
    return this.stations.find((s) => s.id === id)?.name ?? id;
  }
  private actionName(action: string) {
    return action.startsWith("bulk/")
      ? this.t(action.replace("/", "_"))
      : this.t("audit_source_" + action.replaceAll("/", "_"));
  }
  private filters() {
    const filters: Record<string, unknown> = {};
    for (const [key, value] of [
      ["user_id", this._user],
      ["station_id", this._station],
      ["action", this._action],
      ["actor", this._actor],
    ])
      if (value) filters[key] = value;
    if (this._start) filters.start = fromLocalInput(this._start, this.zone);
    if (this._end) filters.end = fromLocalInput(this._end, this.zone);
    return filters;
  }
  private async load(more = false) {
    if (this._busy || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    try {
      const filters = more ? this.applied : this.filters();
      const result = await this.hass.callWS<AuditReport>({
        type: "hikvision_intercom/audit/list",
        filters: { ...filters, ...(more ? { before: this._report!.next_cursor } : {}) },
      });
      if (!this.valid(epoch)) return;
      this.applied = filters;
      this._report =
        more && this._report
          ? {
              ...result,
              actors: { ...this._report.actors, ...result.actors },
              records: [...this._report.records, ...result.records],
            }
          : result;
    } catch (error) {
      if (this.valid(epoch))
        this._error = this.t((error as { code?: string }).code ?? "invalid_fields");
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private async export(format: "csv" | "json") {
    if (this._busy || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    try {
      const result = await this.hass.callWS<AuditReport>({
        type: "hikvision_intercom/audit/export",
        filters: { ...this.applied },
      });
      if (!this.valid(epoch)) return;
      if (format === "csv")
        downloadText(result.csv ?? "", "hikvision-change-history.csv", "text/csv;charset=utf-8");
      else {
        const { csv, ...report } = result;
        void csv;
        downloadText(
          JSON.stringify(report, null, 2),
          "hikvision-change-history.json",
          "application/json",
        );
      }
    } catch (error) {
      if (this.valid(epoch)) this._error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private async inspect() {
    if (this._busy || !this._auditStation || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch,
      sid = this._auditStation;
    this._busy = true;
    this._error = "";
    this._permissions = undefined;
    try {
      const report = await this.hass.callWS<Permissions>({
        type: "hikvision_intercom/stations/permission_audit",
        station_id: sid,
      });
      if (this.valid(epoch) && sid === this._auditStation) {
        this._permissions = report;
        this._shown = 50;
      }
    } catch (error) {
      if (this.valid(epoch) && sid === this._auditStation)
        this._error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private snapshot(data: Record<string, unknown> | null) {
    if (!data) return html`<p>—</p>`;
    return html`<p>
      ${String(data.display_name ?? "")} · <bdi>${String(data.employee_no ?? "")}</bdi><br />
      ${this.t(data.active ? "active" : "inactive")} · ${this.t("pin")}:
      ${this.t(data.pin_configured ? "configured" : "not_configured")} · ${this.t("cards")}:
      ${String(data.card_count ?? 0)}<br />
      ${Object.entries((data.assignments ?? {}) as Record<string, { enabled: boolean }>)
        .map(([id, a]) => this.stationName(id) + ": " + this.t(a.enabled ? "active" : "inactive"))
        .join(", ")}
      ${data.valid_from ? html`<br />${formatTime(String(data.valid_from), this.hass?.language, this.zone)} — ${formatTime(String(data.valid_until), this.hass?.language, this.zone)}` : nothing}
    </p>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const retained = new Map<string, string>();
    for (const row of this._report?.records ?? [])
      retained.set(row.user_id, String((row.after ?? row.before)?.display_name ?? row.user_id));
    for (const u of this.users) retained.set(u.id, u.display_name);
    if (this._user && !retained.has(this._user)) retained.set(this._user, this._user);
    return html`<h2>${this.t("audit")}</h2>
      <p>${this.t("audit_hint")}</p>
      <form
        class="toolbar"
        @submit=${(e: SubmitEvent) => {
          e.preventDefault();
          void this.load();
        }}
      >
        <label
          >${this.t("audit_filter_user")}<select
            aria-label=${this.t("audit_filter_user")}
            .value=${this._user}
            @change=${(e: Event) => {
              this._user = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">${this.t("filter_any")}</option>
            ${[...retained].map(([id, name]) => html`<option value=${id}>${name}</option>`)}
          </select></label
        >
        <label
          >${this.t("user_filter_station")}<select
            aria-label=${this.t("user_filter_station")}
            .value=${this._station}
            @change=${(e: Event) => {
              this._station = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">${this.t("filter_any")}</option>
            ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        >
        <label
          >${this.t("audit_action")}<select
            aria-label=${this.t("audit_action")}
            .value=${this._action}
            @change=${(e: Event) => {
              this._action = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">${this.t("filter_any")}</option>
            ${actions.map((a) => html`<option value=${a}>${this.actionName(a)}</option>`)}
          </select></label
        >
        <label
          >${this.t("audit_actor")}<select
            aria-label=${this.t("audit_actor")}
            .value=${this._actor}
            @change=${(e: Event) => {
              this._actor = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">${this.t("filter_any")}</option>
            ${Object.entries(this._report?.actors ?? {}).map(([id, name]) => html`<option value=${id}>${name ?? id}</option>`)}
          </select></label
        >
        <label
          >${this.t("audit_from")}<input
            type="datetime-local"
            step="60"
            .value=${this._start}
            @input=${(e: Event) => {
              this._start = (e.target as HTMLInputElement).value;
            }}
        /></label>
        <label
          >${this.t("audit_until")}<input
            type="datetime-local"
            step="60"
            .value=${this._end}
            @input=${(e: Event) => {
              this._end = (e.target as HTMLInputElement).value;
            }}
        /></label>
        <button class="primary" ?disabled=${this._busy}>${this.t("filter")}</button>
      </form>
      <p class="sub">${this.t("audit_export_hint")}</p>
      <div class="toolbar">
        <button ?disabled=${this._busy || !this._report} @click=${() => this.export("csv")}>
          ${this.t("audit_export")}</button
        ><button ?disabled=${this._busy || !this._report} @click=${() => this.export("json")}>
          ${this.t("audit_export_json")}
        </button>
      </div>
      ${this._busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${this._error ? html`<p role="alert" class="notice error">${this._error}</p>` : nothing}
      <section class="history">
        ${
          this._report?.records.map(
            (row) =>
              html`<article>
                <strong>${this.actionName(row.action)}</strong> ·
                ${formatTime(row.time, this.hass?.language, this.zone)}
                <p>
                  ${this.t("audit_actor")}:
                  ${row.actor ? (this._report?.actors[row.actor] ?? row.actor) : this.t("audit_system")}<br />${this.t("audit_fields")}:
                  ${row.fields.map((f) => this.t(f)).join(", ")}
                </p>
                <div class="comparison">
                  <div>
                    <strong>${this.t("audit_before")} · ${row.revision_before ?? "—"}</strong
                    >${this.snapshot(row.before)}
                  </div>
                  <div>
                    <strong>${this.t("audit_after")} · ${row.revision_after ?? "—"}</strong
                    >${this.snapshot(row.after)}
                  </div>
                </div>
                <button
                  @click=${() => {
                    this._user = row.user_id;
                    void this.load();
                  }}
                  ?disabled=${this._busy}
                >
                  ${this.t("audit_show_user")}
                </button>
              </article>`,
          ) ?? nothing
        }
        ${this._report && !this._report.records.length ? html`<p>${this.t("audit_empty")}</p>` : nothing}${this._report?.next_cursor ? html`<button ?disabled=${this._busy} @click=${() => this.load(true)}>${this.t("audit_more")}</button>` : nothing}
      </section>
      <section class="permission">
        <h3>${this.t("permission_title")}</h3>
        <p>${this.t("permission_hint")}</p>
        <div class="toolbar">
          <select
            aria-label=${this.t("permission_title")}
            .value=${this._auditStation}
            @change=${(e: Event) => {
              this._auditStation = (e.target as HTMLSelectElement).value;
              this._permissions = undefined;
            }}
          >
            <option value="">—</option>
            ${this.stations.map((s) => html`<option value=${s.id} ?disabled=${!s.online || !s.lock_enabled}>${s.name}</option>`)}</select
          ><button ?disabled=${this._busy || !this._auditStation} @click=${() => this.inspect()}>
            ${this.t("permission_run")}
          </button>
        </div>
        ${
          this._permissions
            ? html`<p>
                  ${this.stationName(this._permissions.station_id)} ·
                  ${formatTime(this._permissions.checked_at, this.hass?.language, this.stations.find((s) => s.id === this._permissions?.station_id)?.clock?.zone ?? this.zone)}<br />${Object.entries(
                    this._permissions.counts,
                  )
                    .map(([key, n]) => this.t("permission_" + key) + ": " + n)
                    .join(" · ")}
                </p>
                ${!this._permissions.complete ? html`<p class="notice">${this.t("permission_partial")}</p>` : nothing}<button
                  @click=${() => downloadText(JSON.stringify(this._permissions, null, 2), "hikvision-permissions.json", "application/json")}
                >
                  ${this.t("permission_export")}
                </button>
                ${this._permissions.rows.slice(0, this._shown).map(
                  (row) =>
                    html`<article>
                      <strong>${row.display_name ?? row.employee_no}</strong>
                      <p>
                        ${this.t("permission_" + row.status)} ·
                        ${row.differences.map((f) => this.t(f)).join(", ")}${row.error ? html`<br />${this.t(row.error)}` : nothing}
                      </p>
                      ${row.user_id ? html`<button @click=${() => this.dispatchEvent(new CustomEvent("review-user", { bubbles: true, composed: true, detail: { user_id: row.user_id, station_id: this._permissions!.station_id } }))}>${this.t("permission_review")}</button>` : nothing}
                    </article>`,
                )}${
                  this._shown < this._permissions.rows.length
                    ? html`<button
                        @click=${() => {
                          this._shown += 50;
                        }}
                      >
                        ${this.t("permission_more")}
                      </button>`
                    : nothing
                }`
            : nothing
        }
      </section>`;
  }
}
customElements.define("hikvision-admin-audit", AdminAudit);
