import { LitElement, html, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { styles } from "./styles";
import { translate } from "./i18n";
import type {
  Hass,
  Overview,
  Person,
  Station,
  Draft,
  Card,
  Inventory,
  Review,
  Assignment,
} from "./types";
import "./camera";
import "./events";

const settingsPath = "/config/integrations/integration/hikvision_intercom";
const value = (event: Event) => (event.target as HTMLInputElement).value;
const checked = (event: Event) => (event.target as HTMLInputElement).checked;
const localTime = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export class IntercomManagerPanel extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    _data: { state: true },
    _tab: { state: true },
    _query: { state: true },
    _dialog: { state: true },
    _busy: { state: true },
    _notice: { state: true },
    _error: { state: true },
    _importRows: { state: true },
    _review: { state: true },
  };
  hass?: Hass;
  narrow = false;
  private _data?: Overview;
  private _tab = "overview";
  private _query = "";
  private _dialog = "";
  private _busy = false;
  private _notice = "";
  private _error = "";
  private _draft?: Draft;
  private _importRows: Inventory[] = [];
  private _importStation = "";
  private _review?: Review;
  private _reviewUser = "";
  private _reviewStation = "";
  private _cameraStation?: Station;
  private _unsubscribe?: () => void;
  private _connecting = false;
  private _epoch = 0;
  private _refreshing = false;
  private _refreshAgain = false;
  private _timer?: ReturnType<typeof setInterval>;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  connectedCallback() {
    super.connectedCallback();
    this._timer = setInterval(() => {
      if (!document.hidden && this.hass?.user?.is_admin) void this.refresh();
    }, 30000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._epoch++;
    clearInterval(this._timer);
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._connecting = false;
    this.renderRoot
      .querySelectorAll<HTMLInputElement>('input[type="password"]')
      .forEach((input) => {
        input.value = "";
      });
    this._draft = undefined;
    this._dialog = "";
    this._data = undefined;
  }
  protected updated(changed: PropertyValues) {
    if (changed.has("hass")) {
      if (this.hass?.user?.is_admin) {
        if (this._data) {
          let changedState = false;
          const stations = this._data.stations.map((station) => {
            const onlineEntity = this.hass?.states[station.entities.online];
            const callEntity = this.hass?.states[station.entities.call_status];
            const online = onlineEntity ? onlineEntity.state === "on" : station.online;
            const call_state = online ? (callEntity?.state ?? station.call_state) : "unavailable";
            if (online !== station.online || call_state !== station.call_state) {
              changedState = true;
              return { ...station, online, call_state };
            }
            return station;
          });
          if (changedState) this._data = { ...this._data, stations };
        }
        void this.connect();
      } else {
        this._epoch++;
        this._unsubscribe?.();
        this._unsubscribe = undefined;
        this._draft = undefined;
        this._data = undefined;
        this._dialog = "";
      }
    }
    const dialog = this.renderRoot.querySelector("dialog");
    if (dialog && !dialog.open) dialog.showModal();
  }
  private async connect() {
    if (this._unsubscribe || this._connecting || !this.isConnected) return;
    this._connecting = true;
    const epoch = this._epoch;
    try {
      const unsub = await this.hass!.connection.subscribeMessage(
        () => {
          void this.refresh();
        },
        { type: "hikvision_intercom/subscribe" },
      );
      if (epoch !== this._epoch || !this.isConnected) {
        unsub();
        return;
      }
      this._unsubscribe = unsub;
      await this.refresh();
    } catch {
      this._error = this.t("failed");
    } finally {
      this._connecting = false;
    }
  }
  private api<T>(command: string, data: Record<string, unknown> = {}): Promise<T> {
    return this.hass!.callWS<T>({ type: `hikvision_intercom/${command}`, ...data });
  }
  private async refresh() {
    if (this._refreshing) {
      this._refreshAgain = true;
      return;
    }
    this._refreshing = true;
    const epoch = this._epoch;
    try {
      do {
        this._refreshAgain = false;
        const data = await this.api<Overview>("overview");
        if (epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin)
          this._data = data;
      } while (this._refreshAgain);
    } catch {
      this._error = this.t("failed");
    } finally {
      this._refreshing = false;
    }
  }
  private errorText(error: unknown) {
    const key = (error as { code?: string })?.code;
    return key ? this.t(key) : this.t("failed");
  }
  private async run(action: () => Promise<unknown>, message = "queued") {
    if (this._busy) return false;
    this._busy = true;
    this._error = "";
    try {
      await action();
      if (message) this._notice = this.t(message);
      await this.refresh();
      return true;
    } catch (error) {
      this._error = this.errorText(error);
      return false;
    } finally {
      this._busy = false;
    }
  }
  private close() {
    if (this._busy) return;
    this._draft = undefined;
    this._review = undefined;
    this._importRows = [];
    this._cameraStation = undefined;
    this._dialog = "";
    this._error = "";
  }
  private stationName(id: string) {
    return this._data?.stations.find((station) => station.id === id)?.name ?? id;
  }
  private badge(status: string) {
    return html`<span class="status ${status}">${this.t(status)}</span>`;
  }
  private personStatus(user: Person) {
    const values = Object.values(user.assignments).map((item) => item.sync_state ?? "pending");
    return (
      ["conflict", "error", "offline", "syncing", "pending"].find((item) =>
        values.includes(item),
      ) ?? (values.length ? "synced" : "inactive")
    );
  }
  private pendingCount() {
    return (
      (this._data?.users.reduce(
        (sum, user) =>
          sum +
          Object.values(user.assignments).filter((item) => item.sync_state !== "synced").length,
        0,
      ) ?? 0) +
      (this._data?.tombstones.reduce(
        (sum, item) => sum + item.targets.filter((id) => !item.confirmed.includes(id)).length,
        0,
      ) ?? 0) +
      (this._data?.revocations.length ?? 0)
    );
  }
  private edit(user?: Person) {
    const number = new Uint32Array(1);
    crypto.getRandomValues(number);
    this._draft = user
      ? { ...structuredClone(user), confirm_pin: "", timed: !!user.valid_from }
      : {
          employee_no: String(100000000 + (number[0] % 900000000)),
          display_name: "",
          active: true,
          pin_configured: false,
          confirm_pin: "",
          cards: [],
          assignments: {},
          identity_locked: false,
          valid_from: null,
          valid_until: null,
          timed: false,
        };
    this._error = "";
    this._dialog = "editor";
  }
  private patchDraft(key: string, newValue: unknown) {
    if (this._draft) (this._draft as unknown as Record<string, unknown>)[key] = newValue;
  }
  private pinBlocked() {
    return Object.entries(this._draft?.assignments ?? {}).some(
      ([key, item]) =>
        item.enabled &&
        this._data?.stations.find((station) => station.id === key)?.capabilities?.pin_writable ===
          false,
    );
  }
  private async save(event: Event) {
    event.preventDefault();
    const draft = this._draft;
    if (!draft || this._busy) return;
    if (draft.pin && draft.pin !== draft.confirm_pin) {
      this._error = this.t("pin_mismatch");
      return;
    }
    if (
      draft.timed &&
      (!draft.valid_from ||
        !draft.valid_until ||
        new Date(draft.valid_from) >= new Date(draft.valid_until))
    ) {
      this._error = this.t("invalid_validity");
      return;
    }
    const data: Record<string, unknown> = {
      employee_no: draft.employee_no,
      display_name: draft.display_name,
      active: draft.active,
      valid_from: draft.timed ? draft.valid_from : null,
      valid_until: draft.timed ? draft.valid_until : null,
      assignments: draft.assignments,
      cards: draft.cards.map((card) => ({
        ...(card.id ? { id: card.id } : { card_no: card.card_no }),
        label: card.label,
        card_type: card.card_type,
        enabled: card.enabled,
      })),
    };
    if (draft.pin !== undefined) data.pin = draft.pin;
    const success = await this.run(
      () =>
        draft.id
          ? this.api("users/update", { user_id: draft.id, revision: draft.revision, data })
          : this.api("users/create", { data }),
      "saved",
    );
    if (success) this.close();
  }
  private async removeUser(user: Person) {
    const targets = new Set([
      ...Object.keys(user.assignments),
      ...(this._data?.revocations
        .filter((item) => item.user_id === user.id)
        .map((item) => item.station_id) ?? []),
    ]);
    if (!confirm(this.t("confirm_delete").replace("{count}", String(targets.size)))) return;
    await this.run(
      () => this.api("users/delete", { user_id: user.id, revision: user.revision }),
      "deleted",
    );
  }
  private async openImport() {
    this._error = "";
    this._importRows = [];
    this._importStation =
      this._data?.stations.find((station) => station.online && station.lock_enabled)?.id ?? "";
    this._dialog = "import";
    if (this._importStation) await this.loadInventory();
  }
  private async loadInventory() {
    this._importRows = [];
    await this.run(async () => {
      this._importRows = await this.api<Inventory[]>("stations/inventory", {
        station_id: this._importStation,
      });
    }, "");
  }
  private async adopt(row: Inventory, remove = false) {
    const central = this._data?.users.find((user) => user.employee_no === row.employee_no);
    if (
      !confirm(
        this.t(remove ? "confirm_unmanaged_delete" : central ? "confirm_map" : "confirm_adopt"),
      )
    )
      return;
    const success = await this.run(
      () =>
        this.api(remove ? "users/delete_unmanaged" : "users/adopt", {
          station_id: this._importStation,
          employee_no: row.employee_no,
          review_token: row.review_token,
          ...(!remove && central ? { user_id: central.id, revision: central.revision } : {}),
        }),
      remove ? "deleted" : "import_done",
    );
    if (success) await this.loadInventory();
  }
  private async inspect(userId: string, stationId: string) {
    this._reviewUser = userId;
    this._reviewStation = stationId;
    this._review = undefined;
    this._dialog = "review";
    await this.run(async () => {
      this._review = await this.api<Review>("conflicts/review", {
        user_id: userId,
        station_id: stationId,
      });
    }, "");
  }
  private async resolve(direction: string) {
    const review = this._review;
    if (!review) return;
    const user = this._data?.users.find((item) => item.id === review.user_id);
    if (
      !confirm(
        this.t(
          review.deletion_pending
            ? "confirm_remove_reviewed"
            : direction === "device"
              ? "confirm_device"
              : "confirm_central",
        ),
      )
    )
      return;
    const success = await this.run(() =>
      this.api(review.deletion_pending ? "conflicts/resolve_deletion" : "conflicts/resolve", {
        station_id: review.station_id,
        user_id: review.user_id,
        review_token: review.review_token,
        ...(!review.deletion_pending ? { revision: user?.revision, direction } : {}),
      }),
    );
    if (success) this.close();
  }
  private async unlock(station: Station) {
    await this.run(
      () => this.api("stations/test_unlock", { station_id: station.id, lock: 1 }),
      "release_sent",
    );
  }
  private camera(station: Station, live = false) {
    return html`<hikvision-intercom-camera
      .hass=${this.hass}
      .entity=${station.entities.camera ?? ""}
      .live=${live}
      .label=${station.entities.camera ? `${this.t("camera")} · ${station.name}` : this.t("no_camera")}
    ></hikvision-intercom-camera>`;
  }
  private userActions(user: Person) {
    return html`<button @click=${() => this.edit(user)} ?disabled=${this._busy}>
        ${this.t("edit")}</button
      ><button
        @click=${() => this.run(() => this.api("users/set_active", { user_id: user.id, revision: user.revision, active: !user.active }), "saved")}
        ?disabled=${this._busy}
      >
        ${this.t(user.active ? "disable" : "enable")}</button
      ><button
        @click=${() => this.run(() => this.api("sync/user", { user_id: user.id }))}
        ?disabled=${this._busy}
      >
        ${this.t("sync_now")}</button
      ><button class="danger" @click=${() => this.removeUser(user)} ?disabled=${this._busy}>
        ${this.t("delete")}
      </button>`;
  }
  private overviewView() {
    const stations = [...(this._data?.stations ?? [])].sort(
      (a, b) => Number(b.call_state === "ringing") - Number(a.call_state === "ringing"),
    );
    return html`<section class="metrics" aria-label=${this.t("overview")}>
        ${[
          [
            `${stations.filter((item) => item.online).length} / ${stations.length}`,
            "online_stations",
          ],
          [stations.filter((item) => item.call_state === "ringing").length, "ringing_now"],
          [this._data?.users.length ?? 0, "total_users"],
          [this.pendingCount(), "pending_sync"],
        ].map(
          ([count, label]) =>
            html`<div class="metric">
              <strong>${count}</strong><span>${this.t(String(label))}</span>
            </div>`,
        )}
      </section>
      ${
        !stations.length
          ? html`<div class="empty">
              <h2>${this.t("no_stations")}</h2>
              <a href=${settingsPath}>${this.t("settings")}</a>
            </div>`
          : html`<div class="grid">
              ${repeat(
                stations,
                (station) => station.id,
                (station) =>
                  html`<article
                    class="station ${station.call_state === "ringing" ? "ringing" : ""}"
                  >
                    <div class="row between">
                      <h3>${station.name}</h3>
                      ${this.badge(station.online ? "online" : "offline")}
                    </div>
                    ${station.call_state === "ringing" ? html`<div class="ring-banner" role="status">◉ ${this.t("ringing")}</div>` : nothing}
                    <div class="camera-wrap">
                      ${this.camera(station)}<button
                        @click=${() => {
                          this._cameraStation = station;
                          this._dialog = "camera";
                        }}
                        ?disabled=${!station.entities.camera}
                      >
                        ${this.t("enlarge")}
                      </button>
                    </div>
                    <div class="row between">
                      <span class="sub">${this.t(station.call_state)}</span
                      >${this.badge(station.sync_state)}
                    </div>
                    ${station.lock_enabled ? html`<div class="row actions"><button class="primary" @click=${() => this.unlock(station)} ?disabled=${!station.online || this._busy}>${this.t("open_door")}</button></div>` : html`<p class="sub">${this.t("camera_only")}</p>`}
                  </article>`,
              )}
            </div>`
      }`;
  }
  private usersView() {
    const users = (this._data?.users ?? []).filter((user) =>
      `${user.display_name} ${user.employee_no}`
        .toLocaleLowerCase()
        .includes(this._query.toLocaleLowerCase()),
    );
    return html`<div class="toolbar">
        <input
          type="search"
          .value=${this._query}
          placeholder=${this.t("search")}
          aria-label=${this.t("search")}
          @input=${(event: Event) => {
            this._query = value(event);
          }}
        /><button @click=${() => this.openImport()} ?disabled=${this._busy}>
          ${this.t("import_existing")}</button
        ><button @click=${() => this.run(() => this.api("sync/all"))} ?disabled=${this._busy}>
          ${this.t("sync_all")}</button
        ><button class="primary" @click=${() => this.edit()} ?disabled=${this._busy}>
          + ${this.t("add_user")}
        </button>
      </div>
      ${
        !users.length
          ? html`<div class="empty">
              <h2>${this.t(this._query ? "no_results" : "no_users")}</h2>
              ${!this._query ? html`<p>${this.t("no_users_detail")}</p>` : nothing}
            </div>`
          : html`<div class="table-wrap desktop-users">
                <table>
                  <thead>
                    <tr>
                      ${["name", "employee_id", "pin", "cards", "assignments", "status", "other"].map((key) => html`<th>${this.t(key)}</th>`)}
                    </tr>
                  </thead>
                  <tbody>
                    ${repeat(
                      users,
                      (user) => user.id,
                      (user) =>
                        html`<tr>
                          <td><strong>${user.display_name}</strong></td>
                          <td><bdi>${user.employee_no}</bdi></td>
                          <td>${this.t(user.pin_configured ? "configured" : "not_configured")}</td>
                          <td>${user.cards.length}</td>
                          <td>
                            ${Object.values(user.assignments).filter((item) => item.enabled).length}
                          </td>
                          <td>
                            ${this.badge(this.personStatus(user))}
                            <div class="sub">${this.t(user.active ? "active" : "inactive")}</div>
                          </td>
                          <td><div class="row">${this.userActions(user)}</div></td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              <div class="mobile-users">
                ${repeat(
                  users,
                  (user) => user.id,
                  (user) =>
                    html`<article class="person">
                      <div class="row between">
                        <h3>${user.display_name}</h3>
                        ${this.badge(this.personStatus(user))}
                      </div>
                      <p class="sub">
                        ${this.t("employee_id")}: <bdi>${user.employee_no}</bdi> ·
                        ${this.t(user.active ? "active" : "inactive")}
                      </p>
                      <p class="sub">
                        ${this.t("pin")}:
                        ${this.t(user.pin_configured ? "configured" : "not_configured")} ·
                        ${this.t("cards")}: ${user.cards.length}
                      </p>
                      <div class="row actions">${this.userActions(user)}</div>
                    </article>`,
                )}
              </div>`
      }`;
  }
  private devicesView() {
    return html`<div class="toolbar">
        <h2>${this.t("devices")}</h2>
        <a href=${settingsPath}>${this.t("settings")}</a>
      </div>
      <div class="grid">
        ${(this._data?.stations ?? []).map(
          (station) =>
            html`<article class="station">
              <div class="row between">
                <h3>${station.name}</h3>
                ${this.badge(station.online ? "online" : "offline")}
              </div>
              <dl>
                ${[
                  ["model", station.model],
                  ["firmware", station.firmware],
                  ["address", station.host],
                  [
                    "last_scan",
                    station.scanned_at
                      ? new Date(station.scanned_at).toLocaleString(this.hass?.language)
                      : "—",
                  ],
                  [
                    "users",
                    `${station.user_count ?? "—"} / ${station.capabilities?.max_users ?? "—"}`,
                  ],
                  [
                    "cards",
                    `${station.card_count ?? "—"} / ${station.capabilities?.max_cards ?? "—"}`,
                  ],
                  ["unmanaged", station.unmanaged_count ?? "—"],
                  [
                    "pin",
                    station.capabilities?.pin_writable
                      ? `${station.capabilities.pin_min}–${station.capabilities.pin_max}`
                      : this.t("pin_mode_blocked"),
                  ],
                ].map(
                  ([label, text]) =>
                    html`<dt>${this.t(String(label))}</dt>
                      <dd><bdi>${text}</bdi></dd>`,
                )}
              </dl>
              <p class="sub">${this.t(station.lock_enabled ? "station_access" : "camera_only")}</p>
              ${station.last_error ? html`<p class="danger">${this.t(station.last_error)}</p>` : nothing}
              <div class="row">
                <button
                  @click=${() => this.run(() => this.api("stations/rescan", { station_id: station.id }))}
                  ?disabled=${this._busy}
                >
                  ${this.t("rescan")}</button
                ><button
                  @click=${() => this.run(() => this.api("sync/station", { station_id: station.id }))}
                  ?disabled=${this._busy}
                >
                  ${this.t("sync_now")}
                </button>
              </div>
            </article>`,
        )}
      </div>`;
  }
  private syncView() {
    const data = this._data!;
    return html`<div class="toolbar">
        <h2>${this.t("sync")}</h2>
        <button
          class="primary"
          @click=${() => this.run(() => this.api("sync/all"))}
          ?disabled=${this._busy}
        >
          ${this.t("sync_all")}
        </button>
      </div>
      ${
        data.users.length && data.stations.length
          ? html`<div class="table-wrap matrix">
              <table>
                <thead>
                  <tr>
                    <th>${this.t("name")}</th>
                    ${data.stations.map((station) => html`<th>${station.name}</th>`)}
                  </tr>
                </thead>
                <tbody>
                  ${data.users.map(
                    (user) =>
                      html`<tr>
                        <td>${user.display_name}</td>
                        ${data.stations.map((station) => {
                          const assignment = user.assignments[station.id];
                          return html`<td>
                            ${assignment ? html`<button @click=${() => this.inspect(user.id, station.id)} ?disabled=${this._busy || !station.online}>${this.badge(assignment.sync_state ?? "pending")}</button>` : html`<span class="sub">—</span>`}
                          </td>`;
                        })}
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
          : html`<div class="empty"><p>${this.t("no_sync")}</p></div>`
      }
      <h2 class="section-title">${this.t("pending_removals")}</h2>
      <div class="box">
        ${!data.tombstones.length && !data.revocations.length && !data.card_removals.length ? html`<p class="sub">${this.t("no_pending_removals")}</p>` : nothing}${data.tombstones.map(
          (item) =>
            html`<div class="removal">
              <strong>${this.t("employee_id")}: <bdi>${item.employee_no}</bdi></strong
              >${item.targets.filter((id) => !item.confirmed.includes(id)).map((id) => html`<div class="row actions"><span>${this.stationName(id)}</span>${this.badge(item.stations?.[id]?.sync_state ?? "delete_pending")}<button @click=${() => this.inspect(item.user_id, id)} ?disabled=${this._busy}>${this.t("inspect")}</button><button @click=${() => this.run(() => this.api("sync/station", { station_id: id }))} ?disabled=${this._busy}>${this.t("sync_now")}</button></div>`)}
            </div>`,
        )}${data.revocations.map((item) => html`<div class="removal row"><span>${data.users.find((user) => user.id === item.user_id)?.display_name} · ${this.stationName(item.station_id)}</span>${this.badge(item.sync_state)}<button @click=${() => this.inspect(item.user_id, item.station_id)} ?disabled=${this._busy}>${this.t("inspect")}</button></div>`)}${data.card_removals.map(
          (item) =>
            html`<p class="sub">
              ${this.t("cards")} ·
              ${data.users.find((user) => user.id === item.user_id)?.display_name ?? "—"} ·
              ${item.targets
                .filter((id) => !item.confirmed.includes(id))
                .map((id) => this.stationName(id))
                .join(", ")}
            </p>`,
        )}
      </div>`;
  }
  private editorBody() {
    const draft = this._draft!;
    const blocked = this.pinBlocked();
    return html`<form id="user-form" @submit=${(event: Event) => this.save(event)}>
      <fieldset>
        <legend>${this.t("users")}</legend>
        <div class="fields">
          <label
            >${this.t("name")}<input
              autofocus
              required
              maxlength="32"
              .value=${draft.display_name}
              @input=${(event: Event) => this.patchDraft("display_name", value(event))} /></label
          ><label
            >${this.t("employee_id")}<input
              required
              pattern="[A-Za-z0-9_-]{1,32}"
              maxlength="32"
              dir="ltr"
              .value=${draft.employee_no}
              ?disabled=${draft.identity_locked}
              @input=${(event: Event) => this.patchDraft("employee_no", value(event))}
          /></label>
        </div>
        ${draft.identity_locked ? html`<p class="field-note">${this.t("employee_locked")}</p>` : nothing}
        <p>
          <label class="check"
            ><input
              type="checkbox"
              .checked=${draft.active}
              @change=${(event: Event) => this.patchDraft("active", checked(event))}
            />${this.t("active")}</label
          >
        </p>
      </fieldset>
      <fieldset>
        <legend>${this.t("validity")}</legend>
        <label class="check"
          ><input
            type="checkbox"
            .checked=${draft.timed}
            @change=${(event: Event) => {
              draft.timed = checked(event);
              this.requestUpdate();
            }}
          />${this.t("period")}</label
        >${
          draft.timed
            ? html`<div class="fields" style="margin-top:14px">
                  <label
                    >${this.t("valid_from")}<input
                      required
                      type="datetime-local"
                      .value=${localTime(draft.valid_from)}
                      @input=${(event: Event) => this.patchDraft("valid_from", value(event) ? new Date(value(event)).toISOString() : null)} /></label
                  ><label
                    >${this.t("valid_until")}<input
                      required
                      type="datetime-local"
                      .value=${localTime(draft.valid_until)}
                      @input=${(event: Event) => this.patchDraft("valid_until", value(event) ? new Date(value(event)).toISOString() : null)}
                  /></label>
                </div>
                <p class="field-note">${this.t("validity_hint")}</p>`
            : html`<p class="sub">${this.t("permanent")}</p>`
        }
      </fieldset>
      <fieldset>
        <legend>
          ${this.t("pin")} · ${this.t(draft.pin_configured ? "configured" : "not_configured")}
        </legend>
        <p class="field-note">${this.t("pin_private")}</p>
        ${blocked ? html`<p class="danger">${this.t("pin_mode_blocked")}</p>` : nothing}
        <div class="fields">
          <label
            >${this.t("new_pin")}<input
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              pattern="[0-9]*"
              maxlength="128"
              .value=${draft.pin ?? ""}
              ?disabled=${blocked || draft.pin === null}
              @input=${(event: Event) => this.patchDraft("pin", value(event) || undefined)} /></label
          ><label
            >${this.t("confirm_pin")}<input
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              pattern="[0-9]*"
              maxlength="128"
              .value=${draft.confirm_pin}
              ?disabled=${blocked || draft.pin === null}
              @input=${(event: Event) => this.patchDraft("confirm_pin", value(event))}
          /></label>
        </div>
        <div class="row actions">
          ${
            draft.pin === null
              ? html`<span class="status delete_pending">${this.t("remove_pin")}</span
                  ><button
                    type="button"
                    @click=${() => {
                      draft.pin = undefined;
                      this.requestUpdate();
                    }}
                  >
                    ${this.t("keep_pin")}
                  </button>`
              : html`<button
                  type="button"
                  class="danger"
                  ?disabled=${blocked || !draft.pin_configured}
                  @click=${() => {
                    draft.pin = null;
                    draft.confirm_pin = "";
                    this.requestUpdate();
                  }}
                >
                  ${this.t("remove_pin")}
                </button>`
          }
        </div>
        <p class="field-note">${this.t("pin_physical")}</p>
      </fieldset>
      <fieldset>
        <legend>${this.t("cards")}</legend>
        ${repeat(
          draft.cards,
          (card) => card.id ?? card,
          (card) =>
            html`<div class="card-edit">
              <div class="fields">
                <label
                  >${this.t("card_label")}<input
                    maxlength="64"
                    .value=${card.label}
                    @input=${(event: Event) => {
                      card.label = value(event);
                    }} /></label
                >${
                  card.id
                    ? html`<label
                        >${this.t("card_number")}<input
                          readonly
                          .value=${card.masked_number ?? this.t("masked")}
                          aria-label=${this.t("masked")}
                      /></label>`
                    : html`<label
                        >${this.t("card_number")}<input
                          required
                          pattern="[A-Za-z0-9_-]+"
                          maxlength="32"
                          dir="ltr"
                          autocomplete="off"
                          .value=${card.card_no ?? ""}
                          @input=${(event: Event) => {
                            card.card_no = value(event);
                          }}
                      /></label>`
                }
              </div>
              <div class="row between">
                <label class="check"
                  ><input
                    type="checkbox"
                    .checked=${card.enabled}
                    @change=${(event: Event) => {
                      card.enabled = checked(event);
                    }}
                  />${this.t("active")} · ${this.t("normal_card")}</label
                ><button
                  type="button"
                  class="danger"
                  @click=${() => {
                    draft.cards = draft.cards.filter((item) => item !== card);
                    this.requestUpdate();
                  }}
                >
                  ${this.t("remove")}
                </button>
              </div>
            </div>`,
        )}<button
          type="button"
          @click=${() => {
            draft.cards = [
              ...draft.cards,
              { label: "", card_no: "", card_type: "normalCard", enabled: true },
            ];
            this.requestUpdate();
          }}
        >
          + ${this.t("add_card")}
        </button>
      </fieldset>
      <fieldset>
        <legend>${this.t("assignments")}</legend>
        ${(this._data?.stations ?? []).map(
          (station) =>
            html`<div class="assignment">
              <label class="check"
                ><input
                  type="checkbox"
                  .checked=${!!draft.assignments[station.id]?.enabled}
                  ?disabled=${!station.lock_enabled}
                  @change=${(event: Event) => {
                    if (checked(event))
                      draft.assignments[station.id] = { enabled: true, allowed_locks: [1] };
                    else delete draft.assignments[station.id];
                    this.requestUpdate();
                  }}
                /><strong>${station.name}</strong
                >${this.badge(station.online ? "online" : "offline")}</label
              ><small>${this.t(station.lock_enabled ? "station_access" : "camera_only")}</small>
            </div>`,
        )}
        <p class="field-note">${this.t("unsupported_schedule")}</p>
      </fieldset>
    </form>`;
  }
  private importBody() {
    return html`<p class="field-note">${this.t("import_hint")}</p>
      <div class="toolbar">
        <label style="flex:1"
          >${this.t("select_station")}<select
            .value=${this._importStation}
            @change=${(event: Event) => {
              this._importStation = value(event);
              void this.loadInventory();
            }}
            ?disabled=${this._busy}
          >
            <option value="">—</option>
            ${(this._data?.stations ?? []).filter((station) => station.lock_enabled).map((station) => html`<option value=${station.id}>${station.name}</option>`)}
          </select></label
        ><button
          @click=${() => this.loadInventory()}
          ?disabled=${this._busy || !this._importStation}
        >
          ${this.t("refresh")}
        </button>
      </div>
      ${this._busy ? html`<p class="sub">${this.t("loading")}</p>` : !this._importRows.length ? html`<p class="sub">${this.t("no_records")}</p>` : nothing}${this._importRows.map(
        (row) =>
          html`<article class="import-row">
            <div class="row between">
              <h3>${row.display_name}</h3>
              ${row.user_id ? html`<span class="status synced">${this.t("already_managed")}</span>` : row.ignored ? html`<span class="status">${this.t("ignored")}</span>` : nothing}
            </div>
            <p class="sub">
              ${this.t("employee_id")}: <bdi>${row.employee_no}</bdi> · ${this.t("pin")}:
              ${this.t(row.pin_configured ? "configured" : "not_configured")}
            </p>
            <p class="sub">
              ${this.t("cards")}: ${row.cards.map((card) => card.masked_number).join(", ") || "—"}
            </p>
            ${row.import_error ? html`<p class="danger">${this.t(row.import_error)}</p>` : nothing}${
              !row.user_id
                ? html`<div class="row">
                    <button
                      class="primary"
                      ?disabled=${this._busy || !!row.import_error || !row.review_token}
                      @click=${() => this.adopt(row)}
                    >
                      ${this.t(this._data?.users.some((user) => user.employee_no === row.employee_no) ? "map_existing" : "adopt")}</button
                    ><button
                      ?disabled=${this._busy}
                      @click=${async () => {
                        if (
                          await this.run(
                            () =>
                              this.api("users/ignore", {
                                station_id: this._importStation,
                                employee_no: row.employee_no,
                                ignored: !row.ignored,
                              }),
                            "",
                          )
                        )
                          await this.loadInventory();
                      }}
                    >
                      ${this.t(row.ignored ? "unignore" : "ignore")}</button
                    ><button
                      class="danger"
                      ?disabled=${this._busy || !!row.import_error || !row.review_token}
                      @click=${() => this.adopt(row, true)}
                    >
                      ${this.t("delete")}
                    </button>
                  </div>`
                : nothing
            }
          </article>`,
      )}`;
  }
  private reviewBody() {
    const user = this._data?.users.find((item) => item.id === this._reviewUser);
    const assignment = user?.assignments[this._reviewStation];
    return html`<p>${this.stationName(this._reviewStation)}</p>
      ${
        assignment
          ? html`<dl>
                <dt>${this.t("desired")}</dt>
                <dd>${assignment.desired_revision}</dd>
                <dt>${this.t("applied")}</dt>
                <dd>${assignment.applied_revision ?? "—"}</dd>
                <dt>${this.t("status")}</dt>
                <dd>${this.badge(assignment.sync_state ?? "pending")}</dd>
              </dl>
              ${assignment.last_error ? html`<p class="danger">${this.t(assignment.last_error)}</p>` : nothing}`
          : nothing
      }${
        this._review
          ? html`<div class="comparison">
              <div>
                <h3>${this.t("central_state")}</h3>
                <strong>${user?.display_name ?? this._review.employee_no}</strong>
                <p class="sub">
                  ${this.t("pin")}:
                  ${this.t(user?.pin_configured ? "configured" : "not_configured")}
                </p>
                <p class="sub">
                  ${this.t("cards")}:
                  ${user?.cards.map((card) => card.masked_number).join(", ") || "—"}
                </p>
              </div>
              <div>
                <h3>${this.t("device_state")}</h3>
                <strong
                  >${this._review.absent ? this.t("absent") : this._review.display_name}</strong
                >
                <p class="sub">
                  ${this.t("pin")}:
                  ${this.t(this._review.pin_configured ? "configured" : "not_configured")}
                </p>
                <p class="sub">
                  ${this.t("cards")}:
                  ${this._review.cards.map((card) => card.masked_number).join(", ") || "—"}
                </p>
              </div>
            </div>`
          : this._busy
            ? html`<p>${this.t("loading")}</p>`
            : nothing
      }`;
  }
  private dialogView() {
    if (!this._dialog) return nothing;
    const cameraStation = this._data?.stations.find(
      (station) => station.id === this._cameraStation?.id,
    );
    const title =
      this._dialog === "editor"
        ? this.t(this._draft?.id ? "edit_user" : "add_user")
        : this._dialog === "import"
          ? this.t("import_title")
          : this._dialog === "camera"
            ? cameraStation?.name
            : this.t("review");
    return html`<dialog
      class=${this._dialog === "camera" ? "camera-dialog" : ""}
      aria-label=${title ?? ""}
      @cancel=${(event: Event) => {
        event.preventDefault();
        this.close();
      }}
    >
      <div class="dialog-head">
        <h2>${title}</h2>
        <button
          class="quiet"
          @click=${() => this.close()}
          ?disabled=${this._busy}
          aria-label=${this.t("close")}
        >
          ✕
        </button>
      </div>
      <div class="dialog-body">
        ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}${this._dialog === "editor" ? this.editorBody() : this._dialog === "import" ? this.importBody() : this._dialog === "review" ? this.reviewBody() : cameraStation ? this.camera(cameraStation, true) : nothing}
      </div>
      <div class="dialog-foot">
        ${this._dialog === "editor" ? html`<button @click=${() => this.close()} ?disabled=${this._busy}>${this.t("cancel")}</button><button class="primary" type="submit" form="user-form" ?disabled=${this._busy}>${this.t(this._busy ? "wait" : "save")}</button>` : this._dialog === "review" && this._review ? html`${this._review.deletion_pending ? html`<button class="danger" ?disabled=${this._busy} @click=${() => this.resolve("central")}>${this.t("resolve_delete")}</button>` : html`<button ?disabled=${this._busy || this._review.absent} @click=${() => this.resolve("device")}>${this.t("device")}</button><button class="primary" ?disabled=${this._busy} @click=${() => this.resolve("central")}>${this.t("central")}</button>`}` : this._dialog === "camera" && cameraStation?.lock_enabled ? html`<button class="primary" ?disabled=${this._busy || !cameraStation.online} @click=${() => this.unlock(cameraStation!)}>${this.t("open_door")}</button>` : html`<button @click=${() => this.close()} ?disabled=${this._busy}>${this.t("close")}</button>`}
      </div>
    </dialog>`;
  }
  render() {
    const he = this.hass?.language?.startsWith("he");
    if (!this.hass?.user?.is_admin)
      return html`<div class="empty" dir=${he ? "rtl" : "ltr"}>
        <h2>${this.t("admin_only")}</h2>
      </div>`;
    return html`<div dir=${he ? "rtl" : "ltr"}>
      <header>
        <div class="head">
          <button
            class="quiet"
            aria-label="Menu"
            @click=${() => this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))}
          >
            ☰
          </button>
          <div class="brand" aria-hidden="true">◉</div>
          <div>
            <h1>${this.t("title")}</h1>
            <div class="version">${this.t("version")} <bdi>${this._data?.version ?? ""}</bdi></div>
          </div>
          <div class="spacer"></div>
          <button
            @click=${() => {
              this._error = "";
              void this.refresh();
            }}
            ?disabled=${this._busy}
          >
            ↻ <span class="refresh-label">${this.t("refresh")}</span>
          </button>
        </div>
        <nav class="nav" aria-label=${this.t("title")}>
          ${["overview", "users", "devices", "events", "sync"].map(
            (tab) =>
              html`<button
                aria-current=${this._tab === tab ? "page" : nothing}
                @click=${() => {
                  this._tab = tab;
                }}
              >
                ${this.t(tab)}
              </button>`,
          )}
        </nav>
      </header>
      <main>
        ${
          this._notice
            ? html`<div class="notice" role="status">
                <span>${this._notice}</span
                ><button
                  aria-label=${this.t("close")}
                  @click=${() => {
                    this._notice = "";
                  }}
                >
                  ✕
                </button>
              </div>`
            : nothing
        }${this._error && !this._dialog ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}${
          !this._data
            ? html`<p class="loader">${this.t("loading")}</p>`
            : this._tab === "overview"
              ? this.overviewView()
              : this._tab === "users"
                ? this.usersView()
                : this._tab === "devices"
                  ? this.devicesView()
                  : this._tab === "sync"
                    ? this.syncView()
                    : html`<hikvision-intercom-events
                        .hass=${this.hass}
                        .stations=${this._data.stations}
                      ></hikvision-intercom-events>`
        }
      </main>
      ${this.dialogView()}
    </div>`;
  }
}
customElements.define("hikvision-intercom-panel", IntercomManagerPanel);
