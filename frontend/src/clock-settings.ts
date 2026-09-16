import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import type { Hass, Station } from "./types";

type Policy = { revision: number; server: string; port: number; interval: number };
type Host = {
  supported: boolean;
  synchronized?: boolean | null;
  config?: { servers: string[] } | null;
};
const en = {
  title: "Time and NTP",
  server: "NTP server",
  port: "UDP port",
  interval: "Interval (minutes)",
  save: "Save settings",
  reload: "Reload",
  apply: "Apply shared NTP",
  sync: "Synchronize clock to system",
  all: "Apply NTP to all stations",
  allNow: "Synchronize all clocks to system",
  host: "Home Assistant clock",
  hostApply: "Apply NTP to Home Assistant",
  unavailable:
    "Automatic host configuration requires HA OS 18.3+ and Supervisor NTP support. On other installations, configure the host operating system to use the server above.",
  hint: "Saving stores the shared preference. Apply it to the stations separately. Synchronize to system copies Home Assistant time now, then enables NTP. Station timezone and DST settings are preserved. Clock changes can affect scheduled access.",
  hostHint:
    "HA uses its host clock. Applying NTP verifies configuration, not successful NTP synchronization. DHCP can supply additional servers.",
  saved: "Settings saved; not yet applied.",
  configured: "NTP configuration verified; waiting for clock alignment.",
  verified: "NTP configuration and clock alignment verified.",
  failed: "Operation incomplete or outcome uncertain. Read the station clock before retrying.",
  loading: "Working…",
  offline: "Station unavailable",
  hostSaved: "HA NTP configuration verified. Refresh to check synchronization.",
  synced: "Host reports synchronized",
  unknown: "Host synchronization not confirmed",
  dirty: "Save or reload settings before applying.",
};
const he: Record<keyof typeof en, string> = {
  title: "שעונים ושרת NTP",
  server: "שרת NTP",
  port: "פורט UDP",
  interval: "מרווח סנכרון בדקות",
  save: "שמירת הגדרות",
  reload: "רענון",
  apply: "החלת NTP מרכזי",
  sync: "סנכרן שעון למערכת",
  all: "החלת NTP על כל התחנות",
  allNow: "סנכרן את כל השעונים למערכת",
  host: "שעון Home Assistant",
  hostApply: "החלת NTP על Home Assistant",
  unavailable:
    "הגדרה אוטומטית של שרת HA דורשת HA OS 18.3 ומעלה ותמיכת NTP ב־Supervisor. בהתקנות אחרות יש להגדיר את מערכת ההפעלה לשרת המופיע למעלה.",
  hint: "שמירה שומרת את ההעדפה המרכזית. החילו אותה בנפרד על התחנות. סנכרון למערכת מעתיק את שעת Home Assistant כעת ואז מפעיל NTP. אזור הזמן ושעון הקיץ בתחנות נשמרים. שינוי שעון עשוי להשפיע על הרשאות מתוזמנות.",
  hostHint:
    "HA משתמש בשעון המארח. החלת NTP מאמתת את ההגדרה, ולא מוכיחה שהתקבל זמן משרת NTP. DHCP עשוי לספק שרתים נוספים.",
  saved: "ההגדרות נשמרו; עדיין לא הוחלו.",
  configured: "הגדרת NTP אומתה; ממתין להתאמת השעון.",
  verified: "הגדרת NTP והתאמת השעון אומתו.",
  failed: "הפעולה לא הושלמה או שתוצאתה אינה ודאית. קרא את שעון התחנה לפני ניסיון חוזר.",
  loading: "מבצע…",
  offline: "התחנה אינה זמינה",
  hostSaved: "הגדרת NTP של HA אומתה. רענן לבדיקת מצב הסנכרון.",
  synced: "המארח מדווח שהשעון מסונכרן",
  unknown: "סנכרון שעון המארח טרם אושר",
  dirty: "יש לשמור או לרענן לפני החלה.",
};
export class ClockSettingsPanel extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      section {
        box-sizing: border-box;
        padding: 16px;
        background: var(--card-background-color, white);
        border: 1px solid var(--divider-color, #ddd);
        border-radius: 12px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .clock-row {
        border-bottom: 1px solid var(--divider-color, #ddd);
        padding: 12px 0;
      }
      label {
        display: block;
        margin: 12px 0;
      }
      input {
        max-width: 100%;
        box-sizing: border-box;
      }
      .fields {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    compact: { type: Boolean },
    policy: { state: true },
    busy: { state: true },
    notice: { state: true },
    results: { state: true },
    host: { state: true },
    dirty: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  compact = false;
  private policy?: Policy;
  private busy = false;
  private dirty = false;
  private notice = "";
  private results: Record<string, string> = {};
  private host?: Host;
  private actor?: string;
  private generation = 0;
  private requests = new ScopedRequests(() => this.hass);
  private t(key: keyof typeof en) {
    return (this.hass?.language?.startsWith("he") ? he : en)[key];
  }
  protected updated(_changes: PropertyValues) {
    const actor = this.hass?.user?.id;
    if (actor !== this.actor) {
      this.actor = actor;
      this.generation++;
      this.requests.cancel();
      this.policy = undefined;
      this.results = {};
      this.host = undefined;
      this.notice = "";
      this.busy = false;
      if (this.hass?.user?.is_admin) void this.load();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.generation++;
    this.requests.cancel();
    this.actor = undefined;
  }
  private async load() {
    const g = this.generation;
    this.busy = true;
    try {
      const policy = await this.requests.run<Policy>({
        type: "hikvision_intercom/clock/settings_get",
      });
      if (g !== this.generation) return;
      this.policy = policy;
      this.dirty = false;
      if (!this.compact) {
        const host = await this.requests.run<Host>({
          type: "hikvision_intercom/clock/host_status",
        });
        if (g === this.generation) this.host = host;
      }
    } catch {
      if (g === this.generation) this.notice = this.t("failed");
    } finally {
      if (g === this.generation) this.busy = false;
    }
  }
  private async save() {
    if (!this.policy || this.busy) return;
    const g = this.generation;
    this.busy = true;
    const { revision, ...values } = this.policy;
    try {
      const policy = await this.requests.run<Policy>({
        type: "hikvision_intercom/clock/settings_update",
        revision,
        values,
      });
      if (g !== this.generation) return;
      this.policy = policy;
      this.dirty = false;
      this.notice = this.t("saved");
      this.results = {};
    } catch {
      if (g === this.generation) this.notice = this.t("failed");
    } finally {
      if (g === this.generation) this.busy = false;
    }
  }
  private async apply(stations: Station[], copy: boolean) {
    if (!this.policy || this.busy || this.dirty) return;
    const g = this.generation,
      revision = this.policy.revision;
    this.busy = true;
    try {
      // Bounded sequential writes: one failure does not prevent other stations from completing.
      for (const station of stations) {
        if (g !== this.generation || !this.isConnected) break;
        this.results = { ...this.results, [station.id]: this.t("loading") };
        if (!station.loaded || !station.online) {
          this.results = { ...this.results, [station.id]: this.t("offline") };
          continue;
        }
        try {
          const result = await this.requests.run<{ clock_verified: boolean }>(
            {
              type: "hikvision_intercom/clock/station_sync",
              station_id: station.id,
              revision,
              copy_system: copy,
            },
            75000,
          );
          if (g !== this.generation) break;
          this.results = {
            ...this.results,
            [station.id]: this.t(result.clock_verified ? "verified" : "configured"),
          };
        } catch {
          if (g !== this.generation) break;
          this.results = { ...this.results, [station.id]: this.t("failed") };
        }
      }
    } finally {
      if (g === this.generation) this.busy = false;
    }
  }
  private async applyHost() {
    if (!this.policy || this.busy || this.dirty) return;
    const g = this.generation;
    this.busy = true;
    try {
      await this.requests.run({
        type: "hikvision_intercom/clock/host_apply",
        revision: this.policy.revision,
      });
      if (g === this.generation) this.notice = this.t("hostSaved");
    } catch {
      if (g === this.generation) this.notice = this.t("failed");
    } finally {
      if (g === this.generation) this.busy = false;
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<section aria-label=${this.t("title")}>
      ${this.compact ? nothing : html`<h2>${this.t("title")}</h2>`}
      ${
        this.policy
          ? html`
              ${
                this.compact
                  ? html`<p>NTP: <bdi>${this.policy.server}</bdi></p>`
                  : html` <p>${this.t("hint")}</p>
                      <div class="fields">
                        ${(["server", "port", "interval"] as const).map(
                          (key) =>
                            html`<label
                              >${this.t(key)}<input
                                ?disabled=${this.busy}
                                type=${key === "server" ? "text" : "number"}
                                .value=${String(this.policy![key])}
                                @input=${(e: Event) => {
                                  this.policy = {
                                    ...this.policy!,
                                    [key]:
                                      key === "server"
                                        ? (e.target as HTMLInputElement).value
                                        : Number((e.target as HTMLInputElement).value),
                                  };
                                  this.dirty = true;
                                }}
                            /></label>`,
                        )}
                      </div>
                      <div class="actions">
                        <button ?disabled=${this.busy} @click=${() => this.save()}>
                          ${this.t("save")}</button
                        ><button ?disabled=${this.busy} @click=${() => this.load()}>
                          ${this.t("reload")}
                        </button>
                      </div>
                      ${this.dirty ? html`<p>${this.t("dirty")}</p>` : nothing}
                      <h3>${this.t("host")}</h3>
                      <p>${this.t("hostHint")}</p>
                      <p>${this.t(this.host?.synchronized ? "synced" : "unknown")}</p>
                      ${this.host?.config ? html`<p><bdi>${this.host.config.servers.join(", ")}</bdi></p>` : nothing}
                      ${this.host?.supported ? html`<button ?disabled=${this.busy || this.dirty || this.policy.port !== 123} @click=${() => this.applyHost()}>${this.t("hostApply")}</button>` : html`<p>${this.t("unavailable")}</p>`}
                      <div class="actions">
                        <button
                          ?disabled=${this.busy || this.dirty}
                          @click=${() => this.apply(this.stations, false)}
                        >
                          ${this.t("all")}</button
                        ><button
                          ?disabled=${this.busy || this.dirty}
                          @click=${() => this.apply(this.stations, true)}
                        >
                          ${this.t("allNow")}
                        </button>
                      </div>`
              }
              ${this.stations.map(
                (station) =>
                  html`<div class="clock-row">
                    <strong>${station.name}</strong>
                    <div class="actions">
                      <button
                        ?disabled=${this.busy || this.dirty || !station.loaded || !station.online}
                        @click=${() => this.apply([station], false)}
                      >
                        ${this.t("apply")}</button
                      ><button
                        ?disabled=${this.busy || this.dirty || !station.loaded || !station.online}
                        @click=${() => this.apply([station], true)}
                      >
                        ${this.t("sync")}
                      </button>
                    </div>
                    <p role="status">${this.results[station.id] ?? ""}</p>
                  </div>`,
              )}
            `
          : html`<button ?disabled=${this.busy} @click=${() => this.load()}>
              ${this.t("reload")}
            </button>`
      }
      <p role="status">${this.notice}</p>
    </section>`;
  }
}
customElements.define("hikvision-clock-settings", ClockSettingsPanel);
