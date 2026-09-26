import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import "./camera";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";
import type { MediaPolicy } from "./media-settings";

interface CameraLayout {
  id: string;
  name: string;
  limit: number;
  stations: string[];
}

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
    layouts: { state: true },
    layoutId: { state: true },
    layoutName: { state: true },
    layoutError: { state: true },
    active: { state: true },
    limit: { state: true },
    selected: { state: true },
  };
  hass?: Hass;
  stations: Station[] = [];
  media?: MediaPolicy | null;
  version = "";
  suspended = false;
  private layouts: CameraLayout[] = [];
  private layoutId = "";
  private layoutName = "";
  private layoutError = "";
  private layoutRaw: string | null = null;
  private storageReady = false;
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
      this.layouts = [];
      this.layoutId = this.layoutName = this.layoutError = "";
      this.storageReady = false;
      if (this.authorized && this.actor) this.readLayouts();
    }
    if (changes.has("stations"))
      this.selected = this.selected.filter((id) =>
        this.stations.some((s) => s.id === id && s.entities.camera),
      );
  }
  private layoutKey() {
    return "wiskey:camera-layouts:v1:" + this.actor;
  }
  private readLayouts() {
    this.storageReady = false;
    this.layouts = [];
    this.layoutId = this.layoutName = "";
    try {
      this.layoutRaw = localStorage.getItem(this.layoutKey());
      if (this.layoutRaw && this.layoutRaw.length > 50000) throw Error();
      const rows = this.layoutRaw ? JSON.parse(this.layoutRaw) : [];
      const text = (s: unknown, max: number): s is string =>
        typeof s === "string" && !!s.trim() && s.length <= max && !/[\u0000-\u001f]/.test(s);
      if (!Array.isArray(rows) || rows.length > 20) throw Error();
      for (const row of rows) {
        if (
          !row ||
          !text(row.id, 64) ||
          !text(row.name, 64) ||
          ![4, 9].includes(row.limit) ||
          !Array.isArray(row.stations) ||
          row.stations.length > row.limit ||
          row.stations.some((id: unknown) => !text(id, 128)) ||
          new Set(row.stations).size !== row.stations.length
        )
          throw Error();
      }
      if (new Set(rows.map((row: CameraLayout) => row.id)).size !== rows.length) throw Error();
      this.layouts = rows.map((row: CameraLayout) => ({
        id: row.id,
        name: row.name,
        limit: row.limit,
        stations: [...row.stations],
      }));
      this.storageReady = true;
      this.layoutError = "";
    } catch {
      this.layoutError = "views_storage_failed";
    }
  }
  private writeLayouts(rows: CameraLayout[]) {
    if (
      !this.hass?.user?.is_admin ||
      this.hass.user.id !== this.actor ||
      !this.actor ||
      !this.storageReady
    )
      return false;
    try {
      if (localStorage.getItem(this.layoutKey()) !== this.layoutRaw) {
        this.readLayouts();
        this.layoutError = "views_changed";
        return false;
      }
      const raw = JSON.stringify(rows);
      localStorage.setItem(this.layoutKey(), raw);
      this.layoutRaw = raw;
      this.layouts = rows;
      this.layoutError = "";
      return true;
    } catch {
      this.layoutError = "views_storage_failed";
      return false;
    }
  }
  private saveLayout() {
    const name = this.layoutName.trim();
    if (
      !name ||
      name.length > 64 ||
      /[\u0000-\u001f]/.test(name) ||
      !this.selected.length ||
      (!this.layoutId && this.layouts.length >= 20)
    )
      return;
    const id = this.layoutId || crypto.randomUUID();
    const row = { id, name, limit: this.limit, stations: [...this.selected.slice(0, this.limit)] };
    if (this.writeLayouts([...this.layouts.filter((v) => v.id !== id), row])) this.layoutId = id;
  }
  private loadLayout() {
    const layout = this.layouts.find((v) => v.id === this.layoutId);
    if (!layout) return;
    // Loading a preset always stops live playback, even when replacing an active wall.
    this.active = false;
    this.limit = layout.limit;
    this.selected = layout.stations.filter((id) =>
      this.stations.some((s) => s.id === id && s.entities.camera),
    );
    this.layoutError = this.selected.length === layout.stations.length ? "" : "wall_layout_missing";
  }
  private savedLayouts() {
    return html`<details class="saved-layouts">
      <summary>${this.t("wall_layouts")}</summary>
      <p class="sub">${this.t("wall_layout_hint")}</p>
      <div class="row">
        <label
          >${this.t("wall_layout_choose")}<select
            .value=${this.layoutId}
            @change=${(e: Event) => {
              this.layoutId = (e.target as HTMLSelectElement).value;
              this.layoutName = this.layouts.find((v) => v.id === this.layoutId)?.name ?? "";
            }}
          >
            <option value="">${this.t("views_new")}</option>
            ${this.layouts.map((v) => html`<option value=${v.id}>${v.name}</option>`)}
          </select></label
        >
        <button ?disabled=${!this.layoutId} @click=${() => this.loadLayout()}>
          ${this.t("wall_layout_load")}
        </button>
        <label
          >${this.t("wall_layout_name")}<input
            maxlength="64"
            .value=${this.layoutName}
            @input=${(e: Event) => (this.layoutName = (e.target as HTMLInputElement).value)}
        /></label>
        <button
          ?disabled=${!this.storageReady || !this.layoutName.trim() || !this.selected.length || (!this.layoutId && this.layouts.length >= 20)}
          @click=${() => this.saveLayout()}
        >
          ${this.t("wall_layout_save")}
        </button>
        <button
          ?disabled=${!this.layoutId || !this.storageReady}
          @click=${() => {
            if (this.writeLayouts(this.layouts.filter((v) => v.id !== this.layoutId)))
              this.layoutId = this.layoutName = "";
          }}
        >
          ${this.t("wall_layout_delete")}
        </button>
        <button @click=${() => this.readLayouts()}>${this.t("wall_layout_reload")}</button>
      </div>
      ${this.layoutError ? html`<p role="alert">${this.t(this.layoutError)}</p>` : nothing}
    </details>`;
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
      ${this.savedLayouts()}
      <details class="camera-choices">
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
              <h3>${s.name} ֲ· ${this.t(s.online ? "online" : "offline")}</h3>
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
