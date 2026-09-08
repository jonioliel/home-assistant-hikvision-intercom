import { LitElement, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";

interface AuditEvent {
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
interface AuditPage {
  records: AuditEvent[];
  next: string | null;
  storage_failed: boolean;
  stations: Record<string, { stream: string; history: string }>;
}

export class IntercomEvents extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    _data: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  private _data?: AuditPage;
  private _busy = false;
  private _error = "";
  private _filters: Record<string, unknown> = {};
  private _generation = 0;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changed: PropertyValues) {
    if (changed.has("stations") && this.hass?.user?.is_admin) void this.load();
    if (changed.has("hass") && !this.hass?.user?.is_admin) {
      this._generation++;
      this._data = undefined;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._generation++;
    this._data = undefined;
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
    this._filters = {};
    for (const [key, raw] of form.entries()) {
      if (!raw) continue;
      this._filters[key] =
        key === "door"
          ? Number(raw)
          : key === "start" || key === "end"
            ? new Date(String(raw)).toISOString()
            : raw;
    }
    void this.load();
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<section aria-label=${this.t("events")}>
      <h2>${this.t("events")}</h2>
      <p class="muted">${this.t("audit_retention")}</p>
      <form @submit=${this.apply} class="form-grid">
        <label
          >${this.t("station")}<select name="station_id">
            <option value="">${this.t("all")}</option>
            ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        >
        <label>${this.t("person")}<input name="person" maxlength="128" /></label>
        <label
          >${this.t("result")}<select name="result">
            <option value="">${this.t("all")}</option>
            ${["granted", "denied", "unknown"].map((v) => html`<option value=${v}>${this.t(v)}</option>`)}
          </select></label
        >
        <label
          >${this.t("authentication")}<select name="authentication">
            <option value="">${this.t("all")}</option>
            ${["card", "pin", "unknown"].map((v) => html`<option value=${v}>${this.t(v)}</option>`)}
          </select></label
        >
        <label
          >${this.t("door")}<select name="door">
            <option value="">${this.t("all")}</option>
            <option value="1">1</option>
          </select></label
        >
        <label>${this.t("from_time")}<input type="datetime-local" name="start" /></label>
        <label>${this.t("until_time")}<input type="datetime-local" name="end" /></label>
        <button class="primary" type="submit">${this.t("filter")}</button>
      </form>
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
                  >${new Date(row.timestamp).toLocaleString(this.hass?.language)}</time
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
