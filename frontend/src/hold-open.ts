import { LitElement, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import type { Hass, Station } from "./types";
interface Schedule {
  id: string;
  name: string;
  weekly: Record<string, { start: string; end: string }[]>;
  holidays: {
    name: string;
    start: string;
    end: string;
    periods: { start: string; end: string }[];
  }[];
}
interface Draft {
  revision: number;
  policy: { timezone: string; schedule: Omit<Schedule, "id"> };
}
export class HoldOpenEditor extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    station: { attribute: false },
    door: { state: true },
    draft: { state: true },
    schedules: { state: true },
    selected: { state: true },
    zone: { state: true },
    busy: { state: true },
    error: { state: true },
    loaded: { state: true },
  };
  hass?: Hass;
  station?: Station;
  private door = 1;
  private draft: Draft | null = null;
  private schedules: Schedule[] = [];
  private selected = "";
  private zone = "";
  private busy = false;
  private error = "";
  private loaded = false;
  private identity = "";
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(_changed: PropertyValues) {
    const id = `${this.hass?.user?.id}/${this.station?.id}`;
    if (id !== this.identity) {
      this.identity = id;
      this.requests.cancel();
      this.draft = null;
      this.loaded = false;
      this.busy = false;
      this.error = "";
      this.selected = "";
      this.door = this.station?.integrated_locks[0]?.physical_index ?? 1;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
  }
  private async load() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.loaded = false;
    const id = this.identity;
    try {
      const [result, list] = await Promise.all([
        this.requests.run<{ draft: Draft | null; timezone: string }>({
          type: "smplwise_access_control/stations/technical_hold_get",
          station_id: this.station?.id,
          door: this.door,
        }),
        this.requests.run<Schedule[]>({ type: "smplwise_access_control/schedules/list" }),
      ]);
      if (id !== this.identity) return;
      this.draft = result.draft;
      this.zone = result.draft?.policy.timezone ?? result.timezone;
      this.schedules = list;
      this.selected = "";
      this.loaded = true;
    } catch {
      if (id === this.identity) this.error = "technical_read_failed";
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  private async save() {
    const schedule = this.schedules.find((s) => s.id === this.selected);
    if (this.busy || !schedule) return;
    this.busy = true;
    this.error = "";
    const id = this.identity;
    try {
      const result = await this.requests.run<{ draft: Draft }>({
        type: "smplwise_access_control/stations/technical_hold_save",
        station_id: this.station?.id,
        door: this.door,
        revision: this.draft?.revision ?? 0,
        policy: {
          timezone: this.zone,
          schedule: { name: schedule.name, weekly: schedule.weekly, holidays: schedule.holidays },
        },
      });
      if (id === this.identity) {
        this.draft = result.draft;
        this.selected = "";
      }
    } catch {
      if (id === this.identity) {
        this.error = "technical_write_unknown";
        this.loaded = false;
      }
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  render() {
    return html`<details>
      <summary>${this.t("hold_title")}</summary>
      <p>${this.t("hold_dependency")}</p>
      <p role="status">${this.t("hold_blocked")}</p>
      <label
        >${this.t("physical_lock")}<select
          ?disabled=${this.busy}
          .value=${String(this.door)}
          @change=${(e: Event) => {
            this.door = Number((e.target as HTMLSelectElement).value);
            this.loaded = false;
            this.draft = null;
          }}
        >
          ${this.station?.integrated_locks.map((l) => html`<option value=${l.physical_index}>${this.t("physical_lock")} ${l.physical_index}${l.name ? ` · ${l.name}` : ""}</option>`)}
        </select></label
      ><button
        ?disabled=${this.busy || !this.station?.integrated_locks.length}
        @click=${() => this.load()}
      >
        ${this.t("hold_load")}</button
      >${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}${
        this.loaded
          ? html`<p>${this.t("hold_current")}: ${this.draft?.policy.schedule.name ?? "—"}</p>
              <p>${this.t("hold_library")}</p>
              <label
                >${this.t("hold_schedule")}<select
                  .value=${this.selected}
                  ?disabled=${this.busy}
                  @change=${(e: Event) => (this.selected = (e.target as HTMLSelectElement).value)}
                >
                  <option value="">—</option>
                  ${this.schedules.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
                </select></label
              ><label
                >${this.t("hold_timezone")}<input
                  dir="ltr"
                  .value=${this.zone}
                  ?disabled=${this.busy}
                  @input=${(e: Event) => (this.zone = (e.target as HTMLInputElement).value)} /></label
              ><button
                ?disabled=${this.busy || !this.selected || !this.zone}
                @click=${() => this.save()}
              >
                ${this.t("hold_save")}
              </button>`
          : nothing
      }
    </details>`;
  }
}
customElements.define("hikvision-hold-open", HoldOpenEditor);
