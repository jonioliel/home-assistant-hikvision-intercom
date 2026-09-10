import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import "./camera";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";
import type { MediaPolicy } from "./media-settings";

export class CameraWall extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      .wall {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .wall.nine {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .tile {
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        padding: 8px;
        min-width: 0;
      }
      .tile h3 {
        margin: 4px 0 10px;
        font-size: 16px;
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 12px 0;
      }
      @media (max-width: 1000px) {
        .wall.nine {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 600px) {
        .wall,
        .wall.nine {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    media: { attribute: false },
    version: { type: String },
    suspended: { type: Boolean },
    active: { state: true },
    limit: { state: true },
    selected: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  media?: MediaPolicy | null;
  version = "";
  suspended = false;
  private active = false;
  private limit = 4;
  private selected: string[] = [];
  private actor?: string;
  private authorized = false;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changes: PropertyValues) {
    if (this.actor !== this.hass?.user?.id || this.authorized !== !!this.hass?.user?.is_admin) {
      this.authorized = !!this.hass?.user?.is_admin;
      this.active = false;
      this.limit = 4;
      this.selected = this.stations
        .filter((s) => s.entities.camera)
        .slice(0, 4)
        .map((s) => s.id);
      this.actor = this.hass?.user?.id;
    }
    if (changes.has("stations"))
      this.selected = this.selected.filter((id) =>
        this.stations.some((s) => s.id === id && s.entities.camera),
      );
  }
  disconnectedCallback() {
    this.active = false;
    super.disconnectedCallback();
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const stations = this.selected
      .slice(0, this.limit)
      .map((id) => this.stations.find((s) => s.id === id))
      .filter((s): s is Station => !!s);
    return html`<h2>${this.t("camera_wall")}</h2>
      <p>${this.t("camera_wall_hint")}</p>
      <div class="row">
        <label
          >${this.t("camera_wall_budget")}<select
            .value=${String(this.limit)}
            @change=${(e: Event) => {
              this.limit = Number((e.target as HTMLSelectElement).value);
              this.selected = this.selected.slice(0, this.limit);
            }}
          >
            <option value="4">4</option>
            <option value="9">9</option>
          </select></label
        >
        <button
          class="primary"
          ?disabled=${!stations.length || this.suspended}
          @click=${() => (this.active = !this.active)}
        >
          ${this.t(this.active ? "camera_wall_stop" : "camera_wall_start")}
        </button>
        <span>${this.t("camera_wall_selected")}: ${stations.length} / ${this.limit}</span>
      </div>
      <details>
        <summary>${this.t("camera_wall_choose")}</summary>
        <div class="choices">
          ${this.stations.filter((s) => s.entities.camera).map((s) => html`<label class="check"><input type="checkbox" .checked=${this.selected.includes(s.id)} ?disabled=${!this.selected.includes(s.id) && this.selected.length >= this.limit} @change=${(e: Event) => (this.selected = (e.target as HTMLInputElement).checked ? [...this.selected, s.id] : this.selected.filter((id) => id !== s.id))} />${s.name}</label>`)}
        </div>
      </details>
      <div class=${this.limit === 9 ? "wall nine" : "wall"}>
        ${repeat(
          stations,
          (s) => s.id,
          (s) =>
            html`<article class="tile">
              <h3>${s.name} · ${this.t(s.online ? "online" : "offline")}</h3>
              <hikvision-intercom-camera
                .hass=${this.hass}
                .entity=${s.entities.camera}
                .stationId=${s.id}
                .media=${this.media}
                .version=${this.version}
                .live=${this.active && !this.suspended}
                .label=${s.name}
              ></hikvision-intercom-camera>
              <button
                @click=${() => this.dispatchEvent(new CustomEvent("open-station", { detail: s.id }))}
              >
                ${this.t("enlarge")}
              </button>
            </article>`,
        )}
      </div>`;
  }
}
customElements.define("wiskey-camera-wall", CameraWall);
