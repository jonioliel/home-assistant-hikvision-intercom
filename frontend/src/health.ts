import "./event-tools";
import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { formatTime, UTC_ZONE } from "./time";
import { downloadText } from "./download";
import { boundedRequest } from "./request";
import "./call-controls";
import type { Hass, Station } from "./types";

interface HealthRead {
  id: string;
  refresh: boolean;
  epoch: number;
}

interface Health {
  integration_version: string;
  model?: string;
  firmware?: string;
  online?: boolean;
  generated_at: string;
  clock?: { skew_seconds?: number | null; status?: string; checked_at?: string | null };
  access?: { queue_depth: number; errors: Record<string, number>; last_error?: string | null };
  events?: {
    stream: string;
    history: string;
    reconnects: number;
    telemetry?: {
      stream_arrival_delay: { samples: number; median: number | null; p95: number | null };
      accepted: number;
      duplicates: number;
    };
  };
  media?: {
    call_commands?: string[];
    audio_channels?: { id: number; enabled: boolean | null; codec: string }[];
    errors?: Record<string, string>;
  } | null;
}
interface Acceptance {
  revision: number;
  steps: string[];
  basis: string;
  results: Record<string, { state: string; checked_at: string; basis: string }>;
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
        border-radius: 14px;
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
    `,
  ];
  static properties = {
    hass: { attribute: false },
    callBusy: { attribute: false },
    onCallBusy: { attribute: false },
    _callDetails: { state: true },
    stations: { attribute: false },
    _reports: { state: true },
    _busy: { state: true },
    _errors: { state: true },
    _fieldErrors: { state: true },
    _acceptance: { state: true },
    _selected: { state: true },
    _haConnected: { state: true },
  };
  hass?: Hass;
  callBusy: ReadonlySet<string> = new Set();
  onCallBusy?: (station: string, busy: boolean) => void;
  private _callDetails = new Set<string>();
  stations: Station[] = [];
  private _reports: Record<string, Health> = {};
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
    if (this._callDetails.size) this._callDetails = new Set();
    if (Object.keys(this._acceptance).length) this._acceptance = {};
    if (Object.keys(this._errors).length) this._errors = {};
    if (Object.keys(this._fieldErrors).length) this._fieldErrors = {};
    if (this._selected.size) this._selected = new Set();
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
  private card(station: Station) {
    const report = this._reports[station.id];
    const delays = report?.events?.telemetry?.stream_arrival_delay;
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
      ${Math.abs(report?.clock?.skew_seconds ?? 0) > 90 ? html`<p class="notice error">${this.t("health_clock_warning")}</p>` : nothing}
      <p>${this.t("health_delay")}: ${delays?.median ?? "—"} / ${delays?.p95 ?? "—"}</p>
      <p class="sub">${this.t("event_clock_hint")}</p>
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
    return html`<section>
      <h2>${this.t("health")}</h2>
      <p>${this.t("health_cached")}</p>
      <p>${this.t("health_scope")}</p>
      ${!this._haConnected ? html`<p class="notice error" role="alert">${this.t("health_disconnected")}</p>` : nothing}
      <button
        ?disabled=${!this._haConnected || !this._selected.size}
        @click=${this.refreshSelected}
      >
        ${this.t("health_refresh")}
      </button>
      <div class="health-grid">${this.stations.map((station) => this.card(station))}</div>
    </section>`;
  }
}
customElements.define("hikvision-intercom-health", IntercomHealth);
