import "./hold-open";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import type { Hass, Station } from "./types";
interface Door {
  door: number;
  error?: string;
  values?: Record<string, string | number | boolean>;
  constraints?: Record<string, { type: string; min?: number; max?: number }>;
}
interface Relay {
  physical_index: number;
  api_id: number;
  confirmed: boolean;
  name?: string;
}
interface Report {
  relay_selection: Relay[];
  checked_at: string;
  doors: Door[];
  passwords: null | { public_pin_state: string; states: Record<string, boolean | null> };
  password_error: string | null;
  features: { family: string; name: string; supported: boolean }[];
}
export class StationTechnical extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    station: { attribute: false },
    report: { state: true },
    busy: { state: true },
    error: { state: true },
    draft: { state: true },
    confirmed: { state: true },
    relays: { state: true },
    relayConfirmed: { state: true },
  };
  hass?: Hass;
  station?: Station;
  private report?: Report;
  private relays: Relay[] = [];
  private relayConfirmed = false;
  private busy = false;
  private error = "";
  private draft: Record<number, Record<string, string | number | boolean>> = {};
  private confirmed: Record<number, boolean> = {};
  private requests = new ScopedRequests(() => this.hass);
  private identity = "";
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(_changes: PropertyValues) {
    const key = `${this.hass?.user?.id}/${this.station?.id}`;
    if (key !== this.identity) {
      this.identity = key;
      this.requests.cancel();
      this.report = undefined;
      this.draft = {};
      this.relays = [];
      this.relayConfirmed = false;
      this.confirmed = {};
      this.error = "";
      this.busy = false;
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
    this.report = undefined;
    const identity = this.identity;
    try {
      const result = await this.requests.run<Report>(
        { type: "hikvision_intercom/stations/technical_get", station_id: this.station?.id },
        80000,
      );
      if (identity !== this.identity) return;
      this.report = result;
      this.relays = structuredClone(result.relay_selection ?? []);
      this.relayConfirmed = false;
      this.draft = Object.fromEntries(
        result.doors.filter((d) => d.values).map((d) => [d.door, { ...d.values }]),
      );
      this.confirmed = {};
    } catch {
      if (identity === this.identity) this.error = "technical_read_failed";
    } finally {
      if (identity === this.identity) this.busy = false;
    }
  }
  private async save(door: Door) {
    if (this.busy || !this.confirmed[door.door] || !door.values) return;
    const changes = Object.fromEntries(
      Object.entries(this.draft[door.door]).filter(([k, v]) => v !== door.values![k]),
    );
    if (!Object.keys(changes).length) return;
    this.busy = true;
    this.error = "";
    const identity = this.identity;
    try {
      const updated = await this.requests.run<Door>(
        {
          type: "hikvision_intercom/stations/technical_update",
          station_id: this.station?.id,
          door: door.door,
          expected: door.values,
          changes,
          confirmed: true,
        },
        50000,
      );
      if (identity !== this.identity) return;
      this.report = {
        ...this.report!,
        doors: this.report!.doors.map((d) => (d.door === door.door ? updated : d)),
      };
      this.draft = { ...this.draft, [door.door]: { ...updated.values } };
      this.confirmed = { ...this.confirmed, [door.door]: false };
    } catch {
      if (identity === this.identity) {
        this.error = "technical_write_unknown";
        this.report = undefined;
        this.draft = {};
        this.confirmed = {};
      }
    } finally {
      if (identity === this.identity) this.busy = false;
    }
  }
  private async saveRelays() {
    if (this.busy || !this.relayConfirmed || !this.report) return;
    this.busy = true;
    this.error = "";
    const identity = this.identity;
    try {
      await this.requests.run(
        {
          type: "hikvision_intercom/stations/technical_relays",
          station_id: this.station?.id,
          expected: this.report.relay_selection,
          locks: this.relays,
        },
        15000,
      );
      if (identity !== this.identity) return;
      this.report = undefined;
    } catch {
      if (identity !== this.identity) return;
      this.error = "technical_write_unknown";
      if (identity !== this.identity) return;
      this.report = undefined;
    } finally {
      if (identity === this.identity) {
        this.busy = false;
        this.relayConfirmed = false;
      }
    }
  }
  private relayEditor() {
    return html`<fieldset>
      <legend>${this.t("technical_relays")}</legend>
      <p>${this.t("technical_relays_hint")}</p>
      ${[1, 2].map((index) => {
        const relay = this.relays.find((r) => r.physical_index === index);
        return html`<label
            ><input
              type="checkbox"
              .checked=${!!relay}
              ?disabled=${this.busy}
              @change=${(e: Event) => {
              this.relays = (e.target as HTMLInputElement).checked
                ? [...this.relays, { physical_index: index, api_id: index, confirmed: true }]
                : this.relays.filter((r) => r.physical_index !== index);
              this.relayConfirmed = false;
            }}
            />${this.t("physical_lock")} ${index}</label
          >
          ${
          relay
            ? html`<label
                >API ${index}<select
                  .value=${String(relay.api_id)}
                  ?disabled=${this.busy}
                  @change=${(e: Event) => {
                this.relays = this.relays.map((r) =>
                  r === relay ? { ...r, api_id: Number((e.target as HTMLSelectElement).value) } : r,
                );
                this.relayConfirmed = false;
              }}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select></label
              >`
            : nothing
        }`;
      })}
      <label
        ><input
          type="checkbox"
          .checked=${this.relayConfirmed}
          ?disabled=${this.busy}
          @change=${(e: Event) => {
            this.relayConfirmed = (e.target as HTMLInputElement).checked;
          }}
        />${this.t("technical_relays_confirm")}</label
      >
      <button ?disabled=${this.busy || !this.relayConfirmed} @click=${() => this.saveRelays()}>
        ${this.t("technical_relays_save")}
      </button>
    </fieldset>`;
  }
  render() {
    return html`<hikvision-hold-open
        .hass=${this.hass}
        .station=${this.station}
      ></hikvision-hold-open>
      <details>
        <summary>${this.t("technical_title")}</summary>
        <p>${this.t("technical_intro")}</p>
        <button ?disabled=${this.busy} @click=${() => this.load()}>
          ${this.t("technical_read")}</button
        >${this.busy ? html`<p role="status">${this.t("wait")}</p>` : nothing}${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}${
        this.report
          ? html` ${this.relayEditor()}
              <h4>${this.t("technical_pin_title")}</h4>
              <p>
                ${this.t("technical_pin_" + (this.report.passwords?.public_pin_state ?? "unknown"))}
              </p>
              <p class="sub">${this.t("technical_pin_scope")}</p>
              <details>
                <summary>${this.t("technical_pin_details")}</summary>
                ${Object.entries(this.report.passwords?.states ?? {}).map(([key, v]) => html`<p><bdi>${key}</bdi>: ${this.t(v === null ? "not_verified" : v ? "configured" : "not_configured")}</p>`)}
              </details>
              ${this.report.doors.map(
                (door) =>
                  html`<section>
                    <h4>${this.t("physical_lock")} · API ${door.door}</h4>
                    ${
                      door.error
                        ? html`<p>${this.t(door.error)}</p>`
                        : html` <form
                            @submit=${(e: Event) => {
                 e.preventDefault();
                 void this.save(door);
               }}
                          >
                            ${Object.entries(door.constraints ?? {}).map(([key, cap]) => html`<label>${this.t("technical_" + key)}${cap.type === "boolean" ? html`<input type="checkbox" .checked=${this.draft[door.door]?.[key] === true} ?disabled=${this.busy || !this.managed(door.door)} @change=${(e: Event) => this.change(door.door, key, (e.target as HTMLInputElement).checked)} />` : html`<input required type=${cap.type === "integer" ? "number" : "text"} min=${cap.min ?? 0} max=${cap.max ?? 255} maxlength=${cap.max ?? 64} .value=${String(this.draft[door.door]?.[key] ?? "")} ?disabled=${this.busy || !this.managed(door.door)} @input=${(e: Event) => this.change(door.door, key, cap.type === "integer" ? Number((e.target as HTMLInputElement).value) : (e.target as HTMLInputElement).value)} />`}</label>`)}
                            ${
                 this.managed(door.door)
                   ? html`<label
                         ><input
                           type="checkbox"
                           .checked=${!!this.confirmed[door.door]}
                           ?disabled=${this.busy}
                           @change=${(e: Event) => {
                             this.confirmed = {
                               ...this.confirmed,
                               [door.door]: (e.target as HTMLInputElement).checked,
                             };
                           }}
                         />${this.t("technical_confirm")}</label
                       ><button type="submit" ?disabled=${this.busy || !this.confirmed[door.door]}>
                         ${this.t("save")}
                       </button>`
                   : html`<p>${this.t("technical_unmanaged")}</p>`
               }
                          </form>`
                    }
                  </section>`,
              )}
              <details>
                <summary>${this.t("technical_capabilities")}</summary>
                <p>${this.t("technical_capabilities_hint")}</p>
                <ul>
                  ${this.report.features.map((f) => html`<li><bdi>${f.family} · ${f.name}</bdi> ${f.supported ? "✓" : "—"}</li>`)}
                </ul>
              </details>
              <p class="sub"><bdi>${this.report.checked_at}</bdi></p>`
          : nothing
      }
      </details>`;
  }
  private managed(door: number) {
    return this.station?.integrated_locks.some((l) => l.api_id === door) ?? false;
  }
  private change(door: number, key: string, value: string | number | boolean) {
    this.draft = { ...this.draft, [door]: { ...this.draft[door], [key]: value } };
    this.confirmed = { ...this.confirmed, [door]: false };
  }
}
customElements.define("hikvision-station-technical", StationTechnical);
