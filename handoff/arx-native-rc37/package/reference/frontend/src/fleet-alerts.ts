import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";

interface Suppression {
  station_id: string;
  kind: string;
  reason: string;
  until: string;
  created_at: string;
  actor: string;
}
interface FleetAlert {
  id: string;
  station_id: string;
  station_name: string;
  kind: string;
  severity: string;
  observed_since: string | null;
  observed_seconds: number | null;
  suppressed: boolean;
  suppression: Suppression | null;
}
interface AlertPage {
  revision: number;
  generated_at: string;
  items: FleetAlert[];
  total: number;
  offset: number;
  next_offset: number | null;
  active_count: number;
  suppressed_count: number;
  suppressions: Suppression[];
}
interface AlertAction {
  station_id: string;
  kind: string;
  action: "suppress" | "restore";
}
const kinds = [
  "offline",
  "sync_stalled",
  "sync_conflict",
  "sync_error",
  "event_gap",
  "clock_drift",
];

export class FleetAlertsPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    canManage: { attribute: false },
    page: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    uncertain: { state: true },
    stationFilter: { state: true },
    kindFilter: { state: true },
    includeSuppressed: { state: true },
    pending: { state: true },
    maintenanceStation: { state: true },
    duration: { state: true },
    reason: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
        background: transparent;
        min-height: 0;
      }
      .row {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .heading {
        justify-content: space-between;
      }
      h2,
      h3,
      p {
        margin: 0 0 10px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
        gap: 12px;
      }
      article,
      .box {
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        padding: 14px;
        background: var(--surface, var(--card-background-color, white));
        min-width: 0;
      }
      .box {
        margin-block: 14px;
      }
      .sub {
        color: var(--muted, var(--secondary-text-color));
        font-size: 13px;
      }
      .error,
      p {
        overflow-wrap: anywhere;
      }
      label {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      select {
        min-width: 0;
        max-width: 100%;
      }
      .actions {
        justify-content: end;
        margin-block-start: 12px;
      }
      .tag {
        border-radius: 20px;
        padding: 4px 9px;
        background: var(--soft, #e8f0ee);
        font-size: 13px;
      }
      .severity-error {
        border-inline-start: 4px solid var(--error-color, #c83f48);
      }
      .suppressed {
        opacity: 0.7;
      }
      .toolbar {
        margin-block: 14px;
      }
      @media (max-width: 540px) {
        .toolbar label {
          flex: 1 1 100%;
        }
        .toolbar select {
          flex: 1;
        }
        .actions button {
          flex: 1;
        }
      }
    `,
  ];
  hass?: Hass;
  stations: Station[] = [];
  canManage = false;
  private page?: AlertPage;
  private busy = false;
  private error = "";
  private notice = "";
  private uncertain = false;
  private stationFilter = "";
  private kindFilter = "";
  private includeSuppressed = false;
  private pending?: AlertAction;
  private maintenanceStation = "";
  private duration = 60;
  private reason = "planned_maintenance";
  private epoch = 0;
  private actor?: string;
  private connection?: Hass["connection"];
  private timer?: ReturnType<typeof setTimeout>;
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changes: PropertyValues) {
    if (
      this.hass &&
      (this.actor !== this.hass.user?.id || this.connection !== this.hass.connection)
    ) {
      this.reset();
      this.actor = this.hass.user?.id;
      this.connection = this.hass.connection;
      void this.load(0);
    } else if (changes.has("canManage") && !this.canManage) {
      this.pending = undefined;
      this.epoch++;
      this.requests.cancel();
      this.busy = false;
      void this.load(0);
    }
  }
  private reset() {
    this.epoch++;
    this.requests.cancel();
    clearTimeout(this.timer);
    this.page = undefined;
    this.pending = undefined;
    this.busy = this.uncertain = false;
    this.error = this.notice = "";
  }
  disconnectedCallback() {
    this.reset();
    super.disconnectedCallback();
  }
  private async rpc<T>(command: string, values: Record<string, unknown> = {}) {
    return this.requests.run<T>({ type: `hikvision_intercom/${command}`, ...values });
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.isConnected)
      this.timer = setTimeout(() => {
        if (
          document.visibilityState === "visible" &&
          !this.pending &&
          !this.busy &&
          !this.uncertain
        )
          void this.load(this.page?.offset ?? 0);
        else this.schedule();
      }, 30000);
  }
  private async load(offset = 0) {
    if (this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      const page = await this.rpc<AlertPage>("fleet/alerts", {
        offset,
        limit: 100,
        station_id: this.stationFilter,
        kind: this.kindFilter,
        include_suppressed: this.includeSuppressed,
      });
      if (epoch !== this.epoch || !this.isConnected) return;
      this.page = page;
      this.error = "";
      this.uncertain = false;
    } catch (error) {
      if (epoch === this.epoch) this.error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.schedule();
      }
    }
  }
  private filter(key: "stationFilter" | "kindFilter", event: Event) {
    this[key] = (event.target as HTMLSelectElement).value;
    void this.load(0);
  }
  private prepare(action: AlertAction) {
    if (this.canManage && !this.busy && !this.uncertain) {
      this.pending = action;
      this.duration = 60;
      this.reason = action.kind === "maintenance" ? "planned_maintenance" : "investigating";
      this.error = "";
    }
  }
  private name(id: string) {
    return (
      this.stations.find((station) => station.id === id)?.name ?? this.t("visit_missing_station")
    );
  }
  private date(value: string) {
    return new Date(value).toLocaleString(this.hass?.language ?? "en");
  }
  private async confirm() {
    if (!this.pending || !this.page || !this.canManage || this.busy || this.uncertain) return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = "";
    try {
      await this.rpc("fleet/alerts_action", {
        revision: this.page.revision,
        ...this.pending,
        duration_minutes: this.duration,
        reason: this.reason,
      });
      if (epoch !== this.epoch || !this.isConnected || !this.canManage) return;
      this.pending = undefined;
      this.notice = this.t("fleet_alert_action_saved");
      this.busy = false;
      await this.load(0);
    } catch (error) {
      if (epoch === this.epoch) {
        const code = (error as { code?: string }).code ?? "failed";
        this.error = this.t(code);
        this.uncertain = ["revision_conflict", "connection_lost"].includes(code);
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private review() {
    if (!this.pending) return nothing;
    return html`<section class="box" role="region" aria-label=${this.t("fleet_alert_review")}>
      <h3>${this.t("fleet_alert_review")}</h3>
      <p>${this.name(this.pending.station_id)} · ${this.t("fleet_alert_" + this.pending.kind)}</p>
      <p class="sub">${this.t("fleet_alert_observation_only")}</p>
      ${
        this.pending.action === "suppress"
          ? html`<div class="row toolbar">
              <label
                >${this.t("fleet_alert_duration")}<select
                  .value=${String(this.duration)}
                  @change=${(e: Event) => (this.duration = Number((e.target as HTMLSelectElement).value))}
                >
                  ${[15, 60, 240, 1440, 10080].map((minutes) => html`<option value=${minutes} ?selected=${this.duration === minutes}>${this.t("fleet_alert_duration_" + minutes)}</option>`)}
                </select></label
              ><label
                >${this.t("fleet_alert_reason")}<select
                  .value=${this.reason}
                  @change=${(e: Event) => (this.reason = (e.target as HTMLSelectElement).value)}
                >
                  ${["planned_maintenance", "network_work", "investigating"].map((reason) => html`<option value=${reason} ?selected=${this.reason === reason}>${this.t("fleet_alert_reason_" + reason)}</option>`)}
                </select></label
              >
            </div>`
          : nothing
      }
      <div class="row actions">
        <button type="button" ?disabled=${this.busy} @click=${() => (this.pending = undefined)}>
          ${this.t("cancel")}</button
        ><button
          type="button"
          class="primary"
          ?disabled=${this.busy || this.uncertain || !this.canManage}
          @click=${() => void this.confirm()}
        >
          ${this.t(this.pending.action === "restore" ? "fleet_alert_confirm_restore" : "fleet_alert_confirm_suppress")}
        </button>
      </div>
    </section>`;
  }
  private card(row: FleetAlert) {
    return html`<article class=${`severity-${row.severity} ${row.suppressed ? "suppressed" : ""}`}>
      <div class="row heading">
        <h3>${row.station_name}</h3>
        <span class="tag">${this.t("fleet_alert_" + row.kind)}</span>
      </div>
      <p>${this.t("fleet_alert_help_" + row.kind)}</p>
      <p class="sub">
        ${row.observed_since ? this.t("fleet_alert_first_observed") + ": " + this.date(row.observed_since) : this.t("fleet_alert_time_unknown")}
      </p>
      ${row.suppression ? html`<p class="sub">${this.t("fleet_alert_reason_" + row.suppression.reason)} · ${this.t("fleet_alert_until")}: ${this.date(row.suppression.until)}</p>` : nothing}
      <div class="row actions">
        <button
          type="button"
          @click=${() => this.dispatchEvent(new CustomEvent("open-station", { detail: row.station_id, bubbles: true, composed: true }))}
        >
          ${this.t("fleet_alert_open_station")}</button
        >${this.canManage && !row.suppressed ? html`<button type="button" ?disabled=${this.busy || this.uncertain} @click=${() => this.prepare({ station_id: row.station_id, kind: row.kind, action: "suppress" })}>${this.t("fleet_alert_snooze")}</button><button type="button" ?disabled=${this.busy || this.uncertain} @click=${() => this.prepare({ station_id: row.station_id, kind: "maintenance", action: "suppress" })}>${this.t("fleet_alert_maintenance")}</button>` : nothing}
      </div>
    </article>`;
  }
  private policies() {
    if (!this.page?.suppressions.length) return nothing;
    return html`<section class="box">
      <h3>${this.t("fleet_alert_suppressions")}</h3>
      ${this.page.suppressions.map(
        (row) =>
          html`<div class="row heading">
            <p>
              ${this.name(row.station_id)} · ${this.t("fleet_alert_" + row.kind)} ·
              ${this.t("fleet_alert_until")}: ${this.date(row.until)}
            </p>
            ${this.canManage ? html`<button type="button" ?disabled=${this.busy || this.uncertain} @click=${() => this.prepare({ station_id: row.station_id, kind: row.kind, action: "restore" })}>${this.t("fleet_alert_restore")}</button>` : nothing}
          </div>`,
      )}
    </section>`;
  }
  render() {
    return html`<div class="row heading">
        <h2>${this.t("fleet_alerts")}</h2>
        <button
          type="button"
          ?disabled=${this.busy}
          @click=${() => {
            this.pending = undefined;
            void this.load(this.page?.offset ?? 0);
          }}
        >
          ${this.t("refresh")}
        </button>
      </div>
      <p class="sub">${this.t("fleet_alert_intro")}</p>
      ${this.page ? html`<p>${this.t("fleet_alert_active")}: <strong>${this.page.active_count}</strong> · ${this.t("fleet_alert_suppressed")}: <strong>${this.page.suppressed_count}</strong></p>` : nothing}
      <div class="row toolbar">
        <label
          >${this.t("select_station")}<select
            .value=${this.stationFilter}
            ?disabled=${this.busy || !!this.pending}
            @change=${(e: Event) => this.filter("stationFilter", e)}
          >
            <option value="">${this.t("all")}</option>
            ${this.stations.map((station) => html`<option value=${station.id}>${station.name}</option>`)}
          </select></label
        ><label
          >${this.t("fleet_alert_kind")}<select
            .value=${this.kindFilter}
            ?disabled=${this.busy || !!this.pending}
            @change=${(e: Event) => this.filter("kindFilter", e)}
          >
            <option value="">${this.t("all")}</option>
            ${kinds.map((kind) => html`<option value=${kind}>${this.t("fleet_alert_" + kind)}</option>`)}
          </select></label
        ><label
          ><input
            type="checkbox"
            .checked=${this.includeSuppressed}
            ?disabled=${this.busy || !!this.pending}
            @change=${(e: Event) => {
              this.includeSuppressed = (e.target as HTMLInputElement).checked;
              void this.load(0);
            }}
          />${this.t("fleet_alert_show_suppressed")}</label
        >
      </div>
      ${
        this.canManage
          ? html`<div class="row">
              <label
                >${this.t("fleet_alert_maintenance")}<select
                  .value=${this.maintenanceStation}
                  @change=${(e: Event) => (this.maintenanceStation = (e.target as HTMLSelectElement).value)}
                >
                  <option value="">${this.t("select_station")}</option>
                  ${this.stations.map((station) => html`<option value=${station.id}>${station.name}</option>`)}
                </select></label
              ><button
                type="button"
                ?disabled=${!this.maintenanceStation || this.busy || this.uncertain}
                @click=${() => this.prepare({ station_id: this.maintenanceStation, kind: "maintenance", action: "suppress" })}
              >
                ${this.t("fleet_alert_set_maintenance")}
              </button>
            </div>`
          : nothing
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.notice ? html`<p role="status">${this.notice}</p>` : nothing}${this.uncertain ? html`<p class="notice">${this.t("visit_refresh_before_retry")}</p>` : nothing}${this.review()}${this.policies()}
      <div class="cards">${this.page?.items.map((row) => this.card(row))}</div>
      ${this.page && !this.page.items.length ? html`<p>${this.t("fleet_alert_empty")}</p>` : nothing}
      ${this.page ? html`<div class="row actions"><span class="sub">${this.page.total} ${this.t("fleet_alert_matching")}</span><button type="button" ?disabled=${this.busy || this.page.offset === 0} @click=${() => void this.load(Math.max(0, this.page!.offset - 100))}>${this.t("previous")}</button><button type="button" ?disabled=${this.busy || this.page.next_offset === null} @click=${() => void this.load(this.page!.next_offset!)}>${this.t("next")}</button></div>` : nothing}`;
  }
}
customElements.define("wiskey-fleet-alerts", FleetAlertsPanel);
