import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import { downloadText } from "./download";
import { formatTime, UTC_ZONE, type DisplayZone } from "./time";
import type { Hass, Person, Station } from "./types";

interface Selection {
  source: string;
  user_id: string;
  station_id: string;
  query: string;
  period: string;
}
interface SavedSelection {
  id: string;
  name: string;
  value: Selection;
}
interface TimelineRow {
  id: string;
  source: string;
  time: string;
  time_source: string;
  received_at: string | null;
  user_id: string | null;
  person_name: string | null;
  employee_no: string | null;
  station_ids: string[];
  action: string;
  status: string;
  actor: string | null;
  evidence: string;
  details: Record<string, unknown>;
}
interface TimelinePage {
  records: TimelineRow[];
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  previous_offset: number | null;
  snapshot: string;
  stale: boolean;
  summary: Record<string, number>;
  sources: { access_available: boolean; access_storage_failed: boolean };
  actors: Record<string, string | null>;
  generated_at?: string;
  retention?: Record<string, unknown>;
  correlation?: string;
}
const empty = (): Selection => ({
  source: "all",
  user_id: "",
  station_id: "",
  query: "",
  period: "7",
});
function selection(raw: unknown): Selection {
  const value = raw as Selection;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "period,query,source,station_id,user_id" ||
    !["all", "access", "change", "sync"].includes(value.source) ||
    !["1", "7", "30", "all"].includes(value.period) ||
    [value.user_id, value.station_id, value.query].some(
      (item) => typeof item !== "string" || item.length > 128,
    )
  )
    throw Error();
  return { ...value };
}

export class Investigations extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        min-height: 0;
        overflow: visible;
        background: transparent;
      }
      .toolbar,
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 10px;
      }
      .heading {
        justify-content: space-between;
        align-items: center;
      }
      .toolbar {
        padding: 14px;
        background: var(--surface, var(--card-background-color, #fff));
        border: 1px solid var(--divider-color, #ddd);
        border-radius: 12px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
      }
      label.search {
        flex: 1;
        min-width: min(200px, 100%);
      }
      input,
      select {
        box-sizing: border-box;
        max-width: 100%;
        min-width: 0;
      }
      article {
        border: 1px solid var(--divider-color, #ddd);
        border-inline-start: 4px solid var(--accent, #3b8175);
        padding: 12px;
        border-radius: 10px;
        margin-block: 10px;
        background: var(--surface, var(--card-background-color, #fff));
      }
      article.access {
        border-inline-start-color: var(--success-color, #39866e);
      }
      article.change {
        border-inline-start-color: var(--warning-color, #b78034);
      }
      article .row {
        align-items: center;
        justify-content: space-between;
      }
      .sub {
        color: var(--secondary-text-color, #75868c);
        font-size: 13px;
      }
      .tag {
        padding: 4px 9px;
        border-radius: 20px;
        background: var(--soft, #e8f0ee);
      }
      h2,
      p {
        margin: 0 0 10px;
      }
      .saved {
        margin-block: 12px;
      }
      .error {
        color: var(--error-color, #bd4350);
      }
      p,
      bdi,
      summary,
      span {
        overflow-wrap: anywhere;
      }
      details {
        margin-block-start: 8px;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
        gap: 8px;
        margin-block: 10px;
      }
      @media (max-width: 600px) {
        .toolbar label {
          width: 100%;
        }
        .heading {
          align-items: start;
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    users: { attribute: false },
    stations: { attribute: false },
    zone: { attribute: false },
    authorized: { attribute: false },
    current: { state: true },
    page: { state: true },
    busy: { state: true },
    error: { state: true },
    saved: { state: true },
    savedId: { state: true },
    savedName: { state: true },
    storageError: { state: true },
    exporting: { state: true },
    exportedRows: { state: true },
    exportError: { state: true },
  };
  hass?: Hass;
  users: Person[] = [];
  stations: Station[] = [];
  zone: DisplayZone = UTC_ZONE;
  authorized = false;
  private current = empty();
  private applied: Record<string, unknown> = {};
  private appliedSelection?: Selection;
  private page?: TimelinePage;
  private busy = false;
  private error = "";
  private saved: SavedSelection[] = [];
  private savedId = "";
  private savedName = "";
  private storageError = "";
  private exporting = false;
  private exportedRows = 0;
  private exportError = "";
  private exportEpoch = 0;
  private visibility = () => {
    if (document.hidden) this.cancelExport();
  };
  private raw: string | null = null;
  private epoch = 0;
  private actor?: string;
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private key() {
    return "wiskey:investigation-views:v1:" + this.actor;
  }
  protected updated(changes: PropertyValues) {
    if (
      this.actor !== this.hass?.user?.id ||
      this.connection !== this.hass?.connection ||
      changes.has("authorized")
    ) {
      this.reset();
      this.actor = this.hass?.user?.id;
      this.connection = this.hass?.connection;
      this.current = empty();
      this.saved = [];
      this.savedId = this.savedName = "";
      if (this.authorized && this.actor) {
        this.readSaved();
        void this.apply();
      }
    }
  }
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.visibility);
    if (this.hasUpdated) void this.apply();
  }
  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this.visibility);
    this.reset();
    super.disconnectedCallback();
  }
  private reset() {
    this.epoch++;
    this.requests.cancel();
    this.exportEpoch++;
    this.exporting = false;
    this.exportedRows = 0;
    this.exportError = "";
    this.appliedSelection = undefined;
    this.busy = false;
    this.error = "";
    this.page = undefined;
  }
  private readSaved() {
    this.storageError = "";
    try {
      const raw = localStorage.getItem(this.key());
      if (raw && raw.length > 50000) throw Error();
      const rows = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows) || rows.length > 20) throw Error();
      const ids = new Set<string>();
      this.saved = rows.map((item) => {
        if (
          !item ||
          Object.keys(item).sort().join(",") !== "id,name,value" ||
          typeof item.id !== "string" ||
          !item.id ||
          item.id.length > 64 ||
          ids.has(item.id) ||
          typeof item.name !== "string" ||
          !item.name.trim() ||
          item.name.length > 64
        )
          throw Error();
        ids.add(item.id);
        return { id: item.id, name: item.name, value: selection(item.value) };
      });
      this.raw = raw;
    } catch {
      this.saved = [];
      this.storageError = this.t("investigation_saved_error");
    }
  }
  private writeSaved(rows: SavedSelection[]) {
    if (!this.authorized || !this.actor || this.storageError) return false;
    try {
      if (localStorage.getItem(this.key()) !== this.raw) throw Error();
      const raw = JSON.stringify(rows);
      localStorage.setItem(this.key(), raw);
      this.raw = raw;
      this.saved = rows;
      return true;
    } catch {
      this.storageError = this.t("investigation_saved_error");
      return false;
    }
  }
  private saveView() {
    const name = this.savedName.trim();
    if (!name || name.length > 64 || this.saved.length >= 20) return;
    const row = { id: crypto.randomUUID(), name, value: selection(this.current) };
    if (this.writeSaved([...this.saved, row])) {
      this.savedId = row.id;
      this.savedName = "";
    }
  }
  private removeView() {
    if (this.savedId && this.writeSaved(this.saved.filter((item) => item.id !== this.savedId)))
      this.savedId = "";
  }
  private async useView() {
    const item = this.saved.find((value) => value.id === this.savedId);
    if (item) {
      this.current = selection(item.value);
      await this.apply();
    }
  }
  private async apply() {
    if (!this.authorized || !this.hass || this.busy) return;
    const { period, ...filters } = this.current;
    this.applied = { ...filters };
    this.appliedSelection = { ...this.current };
    this.exportError = "";
    if (period !== "all")
      this.applied.start = new Date(Date.now() - Number(period) * 86400000).toISOString();
    this.page = undefined;
    await this.load(0, "");
  }
  private async load(offset: number, snapshot: string) {
    if (!this.authorized || !this.hass || this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = "";
    try {
      const page = await this.requests.run<TimelinePage>(
        {
          type: "hikvision_intercom/investigations/query",
          filters: this.applied,
          offset,
          limit: 50,
          snapshot,
        },
        30000,
      );
      if (epoch === this.epoch && this.isConnected && this.authorized) this.page = page;
    } catch (error) {
      if (epoch === this.epoch) this.error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private updateFilter(key: keyof Selection, event: Event) {
    this.current = { ...this.current, [key]: (event.target as HTMLInputElement).value };
  }
  private cancelExport() {
    if (!this.exporting) return;
    this.exportEpoch++;
    this.requests.cancel();
    this.exporting = this.busy = false;
    this.exportedRows = 0;
  }
  private async exportReport() {
    if (
      !this.authorized ||
      !this.hass ||
      !this.page ||
      this.busy ||
      this.page.stale ||
      document.hidden
    )
      return;
    const total = this.page.total;
    if (total > 5000 || JSON.stringify(this.appliedSelection) !== JSON.stringify(this.current))
      return;
    const epoch = this.epoch,
      generation = ++this.exportEpoch;
    const valid = () =>
      this.isConnected &&
      this.authorized &&
      !document.hidden &&
      epoch === this.epoch &&
      generation === this.exportEpoch;
    const filters = { ...this.applied },
      snapshot = this.page.snapshot;
    const records: TimelineRow[] = [],
      ids = new Set<string>();
    const actors: Record<string, string | null> = {};
    const sources = { ...this.page.sources };
    this.busy = this.exporting = true;
    this.exportedRows = 0;
    this.exportError = "";
    let offset = 0;
    try {
      let last: TimelinePage;
      do {
        last = await this.requests.run<TimelinePage>(
          {
            type: "hikvision_intercom/investigations/query",
            filters,
            offset,
            limit: 200,
            snapshot,
          },
          30000,
        );
        if (!valid()) return;
        if (last.stale || last.snapshot !== snapshot || last.total !== total)
          throw { code: "investigation_export_changed" };
        if (
          last.offset !== offset ||
          last.records.length !== Math.min(200, total - offset) ||
          last.next_offset !== (offset + 200 < total ? offset + 200 : null)
        )
          throw { code: "investigation_export_failed" };
        for (const row of last.records) {
          if (ids.has(row.id)) throw { code: "investigation_export_changed" };
          ids.add(row.id);
          records.push(row);
        }
        Object.assign(actors, last.actors);
        sources.access_available &&= last.sources.access_available;
        sources.access_storage_failed ||= last.sources.access_storage_failed;
        this.exportedRows = records.length;
        offset += 200;
      } while (last.next_offset !== null);
      if (valid())
        downloadText(
          JSON.stringify(
            {
              schema: 1,
              complete: true,
              scope: "all_matching_retained_records",
              filters,
              total,
              snapshot,
              generated_at: last.generated_at,
              retention: last.retention,
              correlation: last.correlation,
              sources,
              actors,
              records,
            },
            null,
            2,
          ),
          "wiskey-investigation-report.json",
          "application/json",
        );
    } catch (error) {
      if (valid())
        this.exportError = this.t(
          (error as { code?: string }).code ?? "investigation_export_failed",
        );
    } finally {
      if (valid()) this.busy = this.exporting = false;
    }
  }
  private name(sid: string) {
    return this.stations.find((item) => item.id === sid)?.name ?? this.t("unknown");
  }
  private action(row: TimelineRow) {
    return this.t(row.action.replaceAll("/", "_"));
  }
  private time(raw: unknown) {
    return formatTime(typeof raw === "string" ? raw : null, this.hass?.language, this.zone);
  }
  private row(row: TimelineRow) {
    const liveUser = row.user_id && this.users.some((item) => item.id === row.user_id);
    return html`<article
      class=${row.source}
      aria-label=${this.t("investigation_source_" + row.source)}
    >
      <div class="row">
        <div>
          <b>${row.person_name || this.t("unknown")}</b>
          <span class="tag">${this.t("investigation_source_" + row.source)}</span>
        </div>
        <time datetime=${row.time}>${this.time(row.time)}</time>
      </div>
      <p>
        ${this.action(row)} · ${this.t(row.status)}
        ${row.station_ids.length ? html`· ${row.station_ids.map((id) => this.name(id)).join(", ")}` : nothing}
      </p>
      <p class="sub">${this.t("investigation_evidence_" + row.evidence)}</p>
      ${row.source === "access" ? html`<p class="sub">${this.t("investigation_identity_" + row.details.identity_basis)}${row.details.recovered ? html` · ${this.t("investigation_recovered")}` : nothing} · ${this.t("investigation_time_" + row.time_source)}</p>` : nothing}
      <details>
        <summary>${this.t("investigation_details")}</summary>
        <div class="detail-grid">
          ${row.employee_no ? html`<span>${this.t("investigation_employee_no")}: <bdi>${row.employee_no}</bdi></span>` : nothing}
          ${row.actor ? html`<span>${this.t("investigation_operator")}: ${this.page?.actors[row.actor] || this.t("unknown")}</span>` : nothing}
          ${Array.isArray(row.details.fields) ? html`<span>${this.t("investigation_fields")}: ${row.details.fields.map((key) => this.t(String(key))).join(", ")}</span>` : nothing}
          ${row.details.revision_after ? html`<span>${this.t("investigation_revision")}: ${row.details.revision_before ?? "—"} → ${row.details.revision_after}</span>` : nothing}
          ${row.details.reason_code ? html`<span>${this.t(String(row.details.reason_code))}</span>` : nothing}
          ${row.source === "sync" ? html`<span>${this.t("investigation_queued")}: ${this.time(row.details.queued_at)}</span><span>${this.t("investigation_verified")}: ${this.time(row.details.verified_at)}</span>` : nothing}
          ${row.source === "access" ? html`<span>${this.t("investigation_received")}: ${this.time(row.received_at)}</span><span>${this.t("authentication")}: ${this.t(String(row.details.authentication))}</span>${row.details.door ? html`<span>${this.t("door")}: ${row.details.door}</span>` : nothing}` : nothing}
        </div>
        ${liveUser ? html`<button type="button" @click=${() => this.dispatchEvent(new CustomEvent("open-user", { detail: row.user_id, bubbles: true, composed: true }))}>${this.t("investigation_user_details")}</button>` : nothing}
      </details>
    </article>`;
  }
  render() {
    if (!this.authorized) return nothing;
    return html`<div class="row heading">
        <div>
          <h2>${this.t("investigations")}</h2>
          <p class="sub">${this.t("tools_investigations")}</p>
        </div>
        <button type="button" ?disabled=${this.busy} @click=${() => void this.apply()}>
          ${this.t("refresh")}
        </button>
      </div>
      <div class="toolbar" role="search" aria-label=${this.t("investigation_filters")}>
        <label
          >${this.t("investigation_source")}<select
            .value=${this.current.source}
            @change=${(e: Event) => this.updateFilter("source", e)}
          >
            ${["all", "access", "change", "sync"].map((value) => html`<option value=${value} ?selected=${this.current.source === value}>${this.t("investigation_source_" + value)}</option>`)}
          </select></label
        >
        <label
          >${this.t("investigation_user")}<select
            .value=${this.current.user_id}
            @change=${(e: Event) => this.updateFilter("user_id", e)}
          >
            <option value="">${this.t("all")}</option>
            ${this.current.user_id && !this.users.some((item) => item.id === this.current.user_id) ? html`<option value=${this.current.user_id} selected>${this.t("investigation_missing_user")}</option>` : nothing}
            ${this.users.map((item) => html`<option value=${item.id} ?selected=${this.current.user_id === item.id}>${item.display_name}</option>`)}
          </select></label
        >
        <label
          >${this.t("station")}<select
            .value=${this.current.station_id}
            @change=${(e: Event) => this.updateFilter("station_id", e)}
          >
            <option value="">${this.t("all")}</option>
            ${this.current.station_id && !this.stations.some((item) => item.id === this.current.station_id) ? html`<option value=${this.current.station_id} selected>${this.t("investigation_missing_station")}</option>` : nothing}
            ${this.stations.map((item) => html`<option value=${item.id} ?selected=${this.current.station_id === item.id}>${item.name}</option>`)}
          </select></label
        >
        <label
          >${this.t("investigation_period")}<select
            .value=${this.current.period}
            @change=${(e: Event) => this.updateFilter("period", e)}
          >
            ${["1", "7", "30", "all"].map((value) => html`<option value=${value} ?selected=${this.current.period === value}>${this.t("investigation_period_" + value)}</option>`)}
          </select></label
        >
        <label class="search"
          >${this.t("search")}<input
            maxlength="128"
            .value=${this.current.query}
            @input=${(e: Event) => this.updateFilter("query", e)}
        /></label>
        <button
          type="button"
          class="primary"
          ?disabled=${this.busy}
          @click=${() => void this.apply()}
        >
          ${this.t("investigation_run")}
        </button>
      </div>
      <details class="saved">
        <summary>${this.t("investigation_saved")}</summary>
        <p class="sub">${this.t("investigation_saved_scope")}</p>
        <div class="row">
          <label
            >${this.t("investigation_saved")}<select
              .value=${this.savedId}
              @change=${(e: Event) => (this.savedId = (e.target as HTMLSelectElement).value)}
            >
              <option value="">${this.t("investigation_choose")}</option>
              ${this.saved.map((item) => html`<option value=${item.id} ?selected=${this.savedId === item.id}>${item.name}</option>`)}
            </select></label
          >
          <button
            type="button"
            ?disabled=${!this.savedId || this.busy}
            @click=${() => void this.useView()}
          >
            ${this.t("investigation_apply")}</button
          ><button
            type="button"
            ?disabled=${!this.savedId || !!this.storageError}
            @click=${() => this.removeView()}
          >
            ${this.t("delete")}
          </button>
          <label
            >${this.t("investigation_view_name")}<input
              maxlength="64"
              .value=${this.savedName}
              @input=${(e: Event) => (this.savedName = (e.target as HTMLInputElement).value)}
          /></label>
          <button
            type="button"
            ?disabled=${!this.savedName.trim() || this.saved.length >= 20 || !!this.storageError}
            @click=${() => this.saveView()}
          >
            ${this.t("investigation_save_view")}
          </button>
          <button type="button" @click=${() => this.readSaved()}>
            ${this.t("investigation_reload_views")}
          </button>
        </div>
        ${this.storageError ? html`<p class="error" role="alert">${this.storageError}</p>` : nothing}
      </details>
      <p class="sub">${this.t("investigation_limits")}</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${this.exportError ? html`<p class="error" role="alert">${this.exportError}</p>` : nothing}
      ${this.exporting ? html`<div class="row" role="status"><span>${this.t("investigation_export_progress")}: ${this.exportedRows} / ${this.page?.total}</span><button type="button" @click=${() => this.cancelExport()}>${this.t("investigation_export_cancel")}</button></div>` : nothing}
      <p class="sub">${this.t("investigation_export_limits")}</p>
      ${this.busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}
      ${
        this.page
          ? html`<p role="status">
                ${this.t("investigation_results")}: ${this.page.total} ·
                ${["access", "change", "sync"].map((key) => this.t("investigation_source_" + key) + ": " + this.page!.summary[key]).join(" · ")}
              </p>
              ${this.page.stale ? html`<p class="error" role="alert">${this.t("investigation_stale")}</p>` : nothing}
              ${!this.page.sources.access_available || this.page.sources.access_storage_failed ? html`<p class="error" role="alert">${this.t("investigation_access_unavailable")}</p>` : nothing}
              ${this.page.records.map((row) => this.row(row))}
              <div class="row">
                <button
                  type="button"
                  ?disabled=${this.busy || this.page.stale || this.page.previous_offset === null}
                  @click=${() => void this.load(this.page!.previous_offset!, this.page!.snapshot)}
                >
                  ${this.t("investigation_previous")}</button
                ><span
                  >${Math.floor(this.page.offset / this.page.limit) + 1} /
                  ${Math.max(1, Math.ceil(this.page.total / this.page.limit))}</span
                ><button
                  type="button"
                  ?disabled=${this.busy || this.page.stale || this.page.next_offset === null}
                  @click=${() => void this.load(this.page!.next_offset!, this.page!.snapshot)}
                >
                  ${this.t("investigation_next")}
                </button>
                <button
                  type="button"
                  @click=${() => downloadText(JSON.stringify({ filters: this.applied, ...this.page }, null, 2), "wiskey-investigation-page.json", "application/json")}
                  ?disabled=${this.busy}
                >
                  ${this.t("investigation_download_page")}
                </button>
                <button
                  type="button"
                  ?disabled=${this.busy || this.page.stale || this.page.total > 5000 || JSON.stringify(this.appliedSelection) !== JSON.stringify(this.current)}
                  @click=${() => void this.exportReport()}
                >
                  ${this.t("investigation_download_report")}
                </button>
              </div>`
          : nothing
      }`;
  }
}
customElements.define("wiskey-investigations", Investigations);
