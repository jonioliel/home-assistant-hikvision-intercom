import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { icon } from "./icons";
import type { Overview, Station } from "./types";

export type WiskeyDoorFilter = "all" | "online" | "attention";

export interface WiskeyOverviewOptions {
  data: Overview;
  query: string;
  filter: WiskeyDoorFilter;
  page: number;
  capacity: number;
  density: number;
  pending: number;
  canUsers: boolean;
  canCameraWall: boolean;
  canSync: boolean;
  canEvents: boolean;
  canStations: boolean;
  language: string;
  t: (key: string) => string;
  date: (value: string) => string;
  camera: (station: Station) => TemplateResult;
  release: (station: Station) => unknown;
  feedback: (station: Station) => unknown;
  search: (value: string) => void;
  setFilter: (value: WiskeyDoorFilter) => void;
  paginate: (page: number) => void;
  setDensity: (density: number) => void;
  fullscreen: () => void;
  open: (station: Station) => void;
  manage: (station: Station) => void;
  events: () => void;
  addUser: () => void;
  sync: () => void;
  cameraWall: () => void;
}

/** WisKey 04 overview: real HA data and the established command callbacks. */
export function wiskeyOverview(o: WiskeyOverviewOptions) {
  const all = o.data.stations;
  const ringing = all.filter((s) => s.call_state === "ringing" && s.online);
  const attention = all.filter((s) => !s.online || !!s.last_error || s.pending_user_count > 0);
  const matches = all.filter((s) => {
    if (!s.name.toLocaleLowerCase().includes(o.query.trim().toLocaleLowerCase())) return false;
    return (
      o.filter === "all" ||
      (o.filter === "online" && s.online) ||
      (o.filter === "attention" && attention.includes(s))
    );
  });
  const pages = Math.max(1, Math.ceil(matches.length / o.capacity));
  const page = Math.min(o.page, pages - 1);
  const visible = matches.slice(page * o.capacity, (page + 1) * o.capacity);
  const events = o.canEvents
    ? all
        .filter((s) => s.last_access)
        .sort((a, b) => b.last_access!.timestamp.localeCompare(a.last_access!.timestamp))
        .slice(0, 5)
    : [];
  const status = (s: Station) =>
    !s.online ? "offline" : s.call_state === "ringing" ? "ringing" : "online";
  return html`<section class="wk4-overview" data-dense=${visible.length > 8}>
    <div class="wk4-page-head">
      <div>
        <h2>${o.t("wk4_entry_center")}</h2>
        <p class="sub">${o.t("wk4_entry_intro")}</p>
      </div>
      <div class="wk4-head-actions">
        ${o.canCameraWall ? html`<button @click=${o.cameraWall}>${icon("camera")}${o.t("wk4_camera_wall")}</button>` : nothing}
        ${o.canUsers ? html`<button class="primary" @click=${o.addUser}>+${o.t("add_user")}</button>` : nothing}
      </div>
    </div>
    <div class="wk4-stats" aria-label=${o.t("overview")}>
      <div>
        <strong><bdi dir="ltr">${all.filter((s) => s.online).length} / ${all.length}</bdi></strong
        ><span>${o.t("online_stations")}</span>
      </div>
      <div><strong>${o.data.users.length}</strong><span>${o.t("total_users")}</span></div>
      <div><strong>${ringing.length}</strong><span>${o.t("ringing_now")}</span></div>
      ${
        o.canSync
          ? html`<button @click=${o.sync}>
              <strong>${o.pending}</strong><span>${o.t("pending_sync")}</span>
            </button>`
          : html`<div><strong>${o.pending}</strong><span>${o.t("pending_sync")}</span></div>`
      }
      <hikvision-live-clock
        .language=${o.language}
        .zone=${o.data.default_zone}
      ></hikvision-live-clock>
    </div>
    <div class="wk4-overview-layout">
      <div class="wk4-overview-main">
        <div class="wk4-overview-toolbar">
          <input
            type="search"
            aria-label=${o.t("wall_search")}
            placeholder=${o.t("wall_search")}
            .value=${o.query}
            @input=${(e: Event) => o.search((e.target as HTMLInputElement).value)}
          />
          <div class="wk4-filters" aria-label=${o.t("wk4_door_filter")}>
            ${(["all", "online", "attention"] as const).map(
              (filter) =>
                html`<button
                  aria-pressed=${o.filter === filter}
                  @click=${() => o.setFilter(filter)}
                >
                  ${o.t("wk4_filter_" + filter)}
                </button>`,
            )}
          </div>
          <label class="wk4-density"
            >${o.t("wall_density")}
            <select
              aria-label=${o.t("wall_density")}
              .value=${String(o.density)}
              @change=${(e: Event) => o.setDensity(Number((e.target as HTMLSelectElement).value))}
            >
              ${[0, 4, 6, 9, 12].map((n) => html`<option value=${n}>${n || o.t("wall_auto")}</option>`)}
            </select>
          </label>
          <button
            class="wk4-fullscreen"
            @click=${o.fullscreen}
            aria-label=${o.t("wall_fullscreen")}
          >
            ${icon("fullscreen")}<span>${o.t("wall_fullscreen")}</span>
          </button>
          <span class="wk4-count">${matches.length} ${o.t("devices")}</span>
        </div>
        <div class="wk4-door-grid">
          ${repeat(
            visible,
            (s) => s.id,
            (s) =>
              html` <article class="wk4-door ${status(s)}">
                <div class="wk4-door-image">
                  ${s.online ? o.camera(s) : html`<div class="wk4-door-offline">${icon("camera")}${o.t("offline")}</div>`}
                  ${s.call_state === "ringing" ? html`<span class="wk4-ring" role="status">${o.t("ringing")}</span>` : nothing}
                  <button
                    class="wk4-open-camera"
                    aria-label=${o.t("enlarge") + " · " + s.name}
                    ?disabled=${!s.entities.camera}
                    @click=${() => o.open(s)}
                  >
                    ${icon("camera")}<span>${o.t("camera")}</span>
                  </button>
                </div>
                <div class="wk4-door-info">
                  <button
                    class="wk4-door-name"
                    @click=${() => o.manage(s)}
                    ?disabled=${!o.canStations}
                    title=${s.name}
                  >
                    ${s.name}
                  </button>
                  <span class="wk4-state ${status(s)}">${o.t(status(s))}</span>
                  <small
                    >${
                      !s.online && s.last_seen
                        ? o.t("last_seen") + ": " + o.date(s.last_seen)
                        : s.pending_user_count
                          ? o.t("pending_users") + ": " + s.pending_user_count
                          : o.t("access_by_permissions")
                    }</small
                  >
                </div>
                <div class="wk4-door-actions">
                  ${s.lock_enabled ? o.release(s) : html`<span class="sub">${o.t("camera_only")}</span>`}
                  <button
                    class="wk4-more"
                    aria-label=${o.t("station_details") + " · " + s.name}
                    ?disabled=${!o.canStations}
                    @click=${() => o.manage(s)}
                  >
                    ⋯
                  </button>
                </div>
                ${o.feedback(s)}
              </article>`,
          )}
        </div>
        ${!matches.length ? html`<p class="empty">${o.t(all.length ? "no_results" : "no_stations")}</p>` : nothing}
        <div class="wk4-grid-foot">
          <span>${o.t("wall_preview_hint")}</span>
          ${
            pages > 1
              ? html`<div class="wk4-pager">
                  <button ?disabled=${page === 0} @click=${() => o.paginate(page - 1)}>
                    ${o.t("wall_previous")}
                  </button>
                  <span role="status">${page + 1} / ${pages}</span>
                  <button ?disabled=${page + 1 >= pages} @click=${() => o.paginate(page + 1)}>
                    ${o.t("wall_next")}
                  </button>
                </div>`
              : nothing
          }
        </div>
      </div>
      <aside class="wk4-overview-side">
        <section class="wk4-side-card">
          <div class="wk4-side-head">
            <h3>${o.t("access_recent_activity")}</h3>
            ${o.canEvents ? html`<button @click=${o.events}>${o.t("all")} ›</button>` : nothing}
          </div>
          ${
            events.length
              ? events.map(
                  (s) =>
                    html`<div class="wk4-event">
                      <strong>${s.last_access!.person_name || o.t("unknown")}</strong>
                      <small>${s.name} · ${o.t(s.last_access!.authentication)}</small>
                      <time>${o.date(s.last_access!.timestamp)}</time>
                    </div>`,
                )
              : html`<p class="sub">${o.t("no_events")}</p>`
          }
        </section>
        ${
          attention.length
            ? html`<section class="wk4-side-card">
                <div class="wk4-side-head">
                  <h3>${o.t("access_attention")}</h3>
                  <span>${attention.length}</span>
                </div>
                ${attention
                  .slice(0, 5)
                  .map(
                    (s) =>
                      html`<button
                        class="wk4-attention"
                        @click=${() => o.manage(s)}
                        ?disabled=${!o.canStations}
                      >
                        <strong>${s.name}</strong
                        ><small
                          >${!s.online ? o.t("offline") : s.last_error || o.t("pending_sync")}</small
                        >
                      </button>`,
                  )}
              </section>`
            : nothing
        }
      </aside>
    </div>
  </section>`;
}
