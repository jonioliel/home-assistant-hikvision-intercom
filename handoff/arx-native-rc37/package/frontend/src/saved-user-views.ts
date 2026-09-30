import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { Hass } from "./types";
import type { ProfileField } from "./profile-settings";
import type { UserFilters } from "./user-filters";
export interface UserView {
  query: string;
  filters: UserFilters;
  columns: string[] | null;
}
interface SavedView {
  id: string;
  name: string;
  value: UserView;
}
function checked(value: unknown): UserView {
  const v = value as UserView;
  if (
    !v ||
    typeof v.query !== "string" ||
    v.query.length > 128 ||
    !v.filters ||
    typeof v.filters !== "object" ||
    Array.isArray(v.filters)
  )
    throw Error();
  const choices = {
    rights: ["", "assigned", "unassigned", "disabled"],
    state: ["", "active", "inactive", "expired", "upcoming"],
    credential: ["", "pin", "no_pin", "card", "no_card"],
    sort: ["employee", "name", "name_desc"],
  };
  for (const [key, options] of Object.entries(choices))
    if (!options.includes(v.filters[key as "rights" | "state" | "credential" | "sort"]))
      throw Error();
  if (typeof v.filters.station !== "string" || v.filters.station.length > 128) throw Error();
  if (
    v.filters.group !== undefined &&
    (typeof v.filters.group !== "string" || v.filters.group.length > 48)
  )
    throw Error();
  const profile = v.filters.profile ?? {};
  if (
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    Object.keys(profile).length > 12 ||
    Object.entries(profile).some(
      ([k, x]) => !/^[a-z][a-z0-9_]{0,47}$/.test(k) || typeof x !== "string" || x.length > 100,
    )
  )
    throw Error();
  if (
    v.columns !== null &&
    (!Array.isArray(v.columns) ||
      v.columns.length > 12 ||
      new Set(v.columns).size !== v.columns.length ||
      v.columns.some((id) => typeof id !== "string" || !/^[a-z][a-z0-9_]{0,47}$/.test(id)))
  )
    throw Error();
  return {
    query: v.query,
    filters: {
      station: v.filters.station,
      rights: v.filters.rights,
      state: v.filters.state,
      credential: v.filters.credential,
      sort: v.filters.sort,
      group: v.filters.group,
      profile: { ...profile },
    },
    columns: v.columns === null ? null : [...v.columns],
  };
}
export class SavedUserViews extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
        margin-block: 10px;
      }
      .columns {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .column {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .column button {
        padding: 5px;
        min-width: 36px;
      }
      .row {
        flex-wrap: wrap;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    value: { attribute: false },
    fields: { attribute: false },
    views: { state: true },
    selected: { state: true },
    name: { state: true },
    error: { state: true },
  };
  hass?: Hass;
  value?: UserView;
  fields: ProfileField[] = [];
  private views: SavedView[] = [];
  private selected = "";
  private name = "";
  private error = "";
  private actor?: string;
  private authorized = false;
  private raw: string | null = null;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private key() {
    return "wiskey:user-views:v1:" + this.actor;
  }
  protected updated(_changes: PropertyValues) {
    if (this.actor !== this.hass?.user?.id || this.authorized !== !!this.hass?.user?.is_admin) {
      this.authorized = !!this.hass?.user?.is_admin;
      this.actor = this.hass?.user?.id;
      this.views = [];
      this.selected = this.name = this.error = "";
      if (this.hass?.user?.is_admin) this.read();
    }
  }
  private read() {
    try {
      this.raw = localStorage.getItem(this.key());
      if (this.raw && this.raw.length > 200000) throw Error();
      const list = this.raw ? JSON.parse(this.raw) : [];
      if (!Array.isArray(list) || list.length > 20) throw Error();
      this.views = list.map((v) => {
        if (
          !v ||
          typeof v.id !== "string" ||
          v.id.length > 64 ||
          typeof v.name !== "string" ||
          !v.name.trim() ||
          v.name.length > 64
        )
          throw Error();
        return { id: v.id, name: v.name, value: checked(v.value) };
      });
    } catch {
      this.views = [];
      this.error = "views_storage_failed";
    }
  }
  private store(views: SavedView[]) {
    if (!this.hass?.user?.is_admin) return false;
    try {
      if (localStorage.getItem(this.key()) !== this.raw) {
        this.read();
        this.error = "views_changed";
        return false;
      }
      const raw = JSON.stringify(views);
      localStorage.setItem(this.key(), raw);
      this.raw = raw;
      this.views = views;
      this.error = "";
      return true;
    } catch {
      this.error = "views_storage_failed";
      return false;
    }
  }
  private save() {
    if (!this.name.trim() || this.name.length > 64 || !this.value) return;
    try {
      const id = this.selected || crypto.randomUUID();
      if (!this.selected && this.views.length >= 20) return;
      const item = { id, name: this.name.trim(), value: checked(this.value) };
      if (this.store([...this.views.filter((v) => v.id !== id), item])) this.selected = id;
    } catch {
      this.error = "views_storage_failed";
    }
  }
  private columns() {
    return this.value?.columns ?? this.fields.filter((f) => f.enabled).map((f) => f.id);
  }
  private setColumns(ids: string[]) {
    this.dispatchEvent(new CustomEvent("columns-change", { detail: ids }));
  }
  private move(id: string, delta: number) {
    const ids = [...this.columns()];
    const index = ids.indexOf(id),
      to = index + delta;
    if (index < 0 || to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    this.setColumns(ids);
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const columns = this.columns();
    const fields = [
      ...columns
        .map((id) => this.fields.find((f) => f.id === id))
        .filter((f): f is ProfileField => !!f && f.enabled),
      ...this.fields.filter((f) => f.enabled && !columns.includes(f.id)),
    ];
    return html`<details>
      <summary>${this.t("views_title")}</summary>
      <p class="sub">${this.t("views_hint")}</p>
      <div class="row">
        <label
          >${this.t("views_choose")}<select
            .value=${this.selected}
            @change=${(e: Event) => {
              this.selected = (e.target as HTMLSelectElement).value;
              this.name = this.views.find((v) => v.id === this.selected)?.name ?? "";
            }}
          >
            <option value="">${this.t("views_new")}</option>
            ${this.views.map((v) => html`<option value=${v.id}>${v.name}</option>`)}
          </select></label
        >
        <button
          type="button"
          ?disabled=${!this.selected}
          @click=${() => {
            const view = this.views.find((v) => v.id === this.selected);
            if (view)
              this.dispatchEvent(
                new CustomEvent("view-load", { detail: structuredClone(view.value) }),
              );
          }}
        >
          ${this.t("views_load")}
        </button>
        <label
          >${this.t("views_name")}<input
            maxlength="64"
            .value=${this.name}
            @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
        /></label>
        <button
          type="button"
          ?disabled=${!this.name.trim() || (!this.selected && this.views.length >= 20)}
          @click=${() => this.save()}
        >
          ${this.t("views_save")}
        </button>
        <button
          type="button"
          ?disabled=${!this.selected}
          @click=${() => {
            if (this.store(this.views.filter((v) => v.id !== this.selected)))
              this.selected = this.name = "";
          }}
        >
          ${this.t("views_delete")}
        </button>
      </div>
      <p>${this.t("views_columns")}</p>
      <div class="columns">
        ${fields.map(
          (f) =>
            html`<div class="column">
              <label class="check"
                ><input
                  type="checkbox"
                  .checked=${columns.includes(f.id)}
                  @change=${(e: Event) => this.setColumns((e.target as HTMLInputElement).checked ? [...columns, f.id] : columns.filter((id) => id !== f.id))}
                />${f.label}</label
              >
              <button
                type="button"
                aria-label=${this.t("views_before") + " " + f.label}
                ?disabled=${!columns.includes(f.id) || columns.indexOf(f.id) === 0}
                @click=${() => this.move(f.id, -1)}
              >
                ↑</button
              ><button
                type="button"
                aria-label=${this.t("views_after") + " " + f.label}
                ?disabled=${!columns.includes(f.id) || columns.indexOf(f.id) === columns.length - 1}
                @click=${() => this.move(f.id, 1)}
              >
                ↓
              </button>
            </div>`,
        )}
      </div>
      <button
        type="button"
        @click=${() => this.setColumns(this.fields.filter((f) => f.enabled).map((f) => f.id))}
      >
        ${this.t("views_all_columns")}
      </button>
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
    </details>`;
  }
}
customElements.define("wiskey-saved-user-views", SavedUserViews);
