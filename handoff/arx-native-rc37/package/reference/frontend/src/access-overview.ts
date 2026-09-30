import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { icon } from "./icons";
import type { Overview, Station } from "./types";

export interface AccessOverviewOptions {
  data: Overview;
  query: string;
  page: number;
  capacity: number;
  selected: string;
  language: string;
  canEvents: boolean;
  canStations: boolean;
  t: (key: string) => string;
  date: (value: string) => string;
  camera: (station: Station) => TemplateResult;
  release: (station: Station) => unknown;
  feedback: (station: Station) => unknown;
  search: (value: string) => void;
  paginate: (page: number) => void;
  select: (station: Station) => void;
  open: (station: Station) => void;
  manage: (station: Station) => void;
  events: () => void;
}

/** Uses real overview data and existing media/release handlers, never inferred door state. */
export function accessOverview(o: AccessOverviewOptions) {
  const t = o.t;
  const stations = o.data.stations.filter((s) =>
    s.name.toLocaleLowerCase().includes(o.query.trim().toLocaleLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(stations.length / o.capacity));
  const page = Math.min(o.page, pageCount - 1);
  const selected = stations.find((s) => s.id === o.selected) ?? stations[0];
  const rings = o.data.stations.filter((s) => s.call_state === "ringing" && s.online);
  const attention = o.data.stations.filter(
    (s) => !s.online || s.last_error || s.pending_user_count,
  );
  const events = o.canEvents
    ? o.data.stations
        .filter((s) => s.last_access)
        .sort((a, b) => b.last_access!.timestamp.localeCompare(a.last_access!.timestamp))
        .slice(0, 5)
    : [];
  const status = (s: Station) =>
    s.online ? (s.call_state === "ringing" ? "ringing" : "online") : "offline";
  return html`<section class="access-overview">
    <div class="access-page-heading">
      <div>
        <span class="access-eyebrow">WisKey Access</span>
        <h2>${t("overview_heading")}</h2>
      </div>
      <div class="access-inline-stats">
        <span
          ><i class="access-dot"></i
          >${o.data.stations.filter((s) => s.online).length}/${o.data.stations.length}
          ${t("online_stations")}</span
        ><span>${rings.length} ${t("ringing_now")}</span>
      </div>
      <hikvision-live-clock
        .language=${o.language}
        .zone=${o.data.default_zone}
      ></hikvision-live-clock>
    </div>
    <div class="access-dashboard">
      <section class="access-door-section">
        <div class="access-section-bar">
          <h3>${t("devices")} <span class="access-count">${stations.length}</span></h3>
          <input
            type="search"
            aria-label=${t("wall_search")}
            placeholder=${t("wall_search")}
            .value=${o.query}
            @input=${(e: Event) => o.search((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="access-doors">
          ${repeat(
            stations.slice(page * o.capacity, (page + 1) * o.capacity),
            (s) => s.id,
            (s) =>
              html`<article
                class="access-door ${status(s)}"
                data-station=${s.id}
                data-selected=${selected?.id === s.id}
              >
                <button
                  class="access-door-heading"
                  @click=${() => o.select(s)}
                  aria-pressed=${selected?.id === s.id}
                >
                  <strong title=${s.name}>${s.name}</strong
                  ><span class="access-status ${status(s)}"><i></i>${t(status(s))}</span>
                </button>
                <div class="access-door-body">
                  <button
                    class="access-door-camera"
                    aria-label=${`${t("enlarge")} · ${s.name}`}
                    ?disabled=${!s.online || !s.entities.camera}
                    @click=${() => o.open(s)}
                  >
                    ${s.online ? o.camera(s) : icon("camera")}
                  </button>
                  <div class="access-door-context">
                    <span>${t(s.lock_enabled ? "lock_enabled" : "camera_only")}</span
                    ><small
                      >${t(s.sync_state || "unknown")}${s.pending_user_count ? html` · ${s.pending_user_count}` : nothing}</small
                    >
                  </div>
                </div>
                <div class="access-door-actions">
                  ${s.lock_enabled ? o.release(s) : html`<span class="sub">${t("camera_only")}</span>`}
                </div>
                ${o.feedback(s)}
              </article>`,
          )}
        </div>
        ${stations.length ? nothing : html`<p class="empty">${t("no_stations")}</p>`}
        ${pageCount > 1 ? html`<div class="access-pagination"><button ?disabled=${!page} @click=${() => o.paginate(page - 1)}>${t("wall_previous")}</button><span>${page + 1} / ${pageCount}</span><button ?disabled=${page + 1 >= pageCount} @click=${() => o.paginate(page + 1)}>${t("wall_next")}</button></div>` : nothing}
        ${
          events.length
            ? html`<section class="access-activity">
                <div class="access-section-bar">
                  <h3>${t("access_recent_activity")}</h3>
                  <button class="quiet" @click=${o.events}>${t("events")}${icon("arrow")}</button>
                </div>
                ${events.map((s) => html`<div class="access-activity-row"><span>${icon("events")}</span><strong>${s.last_access!.person_name || t("unknown")}</strong><span>${s.name}</span><span class="sub">${t(s.last_access!.authentication)}</span><time>${o.date(s.last_access!.timestamp)}</time></div>`)}
              </section>`
            : nothing
        }
      </section>
      <aside class="access-context">
        ${rings.map(
          (s) =>
            html`<section class="access-incoming">
              <span class="access-eyebrow">${t("ringing")}</span>
              <h3>${s.name}</h3>
              <button class="primary" @click=${() => o.open(s)}>
                ${icon("camera")}${t("enlarge")}
              </button>
            </section>`,
        )}
        ${
          selected
            ? html`<section class="access-context-card">
                <div class="access-section-bar">
                  <h3>${selected.name}</h3>
                  <span class="access-status ${status(selected)}"
                    ><i></i>${t(status(selected))}</span
                  >
                </div>
                <div class="access-context-camera">
                  ${selected.online ? o.camera(selected) : html`<div class="access-no-camera">${icon("camera")}${t("offline")}</div>`}
                </div>
                <dl>
                  <div>
                    <dt>${t("last_seen")}</dt>
                    <dd>${selected.last_seen ? o.date(selected.last_seen) : "—"}</dd>
                  </div>
                  <div>
                    <dt>${t("pending_users")}</dt>
                    <dd>${selected.pending_user_count}</dd>
                  </div>
                  <div>
                    <dt>${t("managed_users")}</dt>
                    <dd>${selected.managed_user_count ?? "—"}</dd>
                  </div>
                </dl>
                <div class="access-context-actions">
                  <button
                    ?disabled=${!selected.online || !selected.entities.camera}
                    @click=${() => o.open(selected)}
                  >
                    ${icon("camera")}${t("enlarge")}</button
                  >${o.canStations ? html`<button @click=${() => o.manage(selected)}>${icon("tools")}${t("station_details")}</button>` : nothing}
                </div>
              </section>`
            : nothing
        }
        ${
          attention.length
            ? html`<section class="access-attention">
                <h3>${t("access_attention")}</h3>
                ${attention.slice(0, 4).map((s) => html`<button @click=${() => o.select(s)}><strong>${s.name}</strong><span class="access-status ${s.online ? "pending" : "offline"}">${t(!s.online ? "offline" : s.last_error || "pending_sync")}</span></button>`)}
              </section>`
            : nothing
        }
      </aside>
    </div>
  </section>`;
}
