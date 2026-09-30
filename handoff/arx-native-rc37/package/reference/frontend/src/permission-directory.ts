import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";
interface Directory {
  total: number;
  offset: number;
  limit: number;
  generated_at: string;
  rows: {
    user_id: string;
    display_name: string;
    employee_no: string;
    condition: string;
    doors: {
      station_id: string;
      allowed: boolean;
      selected: boolean;
      override: string | null;
      groups: string[];
      sync_state: string | null;
      desired_revision: number | null;
      applied_revision: number | null;
    }[];
  }[];
}
export class PermissionDirectory extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      article {
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        padding: 12px;
        margin: 10px 0;
      }
      .doors {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 8px;
      }
      .door {
        padding: 8px;
        background: var(--secondary-background-color);
        overflow-wrap: anywhere;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    stamp: { attribute: false },
    report: { state: true },
    stationId: { state: true },
    mode: { state: true },
    search: { state: true },
    busy: { state: true },
    error: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  stamp = "";
  private report?: Directory;
  private stationId = "";
  private mode = "allowed";
  private search = "";
  private busy = false;
  private error = "";
  private epoch = 0;
  private actor?: string;
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private clear() {
    this.epoch++;
    this.requests.cancel();
    this.report = undefined;
    this.busy = false;
  }
  protected updated(changed: PropertyValues) {
    if (
      changed.has("stamp") ||
      this.actor !== this.hass?.user?.id ||
      !this.hass?.user?.is_admin ||
      (changed.has("hass") &&
        (changed.get("hass") as Hass | undefined)?.connection !== this.hass?.connection)
    )
      this.clear();
    this.actor = this.hass?.user?.id;
  }
  disconnectedCallback() {
    this.clear();
    super.disconnectedCallback();
  }
  private async load(offset = 0) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    const epoch = ++this.epoch;
    try {
      const report = await this.requests.run<Directory>(
        {
          type: "hikvision_intercom/permissions/directory",
          filters: {
            station_id: this.stationId,
            mode: this.mode,
            search: this.search,
            offset,
            limit: 50,
          },
        },
        15000,
      );
      if (epoch === this.epoch && this.isConnected) this.report = report;
    } catch (e) {
      if (epoch === this.epoch) this.error = this.t((e as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<h2>${this.t("permission_directory")}</h2>
      <p>${this.t("permission_directory_hint")}</p>
      <div class="filters">
        <label
          >${this.t("station")}<select
            aria-label=${this.t("station")}
            .value=${this.stationId}
            @change=${(e: Event) => {
              this.clear();
              this.stationId = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">${this.t("all")}</option>
            ${this.stations.filter((s) => s.lock_enabled).map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        >
        <label
          >${this.t("permission_directory_mode")}<select
            aria-label=${this.t("permission_directory_mode")}
            .value=${this.mode}
            @change=${(e: Event) => {
              this.clear();
              this.mode = (e.target as HTMLSelectElement).value;
            }}
          >
            ${["allowed", "all", "exceptions"].map((m) => html`<option value=${m}>${this.t("permission_directory_" + m)}</option>`)}
          </select></label
        >
        <label
          >${this.t("search")}<input
            aria-label=${this.t("search")}
            maxlength="128"
            .value=${this.search}
            @input=${(e: Event) => {
              this.clear();
              this.search = (e.target as HTMLInputElement).value;
            }}
        /></label>
        <button
          ?disabled=${this.busy || this.hass.connection.connected === false}
          @click=${() => this.load()}
        >
          ${this.t("permission_directory_load")}
        </button>
      </div>
      ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}${this.busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}
      ${
        this.report
          ? html`<p>
                ${this.t("users")}: ${this.report.total} ·
                ${new Date(this.report.generated_at).toLocaleString(this.hass.language)}
              </p>
              ${this.report.rows.map(
                (r) =>
                  html`<article>
                    <h3>${r.display_name} · <bdi>${r.employee_no}</bdi></h3>
                    <p>${this.t(r.condition === "upcoming" ? "valid_from" : r.condition)}</p>
                    <div class="doors">
                      ${r.doors.map((d) => html`<div class="door"><strong>${this.stations.find((s) => s.id === d.station_id)?.name ?? d.station_id}</strong><br />${this.t(d.allowed ? "permission_directory_allowed" : "permission_none")} · ${d.override ? this.t(d.override === "deny" ? "permission_denied" : "permission_personal") : d.groups.join(", ") || this.t("permission_none")}<br />${this.t("sync")}: ${d.sync_state ? this.t(d.sync_state) : "—"} · ${this.t("desired")}: ${d.desired_revision ?? "—"} / ${this.t("applied")}: ${d.applied_revision ?? "—"}</div>`)}
                    </div>
                    <button
                      @click=${() => this.dispatchEvent(new CustomEvent("edit-person", { detail: r.user_id }))}
                    >
                      ${this.t("edit")}
                    </button>
                  </article>`,
              )}
              <div class="filters">
                <button
                  ?disabled=${this.busy || !this.report.offset}
                  @click=${() => this.load(Math.max(0, this.report!.offset - 50))}
                >
                  ${this.t("previous")}</button
                ><button
                  ?disabled=${this.busy || this.report.offset + 50 >= this.report.total}
                  @click=${() => this.load(this.report!.offset + 50)}
                >
                  ${this.t("next")}
                </button>
              </div>`
          : nothing
      }`;
  }
}
customElements.define("hikvision-permission-directory", PermissionDirectory);
