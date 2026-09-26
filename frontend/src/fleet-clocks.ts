import { LitElement, html, nothing, css } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { formatTime, offsetLabel, UTC_ZONE } from "./time";
import type { Hass, Station, StationClock } from "./types";

export class FleetClocks extends LitElement {
  static styles = [
    styles,
    css`
      .clocks {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
        gap: 12px;
        margin-block: 12px;
      }
      article {
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        padding: 14px;
        min-width: 0;
      }
      p,
      small {
        overflow-wrap: anywhere;
      }
      .reading {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    reports: { attribute: false },
    now: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  reports: Record<string, { clock?: Partial<StationClock> }> = {};
  private now = Date.now();
  private timer?: number;
  private tick = () => {
    if (!document.hidden) this.now = Date.now();
  };
  connectedCallback() {
    super.connectedCallback();
    this.tick();
    this.timer = window.setInterval(this.tick, 60000);
    document.addEventListener("visibilitychange", this.tick);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.tick);
  }
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private clock(station: Station): Partial<StationClock> {
    const a = station.clock,
      b = this.reports[station.id]?.clock;
    if (!a) return b ?? {};
    if (!b) return a;
    const at = Date.parse(a.checked_at ?? "") || 0,
      bt = Date.parse(b.checked_at ?? "") || 0;
    if (at === bt) return a.status === "stale" ? a : b;
    return at > bt ? a : b;
  }
  private fresh(clock: Partial<StationClock>) {
    const age = this.now - Date.parse(clock.checked_at ?? "");
    return clock.status === "ready" && age >= -60000 && age <= 1800000;
  }
  private row(station: Station) {
    const clock = this.clock(station);
    const fresh = this.fresh(clock);
    const m = clock.measurement;
    const measured =
      m?.status === "measured" &&
      Number.isFinite(m.estimated_skew_seconds) &&
      Number.isFinite(m.uncertainty_seconds);
    const state = !fresh
      ? "stale"
      : measured
        ? (clock.drift_state ?? "not_measured")
        : "not_measured";
    const next = clock.next_transition;
    return html`<article data-station=${station.id}>
      <strong>${station.name}</strong>
      <p class="drift">${this.t("fleet_" + state)}</p>
      <p class="reading">
        ${this.t("fleet_estimate")}:
        ${measured ? html`<bdi>${m!.estimated_skew_seconds} ± ${m!.uncertainty_seconds}</bdi>` : "—"}
      </p>
      <small
        >${this.t("clock_checked")}:
        ${formatTime(clock.checked_at, this.hass?.language, UTC_ZONE)}</small
      >
      <p>${this.t("fleet_mode")}: <bdi>${clock.time_mode ?? "—"}</bdi></p>
      <p>${this.t("fleet_rules")}: <bdi>${clock.device_zone?.name ?? "—"}</bdi></p>
      <p>
        ${this.t("fleet_display")}: ${this.t("clock_source_" + (clock.source ?? "fallback"))} ·
        <bdi>${clock.zone?.name ?? "—"}</bdi>
      </p>
      <p class="transition">
        ${this.t("fleet_next")}:
        ${
          fresh && next?.status === "scheduled" && Date.parse(next.at ?? "") > this.now
            ? html`${formatTime(next.at, this.hass?.language, clock.device_zone ?? UTC_ZONE)} ·
                <bdi
                  >${offsetLabel(next.before_seconds!)} → ${offsetLabel(next.after_seconds!)}</bdi
                >`
            : this.t(fresh && next?.status === "fixed" ? "fleet_fixed" : "fleet_not_computed")
        }
      </p>
    </article>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const fresh = this.stations.map((s) => this.clock(s)).filter((c) => this.fresh(c));
    const rules = new Set(fresh.map((c) => c.device_zone?.name).filter(Boolean));
    const modes = new Set(fresh.map((c) => c.time_mode).filter((m) => m && m !== "unknown"));
    return html`<details class="fleet-clocks">
      <summary>${this.t("fleet_title")}</summary>
      <p>${this.t("fleet_hint")}</p>
      ${rules.size > 1 || modes.size > 1 ? html`<p class="notice">${this.t("fleet_different")}</p>` : nothing}
      <div class="clocks">${this.stations.map((s) => this.row(s))}</div>
    </details>`;
  }
}
customElements.define("hikvision-intercom-fleet-clocks", FleetClocks);
