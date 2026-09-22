import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { boundedRequest } from "./request";
import { formatTime, UTC_ZONE } from "./time";
import type { Hass, Person, Station } from "./types";

interface OperationChild {
  id: string;
  user_id: string;
  station_id: string;
  state: string;
  updated_at: string;
}
interface OperationRow {
  id: string;
  kind: "sync" | "bulk" | "csv";
  action: string;
  state: string;
  created_at: string | null;
  updated_at: string;
  changed: number;
  user_ids: string[];
  station_ids: string[];
  progress: Record<string, number>;
  children: OperationChild[];
}
interface OperationPage {
  records: OperationRow[];
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  previous_offset: number | null;
  snapshot: string;
  stale: boolean;
  summary: Record<string, number>;
}

export class OperationsCenter extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      .heading,
      .toolbar,
      .actions,
      .pager {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .heading {
        justify-content: space-between;
        margin-bottom: 16px;
      }
      .heading h2,
      .heading p {
        margin: 0;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(5, minmax(110px, 1fr));
        gap: 10px;
        margin: 16px 0;
      }
      .metric {
        padding: 14px;
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        background: var(--surface);
      }
      .metric strong {
        display: block;
        font-size: 1.55rem;
      }
      .metric.failed strong {
        color: var(--error-color, #c83f48);
      }
      .metric.pending strong {
        color: var(--warning-color, #b67600);
      }
      .toolbar {
        padding: 14px;
        background: var(--surface);
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        align-items: end;
      }
      .toolbar label {
        display: grid;
        gap: 5px;
        min-width: 150px;
        flex: 1;
      }
      .toolbar input,
      .toolbar select {
        width: 100%;
        min-height: 42px;
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 9px;
        padding: 8px 10px;
        background: var(--surface);
        color: var(--ink);
      }
      .jobs {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      article {
        background: var(--surface);
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        padding: 14px;
      }
      .job-head {
        display: grid;
        grid-template-columns: minmax(160px, 1fr) auto auto;
        gap: 12px;
        align-items: center;
      }
      .title {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .status {
        display: inline-flex;
        padding: 4px 9px;
        border-radius: 999px;
        background: var(--secondary-background-color, #eef3f4);
      }
      .status.failed {
        color: var(--error-color, #c83f48);
        background: #ffecef;
      }
      .status.verified {
        color: #08734f;
        background: #e8f7ef;
      }
      .status.pending {
        color: #8a5b00;
        background: #fff5d9;
      }
      .progress {
        height: 7px;
        background: var(--secondary-background-color, #edf1f2);
        border-radius: 999px;
        overflow: hidden;
        margin: 10px 0 6px;
      }
      .progress span {
        display: block;
        height: 100%;
        background: var(--accent);
      }
      details {
        margin-top: 10px;
      }
      summary {
        cursor: pointer;
      }
      .child {
        display: grid;
        grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto auto;
        gap: 8px;
        padding: 8px 0;
        border-top: 1px solid var(--divider-color, #e3e9ea);
      }
      .sub {
        color: var(--muted);
        font-size: 0.9em;
      }
      .pager {
        justify-content: center;
        margin-top: 16px;
      }
      @media (max-width: 800px) {
        .summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .job-head {
          grid-template-columns: 1fr;
        }
        .child {
          grid-template-columns: 1fr 1fr;
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    users: { attribute: false },
    stations: { attribute: false },
    canRetryUser: { type: Boolean },
    canRetryStation: { type: Boolean },
    _page: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _kind: { state: true },
    _state: { state: true },
    _station: { state: true },
    _query: { state: true },
  };
  hass?: Hass;
  users: Person[] = [];
  stations: Station[] = [];
  canRetryUser = false;
  canRetryStation = false;
  private _page?: OperationPage;
  private _busy = false;
  private _error = "";
  private _kind = "all";
  private _state = "all";
  private _station = "";
  private _query = "";
  private offset = 0;
  private timer?: number;
  private request?: AbortController;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  connectedCallback() {
    super.connectedCallback();
    this.schedule(0);
  }
  disconnectedCallback() {
    this.stop();
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    if (changed.has("hass")) this.schedule(0);
  }
  private stop() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.request?.abort();
    this.request = undefined;
  }
  private schedule(delay = 10000) {
    if (!this.isConnected) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.load(true), delay);
  }
  private async load(background = false) {
    if (!this.hass || this.hass.connection.connected === false || this._busy) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    if (!background) this._busy = true;
    try {
      const page = await boundedRequest<OperationPage>(
        () =>
          this.hass!.callWS({
            type: "hikvision_intercom/operations/query",
            api_contract: 1,
            filters: {
              kind: this._kind,
              state: this._state,
              station_id: this._station,
              query: this._query,
            },
            offset: this.offset,
            limit: 50,
            snapshot: this._page?.snapshot ?? "",
          }),
        30000,
        request.signal,
      );
      if (request !== this.request) return;
      this._page = page;
      this.offset = page.offset;
      this._error = "";
    } catch (error) {
      if (request === this.request && !request.signal.aborted)
        this._error = this.t((error as { code?: string })?.code ?? "failed");
    } finally {
      if (request === this.request) {
        this.request = undefined;
        this._busy = false;
        this.schedule();
      }
    }
  }
  private async retry(row: OperationRow, mode: "user" | "station") {
    if (!this.hass || this._busy || (mode === "user" ? !this.canRetryUser : !this.canRetryStation))
      return;
    this._busy = true;
    try {
      await this.hass.callWS({
        type: `hikvision_intercom/sync/${mode}`,
        api_contract: 1,
        [mode + "_id"]: mode === "user" ? row.user_ids[0] : row.station_ids[0],
      });
      this._busy = false;
      await this.load();
    } catch (error) {
      this._error = this.t((error as { code?: string })?.code ?? "failed");
    } finally {
      this._busy = false;
    }
  }
  private userName(id: string) {
    return this.users.find((u) => u.id === id)?.display_name ?? this.t("operation_removed_user");
  }
  private stationName(id: string) {
    return this.stations.find((s) => s.id === id)?.name ?? this.t("unknown");
  }
  private action(row: OperationRow) {
    if (row.action === "sync/user_station") return this.t("job_action_sync_user_station");
    if (row.action === "bulk/csv_import") return this.t("job_action_bulk_csv_import");
    return this.t(row.action.replace("/", "_"));
  }
  private percent(row: OperationRow) {
    const total = row.progress.total || row.changed || 1;
    return Math.min(
      100,
      Math.round((((row.progress.verified ?? 0) + (row.progress.settled ?? 0)) * 100) / total),
    );
  }
  render() {
    const summary = this._page?.summary ?? {};
    return html`<div class="heading">
        <div>
          <h2>${this.t("jobs_title")}</h2>
          <p class="sub">${this.t("jobs_intro")}</p>
        </div>
        <button @click=${() => this.load()} ?disabled=${this._busy}>
          ${this.t("operations_reload")}
        </button>
      </div>
      <section class="summary" aria-label=${this.t("jobs_summary")}>
        ${["pending", "failed", "verified", "settled", "saved"].map((state) => html`<div class="metric ${state}"><strong>${summary[state] ?? 0}</strong><span>${this.t("operation_" + state)}</span></div>`)}
      </section>
      <div class="toolbar">
        <label
          >${this.t("search")}<input
            type="search"
            .value=${this._query}
            @change=${(e: Event) => {
              this._query = (e.target as HTMLInputElement).value;
              this.offset = 0;
              void this.load();
            }} /></label
        ><label
          >${this.t("jobs_kind")}<select
            .value=${this._kind}
            @change=${(e: Event) => {
              this._kind = (e.target as HTMLSelectElement).value;
              this.offset = 0;
              void this.load();
            }}
          >
            ${["all", "sync", "bulk", "csv"].map((v) => html`<option value=${v}>${this.t("job_kind_" + v)}</option>`)}
          </select></label
        ><label
          >${this.t("status")}<select
            .value=${this._state}
            @change=${(e: Event) => {
              this._state = (e.target as HTMLSelectElement).value;
              this.offset = 0;
              void this.load();
            }}
          >
            ${["all", "pending", "failed", "verified", "settled", "saved"].map((v) => html`<option value=${v}>${this.t(v === "all" ? "all" : "operation_" + v)}</option>`)}
          </select></label
        ><label
          >${this.t("devices")}<select
            .value=${this._station}
            @change=${(e: Event) => {
              this._station = (e.target as HTMLSelectElement).value;
              this.offset = 0;
              void this.load();
            }}
          >
            <option value="">${this.t("all")}</option>
            ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        >
      </div>
      ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
      ${this._busy && !this._page ? html`<p role="status">${this.t("loading")}</p>` : nothing}
      <div class="jobs">
        ${(this._page?.records ?? []).map(
          (row) =>
            html`<article>
              <div class="job-head">
                <div>
                  <div class="title">
                    <strong>${this.action(row)}</strong
                    ><span class="status ${row.state}">${this.t("operation_" + row.state)}</span>
                  </div>
                  <div class="sub">
                    <bdi>${formatTime(row.updated_at, this.hass?.language, UTC_ZONE)}</bdi> ·
                    ${this.t("bulk_changed")}: ${row.changed}
                  </div>
                </div>
                <div>
                  ${row.user_ids
                    .slice(0, 2)
                    .map((id) => this.userName(id))
                    .join(", ")}${row.user_ids.length > 2 ? ` +${row.user_ids.length - 2}` : ""}
                </div>
                <div>
                  ${row.station_ids
                    .slice(0, 2)
                    .map((id) => this.stationName(id))
                    .join(
                      ", ",
                    )}${row.station_ids.length > 2 ? ` +${row.station_ids.length - 2}` : ""}
                </div>
              </div>
              <div class="progress" aria-label=${this.t("jobs_progress")}>
                <span style=${`width:${this.percent(row)}%`}></span>
              </div>
              <div class="actions">
                <span class="sub">${this.percent(row)}% · <bdi>${row.id}</bdi></span
                >${this.canRetryUser && ["pending", "failed"].includes(row.state) && row.user_ids.length === 1 ? html`<button @click=${() => this.retry(row, "user")} ?disabled=${this._busy}>${this.t("jobs_retry_user")}</button>` : nothing}${this.canRetryStation && ["pending", "failed"].includes(row.state) && row.station_ids.length === 1 ? html`<button @click=${() => this.retry(row, "station")} ?disabled=${this._busy}>${this.t("jobs_retry_station")}</button>` : nothing}
              </div>
              ${
                row.children.length
                  ? html`<details>
                      <summary>${this.t("jobs_details")} (${row.children.length})</summary>
                      ${row.children.map((child) => html`<div class="child"><span>${this.userName(child.user_id)}</span><span>${this.stationName(child.station_id)}</span><span class="status ${child.state}">${this.t("operation_" + child.state)}</span><bdi>${formatTime(child.updated_at, this.hass?.language, UTC_ZONE)}</bdi></div>`)}
                    </details>`
                  : nothing
              }
            </article>`,
        )}
      </div>
      ${this._page && !this._page.records.length ? html`<p class="notice">${this.t("jobs_empty")}</p>` : nothing}
      <div class="pager">
        <button
          ?disabled=${this._page?.previous_offset == null || this._busy}
          @click=${() => {
            this.offset = this._page!.previous_offset!;
            void this.load();
          }}
        >
          ${this.t("previous")}</button
        ><span>${this._page?.total ?? 0}</span
        ><button
          ?disabled=${this._page?.next_offset == null || this._busy}
          @click=${() => {
            this.offset = this._page!.next_offset!;
            void this.load();
          }}
        >
          ${this.t("next")}
        </button>
      </div>`;
  }
}
customElements.define("wiskey-operations-center", OperationsCenter);
