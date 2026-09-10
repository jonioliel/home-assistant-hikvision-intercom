import "./saved-user-views";
import type { UserView } from "./saved-user-views";
import "./usb-card-input";
import "./camera-wall";
import "./permission-directory";
import { profileError, validProfileValue } from "./profile-fields";
import "./profile-settings";
import "./user-photo";
import "./media-settings";
import { formatTime, localInput, fromLocalInput, UTC_ZONE, type DisplayZone } from "./time";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { live } from "lit/directives/live.js";
import { styles } from "./styles";
import { interfaceStyles } from "./interface-styles";
import { modernStyles } from "./modern-styles";
import { AppearancePicker, readAppearance, saveAppearance, type Appearance } from "./appearance";
import { icon } from "./icons";
import { boundedRequest } from "./request";
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
  ReviewState,
  CsvPreview,
  Assignment,
} from "./types";
import "./schedules";
import "./live-clock";
import { downloadText } from "./download";
import "./camera";
import "./call-controls";
import "./audio-controls";
import "./events";
import "./health";
import "./bulk-users";
import "./admin-audit";
import { matchingUsers, defaultFilters, type UserFilters } from "./user-filters";

const settingsPath = "/config/integrations/integration/hikvision_intercom";
const value = (event: Event) => (event.target as HTMLInputElement).value;
const checked = (event: Event) => (event.target as HTMLInputElement).checked;

interface ReleaseState {
  pending: boolean;
  code: string;
  requestedAt: string;
}
interface ReaderCapture {
  user: Person;
  station: string;
  reader: number;
  readers?: number[];
  loading: boolean;
  state: string;
  session_id?: string;
  card?: { masked_number: string; technology: string | null; reader_id: number | null } | null;
  error?: string | null;
  label: string;
}
// Device inventory can wait behind other station reads and its own 120s scan.
// These are browser wait limits; they never retry or cancel server-side changes.
const slowManagementCommands = new Set([
  "stations/inventory",
  "stations/rescan",
  "conflicts/review",
  "conflicts/resolve",
  "conflicts/resolve_deletion",
  "users/adopt",
  "users/delete_unmanaged",
]);
const managementWrites = new Set([
  "users/create",
  "users/update",
  "users/delete",
  "users/set_active",
  "users/csv_apply",
  "users/adopt",
  "users/delete_unmanaged",
  "users/ignore",
  "conflicts/resolve",
  "conflicts/resolve_deletion",
]);
const releaseErrors = new Set([
  "release_in_progress",
  "release_unconfirmed",
  "connection_closed",
  "lock_not_managed",
  "station_offline",
  "device_unavailable",
  "rate_limited",
  "unauthorized",
  "invalid_fields",
]);

export class IntercomManagerPanel extends LitElement {
  static styles = [styles, interfaceStyles, modernStyles];
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    _appearance: { attribute: "data-appearance", reflect: true },
    _dark: { type: Boolean, attribute: "data-dark", reflect: true },
    _deviceFocus: { state: true },
    _data: { state: true },
    _haConnected: { state: true },
    _refreshFailed: { state: true },
    _tab: { state: true },
    _query: { state: true },
    _syncQuery: { state: true },
    _syncStation: { state: true },
    _syncAttention: { state: true },
    _userFilters: { state: true },
    _userColumns: { state: true },
    _selectedUsers: { state: true },
    _auditUser: { state: true },
    _dialog: { state: true },
    _callBusy: { state: true },
    _busy: { state: true },
    _releases: { state: true },
    _notice: { state: true },
    _error: { state: true },
    _importRows: { state: true },
    _review: { state: true },
    _csvPreview: { state: true },
    _csvName: { state: true },
    _csvMapping: { state: true },
    _csvMode: { state: true },
    _capture: { state: true },
    _onboarding: { state: true },
  };
  hass?: Hass;
  narrow = false;
  private _appearance: Appearance = "current";
  private _appearanceUser?: string;
  private _dark = false;
  private _deviceFocus = "";
  protected willUpdate(changed: PropertyValues) {
    if (changed.has("hass")) {
      const user = this.hass?.user?.is_admin ? this.hass.user.id : undefined;
      if (user !== this._appearanceUser) {
        this._appearanceUser = user;
        this._appearance = readAppearance(user);
      }
      this._dark = this.hass?.themes?.darkMode ?? false;
    }
  }
  private appearanceButton() {
    return html`<button
      class="appearance-button"
      title=${this.t("appearance")}
      @click=${(event: Event) => {
        const picker = this.renderRoot.querySelector<AppearancePicker>(
          "hikvision-appearance-picker",
        );
        void picker?.show(this._appearance, event.currentTarget as HTMLElement);
      }}
    >
      ${icon("appearance")}<span>${this.t("appearance")}</span>
    </button>`;
  }
  private navigate(tab: string) {
    const schedules = this.renderRoot.querySelector("hikvision-intercom-schedules") as
      (HTMLElement & { canLeave(): boolean }) | null;
    if (tab !== this._tab && schedules && !schedules.canLeave()) return;
    this._tab = tab;
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>("main")?.focus({ preventScroll: true }),
    );
  }

  private _data?: Overview;
  private _haConnected = true;
  private _refreshFailed = false;
  private connection?: Hass["connection"];
  private pendingRequests = new Set<AbortController>();
  private haDisconnected = () => {
    this._haConnected = false;
    this.cancelRequests();
  };
  private haReady = () => {
    this._haConnected = true;
    void this.refresh();
    void this.connect();
  };
  private cancelRequests() {
    for (const controller of this.pendingRequests) controller.abort();
    this.pendingRequests.clear();
  }
  private bindConnection(connection?: Hass["connection"]) {
    this.connection?.removeEventListener?.("disconnected", this.haDisconnected);
    this.connection?.removeEventListener?.("ready", this.haReady);
    this.connection = connection;
    this._haConnected = connection?.connected !== false;
    connection?.addEventListener?.("disconnected", this.haDisconnected);
    connection?.addEventListener?.("ready", this.haReady);
  }
  private _tab = "overview";
  private _validityStation = "";
  private _validityFrom = "";
  private _validityUntil = "";
  private _clockReads = new Set<string>();
  private _query = "";
  private _syncQuery = "";
  private _syncStation = "";
  private _syncAttention = false;
  private _userFilters: UserFilters = defaultFilters();
  private _selectedUsers = new Set<string>();
  private _userColumns: string[] | null = null;
  private _viewsActor?: string;
  private _auditUser = "";
  private _dialog = "";
  private _busy = false;
  private _releases = new Map<string, ReleaseState>();
  private _notice = "";
  private _error = "";
  private _draft?: Draft;
  private _editorBaseline = "";
  private _validityInputZone: DisplayZone = UTC_ZONE;
  private _importRows: Inventory[] = [];
  private _importStation = "";
  private _review?: Review;
  private _csvPreview?: CsvPreview;
  private _csvContent = "";
  private _csvName = "";
  private _csvMapping: Record<string, string> = {};
  private _csvMode = "create";
  private _capture?: ReaderCapture;
  private _captureEpoch = 0;
  private _captureTimer?: ReturnType<typeof setTimeout>;
  private _reviewUser = "";
  private _reviewStation = "";
  private _cameraStation?: Station;
  private _callBusy = new Set<string>();
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
      if (!document.hidden && this.hass?.user?.is_admin) {
        this.requestUpdate();
        void this.refresh();
      }
    }, 30000);
    if (this.hass?.user?.is_admin) {
      this.bindConnection(this.hass.connection);
      void this.connect();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._epoch++;
    this._busy = false;
    this._notice = "";
    this._error = "";
    this._importRows = [];
    this._review = undefined;
    this.cancelRequests();
    this.bindConnection(undefined);
    this._refreshFailed = false;
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
    this.clearCsv();
    this.clearCapture();
    this._dialog = "";
    this._data = undefined;
    this._releases = new Map();
  }
  protected updated(changed: PropertyValues) {
    if (this._viewsActor !== this.hass?.user?.id) {
      this._viewsActor = this.hass?.user?.id;
      this._userColumns = null;
      this._userFilters = defaultFilters();
      this._query = "";
    }
    if (!this.isConnected) return;
    if (changed.has("hass")) {
      if (this.hass?.user?.is_admin) {
        if (this.connection !== this.hass.connection) {
          this._epoch++;
          this._busy = false;
          this._notice = "";
          this._error = "";
          this.cancelRequests();
          this._unsubscribe?.();
          this._unsubscribe = undefined;
          this._connecting = false;
          this.bindConnection(this.hass.connection);
        }
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
        this._busy = false;
        this._notice = "";
        this._error = "";
        this._importRows = [];
        this._review = undefined;
        this.cancelRequests();
        this.bindConnection(undefined);
        this._refreshFailed = false;
        this._unsubscribe?.();
        this._unsubscribe = undefined;
        this._connecting = false;
        this._draft = undefined;
        this._selectedUsers = new Set();
        this._auditUser = "";
        this.clearCsv();
        this.clearCapture();
        this._data = undefined;
        this._releases = new Map();
        this._dialog = "";
      }
    }
    if (changed.has("_data")) {
      const ids = new Set(this._data?.users.map((u) => u.id) ?? []);
      if ([...this._selectedUsers].some((id) => !ids.has(id)))
        this._selectedUsers = new Set([...this._selectedUsers].filter((id) => ids.has(id)));
    }
    const dialog = this.renderRoot.querySelector("dialog");
    if (dialog && !dialog.open) dialog.showModal();
  }
  private async connect() {
    if (this._unsubscribe || this._connecting || !this.isConnected || !this._haConnected) return;
    this._connecting = true;
    const epoch = this._epoch;
    try {
      const unsub = await this.hass!.connection.subscribeMessage(
        () => {
          void this.refresh();
        },
        { type: "hikvision_intercom/subscribe" },
        {
          preCheck: () => epoch === this._epoch && this.isConnected && !!this.hass?.user?.is_admin,
        },
      );
      if (epoch !== this._epoch || !this.isConnected) {
        unsub();
        return;
      }
      this._unsubscribe = unsub;
      await this.refresh();
    } catch {
      if (epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin)
        this._error = this.t("failed");
    } finally {
      if (epoch === this._epoch) this._connecting = false;
    }
  }
  private currentContext(epoch: number, connection: Hass["connection"]) {
    return (
      epoch === this._epoch &&
      this.isConnected &&
      !!this.hass?.user?.is_admin &&
      this.hass.connection === connection
    );
  }
  private async api<T>(command: string, data: Record<string, unknown> = {}): Promise<T> {
    if (!this.hass?.user?.is_admin || (!this.isConnected && command !== "cards/capture_cancel"))
      throw { code: "unauthorized" };
    if (!this._haConnected || this.hass.connection.connected === false)
      throw { code: "panel_read_interrupted" };
    const hass = this.hass,
      epoch = this._epoch;
    const send = () => hass.callWS<T>({ type: `hikvision_intercom/${command}`, ...data });
    const timeout =
      command === "overview"
        ? 20000
        : command === "stations/test_unlock"
          ? 30000
          : slowManagementCommands.has(command)
            ? 600000
            : 60000;
    const controller = new AbortController();
    this.pendingRequests.add(controller);
    try {
      const result = await boundedRequest(send, timeout, controller.signal);
      if (!this.currentContext(epoch, hass.connection)) throw { code: "panel_read_interrupted" };
      return result;
    } catch (error) {
      if ((error as { code?: string })?.code === "connection_lost")
        throw {
          code: managementWrites.has(command)
            ? "panel_operation_unconfirmed"
            : "panel_read_interrupted",
        };
      throw error;
    } finally {
      this.pendingRequests.delete(controller);
    }
  }
  private async refresh() {
    if (!this.isConnected || !this.hass?.user?.is_admin || !this._haConnected) return;
    if (this._refreshing) {
      this._refreshAgain = true;
      return;
    }
    this._refreshing = true;
    try {
      do {
        this._refreshAgain = false;
        const epoch = this._epoch;
        try {
          const data = await this.api<Overview>("overview");
          if (epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin) {
            this._data = data;
            this.refreshValidityZone();
            this._refreshFailed = false;
            const configured = new Set(data.stations.map((station) => station.id));
            this._releases = new Map([...this._releases].filter(([id]) => configured.has(id)));
          }
        } catch {
          if (epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin)
            this._refreshFailed = true;
        }
      } while (
        this._refreshAgain &&
        this.isConnected &&
        this.hass?.user?.is_admin &&
        this._haConnected
      );
    } finally {
      this._refreshing = false;
    }
  }
  private errorText(error: unknown) {
    const key = (error as { code?: string })?.code;
    return key ? this.t(key) : this.t("failed");
  }
  private async run(action: () => Promise<unknown>, message = "queued") {
    if (this._busy || !this.isConnected || !this.hass?.user?.is_admin) return false;
    if (!this._haConnected || this.hass.connection.connected === false) {
      this._error = this.t("panel_read_interrupted");
      return false;
    }
    const epoch = this._epoch,
      connection = this.hass.connection;
    this._busy = true;
    this._error = "";
    this._notice = "";
    try {
      await action();
      if (!this.currentContext(epoch, connection)) return false;
      if (message) this._notice = this.t(message);
      await this.refresh();
      return this.currentContext(epoch, connection);
    } catch (error) {
      if (this.currentContext(epoch, connection)) {
        if ((error as { code?: string })?.code === "panel_operation_unconfirmed") {
          // A lost create acknowledgement must not leave a reusable PIN-bearing
          // draft that can accidentally create a second person on another click.
          this._draft = undefined;
          this.clearCsv();
          this.clearCapture();
          this._review = undefined;
          this._importRows = [];
          this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();
          this._dialog = "";
        }
        this._error = this.errorText(error);
      }
      return false;
    } finally {
      if (epoch === this._epoch) this._busy = false;
    }
  }
  private close() {
    if (this._busy) return;
    // Native close restores the opening control's keyboard focus before Lit
    // removes the dialog. Removing the element alone drops focus to the page.
    this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();
    this._draft = undefined;
    this.clearCsv();
    this.clearCapture();
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
  private lockName(station: Station) {
    return station.integrated_locks.find((lock) => lock.physical_index === 1)?.name;
  }
  private unlockLabel(station: Station) {
    const name = this.lockName(station);
    return name ? this.t("open_named_lock").replace("{name}", name) : this.t("open_door");
  }
  private validitySummary(user: Person) {
    const start = user.valid_from ? Date.parse(user.valid_from) : null;
    const end = user.valid_until ? Date.parse(user.valid_until) : null;
    const now = Date.now();
    const state =
      start === null && end === null
        ? "permanent"
        : start === null ||
            end === null ||
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            start >= end
          ? "validity_unknown"
          : now < start
            ? "validity_future"
            : now >= end
              ? "validity_expired"
              : "validity_current";
    return html`<div class="validity-summary" title=${this.t("validity_summary_hint")}>
      ${state !== "permanent" ? html`<span class="sub">${this.t("clock_ha_zone")}: ${this._data?.default_zone?.name ?? "UTC"}</span>` : nothing}
      <span>${this.t(state)}</span>
      ${start !== null && Number.isFinite(start) ? html`<div class="sub">${this.t("valid_from")}: <bdi>${this.dateText(user.valid_from)}</bdi></div>` : nothing}
      ${end !== null && Number.isFinite(end) ? html`<div class="sub">${this.t("valid_until")}: <bdi>${this.dateText(user.valid_until)}</bdi></div>` : nothing}
    </div>`;
  }
  private pendingCount() {
    return this._data?.stations.reduce((sum, station) => sum + station.pending_user_count, 0) ?? 0;
  }
  private zone(station?: Station) {
    return station?.clock?.zone ?? (station ? UTC_ZONE : (this._data?.default_zone ?? UTC_ZONE));
  }
  private dateText(value: string | null, station?: Station) {
    return value
      ? formatTime(value, this.hass?.language, this.zone(station))
      : this.t("not_observed");
  }
  private validityZone() {
    if (this._validityStation === "__utc__") return UTC_ZONE;
    return this.zone(this._data?.stations.find((s) => s.id === this._validityStation));
  }
  private readValidity() {
    const zone = this._validityInputZone;
    // Preserve an existing instant (including seconds and a DST fold) when its
    // visible field has not changed. Newly entered wall times must be unique.
    const resolve = (raw: string, previous: string | null) =>
      previous && localInput(previous, zone) === raw ? previous : fromLocalInput(raw, zone);
    const first = resolve(this._validityFrom, this._draft?.valid_from ?? null);
    const last = resolve(this._validityUntil, this._draft?.valid_until ?? null);
    if (this._draft) {
      this._draft.valid_from = first;
      this._draft.valid_until = last;
    }
  }
  private refreshValidityZone() {
    if (this._dialog !== "editor" || !this._draft) return;
    if (
      this._validityStation &&
      this._validityStation !== "__utc__" &&
      !this._data?.stations.some((s) => s.id === this._validityStation)
    )
      this._validityStation = "";
    const next = this.validityZone();
    if (JSON.stringify(next) === JSON.stringify(this._validityInputZone)) return;
    try {
      // Resolve the draft under the rules displayed when it was entered, before
      // formatting those same instants using freshly read station/HA rules.
      this.readValidity();
      this._validityFrom = localInput(this._draft.valid_from, next);
      this._validityUntil = localInput(this._draft.valid_until, next);
    } catch {
      this._validityFrom = this._validityUntil = "";
      this._draft.valid_from = this._draft.valid_until = null;
      this._error = this.t("validity_zone_changed_invalid");
    }
    this._validityInputZone = structuredClone(next);
  }
  private changeValidityZone(id: string) {
    try {
      this.readValidity();
      this._validityStation = id;
      this._validityInputZone = structuredClone(this.validityZone());
      this._validityFrom = localInput(this._draft?.valid_from ?? null, this.validityZone());
      this._validityUntil = localInput(this._draft?.valid_until ?? null, this.validityZone());
      this._error = "";
    } catch (e) {
      this._error = this.t((e as Error).message);
    }
    this.requestUpdate();
  }
  private async refreshClock(station: Station) {
    if (this._clockReads.has(station.id)) return;
    this._clockReads.add(station.id);
    this.requestUpdate();
    const epoch = this._epoch;
    try {
      await this.api("stations/clock_refresh", { station_id: station.id });
      if (epoch === this._epoch) await this.refresh();
    } catch (e) {
      if (epoch === this._epoch) this._error = this.errorText(e);
    } finally {
      this._clockReads.delete(station.id);
      this.requestUpdate();
    }
  }
  private clockView(station: Station) {
    const clock = station.clock;
    return html`<section class="clock-details">
      <h4>${this.t("clock_title")}</h4>
      <p>
        ${this.t("clock_source_" + (clock?.source ?? "fallback"))} ·
        <bdi>${clock?.zone.name ?? "UTC"}</bdi>
      </p>
      <p>
        ${this.t("clock_device_time")}:
        <bdi
          >${clock?.device_time ? formatTime(clock.device_time, this.hass?.language, clock.device_zone ?? UTC_ZONE) : this.t("not_observed")}</bdi
        >
      </p>
      <p>
        ${this.t("clock_checked")}: <bdi>${this.dateText(clock?.checked_at ?? null, station)}</bdi>
      </p>
      ${clock?.skew_seconds !== null && clock?.skew_seconds !== undefined ? html`<p>${this.t("clock_skew")}: <bdi>${clock.skew_seconds} s</bdi> · ${clock.time_mode}</p>` : nothing}
      ${clock?.error || !clock ? html`<p class="danger">${this.t(clock?.status === "stale" ? "clock_stale" : "clock_read_failed")}</p>` : nothing}
      <p class="field-note">${this.t("clock_settings_hint")}</p>
      <button
        ?disabled=${this._clockReads.has(station.id) || !station.loaded}
        @click=${() => this.refreshClock(station)}
      >
        ${this.t(this._clockReads.has(station.id) ? "loading" : "clock_refresh")}
      </button>
    </section>`;
  }
  private lastAccess(station: Station) {
    const event = station.last_access;
    return html`<div class="last-access">
      <span class="sub">${this.t("last_access")}</span>
      ${
        event
          ? html` <div>${event.person_name ?? event.employee_no ?? this.t("unknown_person")}</div>
              <div class="sub">${this.t(event.event_type)} · ${this.t(event.authentication)}</div>
              <div class="sub">
                <bdi>${this.dateText(event.timestamp, station)}</bdi>
                ${!event.person_name && !event.employee_no ? html`<span>${this.t("identity_unavailable")}</span>` : nothing}
                ${event.time_source === "received" ? html` · ${this.t("receipt_time")}` : nothing}
                ${event.recovered ? html` · ${this.t("historical_record")}` : nothing}
              </div>`
          : html`<div class="sub">${this.t("no_access_recorded")}</div>`
      }
    </div>`;
  }
  private _onboarding = "";
  private _editorPolicyRevision?: number;
  private edit(user?: Person) {
    this._onboarding = "";
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
    this._draft.permission_overrides ??= Object.fromEntries(
      Object.entries(this._draft.assignments).map(([id, a]) => [
        id,
        a.enabled ? ("allow" as const) : ("deny" as const),
      ]),
    );
    this._editorPolicyRevision = this._data?.profile_settings?.revision;
    this.refreshDraftPermissions();
    this._validityStation =
      Object.keys(this._draft.assignments).find((id) =>
        this._data?.stations.some((s) => s.id === id),
      ) ??
      this._data?.stations.find((s) => s.lock_enabled)?.id ??
      "";
    this._validityInputZone = structuredClone(this.validityZone());
    this._validityFrom = localInput(this._draft.valid_from, this.validityZone());
    this._validityUntil = localInput(this._draft.valid_until, this.validityZone());
    this._editorBaseline = JSON.stringify(this._draft);
    this._error = "";
    this._dialog = "editor";
  }
  private patchDraft(key: string, newValue: unknown) {
    if (this._draft) (this._draft as unknown as Record<string, unknown>)[key] = newValue;
    if (key === "group_ids") this.refreshDraftPermissions();
    this.requestUpdate();
  }
  private selectStations(all: boolean) {
    if (!this._draft || this._busy) return;
    for (const station of this._data?.stations ?? []) {
      if (station.lock_enabled)
        this._draft.permission_overrides![station.id] = all ? "allow" : "deny";
    }
    this.refreshDraftPermissions();
    this.requestUpdate();
  }
  private inheritedGroups(stationId: string) {
    return (this._data?.profile_settings?.groups ?? []).filter(
      (g) =>
        g.enabled && this._draft?.group_ids?.includes(g.id) && g.station_ids?.includes(stationId),
    );
  }
  private refreshDraftPermissions() {
    const draft = this._draft;
    if (!draft) return;
    const ids = new Set([
      ...Object.keys(draft.assignments),
      ...Object.keys(draft.permission_overrides ?? {}),
      ...(this._data?.stations ?? []).map((s) => s.id),
    ]);
    for (const id of ids) {
      const mode = draft.permission_overrides?.[id];
      const enabled = mode === "allow" || (mode !== "deny" && this.inheritedGroups(id).length > 0);
      if (enabled)
        draft.assignments[id] = { ...draft.assignments[id], enabled: true, allowed_locks: [1] };
      else delete draft.assignments[id];
    }
  }
  private setPersonalPermission(stationId: string, mode: "allow" | "deny" | "inherit") {
    if (!this._draft) return;
    this._draft.permission_overrides ??= {};
    if (mode === "inherit") delete this._draft.permission_overrides[stationId];
    else this._draft.permission_overrides[stationId] = mode;
    this.refreshDraftPermissions();
    this.requestUpdate();
  }
  private pinBlocked() {
    return Object.entries(this._draft?.assignments ?? {}).some(
      ([key, item]) =>
        item.enabled &&
        this._data?.stations.find((station) => station.id === key)?.capabilities?.pin_writable ===
          false,
    );
  }
  private async save(event: SubmitEvent) {
    event.preventDefault();
    const sync_now = (event.submitter as HTMLButtonElement | null)?.value === "sync";
    const draft = this._draft;
    if (!draft || this._busy) return;
    try {
      if (draft.timed) this.readValidity();
    } catch (e) {
      this._error = this.t((e as Error).message);
      return;
    }
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
    const invalidProfile = profileError(
      this._data?.profile_settings,
      draft.profile ?? {},
      draft.id ? (this._data?.users.find((u) => u.id === draft.id)?.profile ?? {}) : undefined,
    );
    if (invalidProfile) {
      this._error = this.t(invalidProfile);
      return;
    }
    const data: Record<string, unknown> = {
      employee_no: draft.employee_no,
      display_name: draft.display_name,
      active: draft.active,
      valid_from: draft.timed ? draft.valid_from : null,
      valid_until: draft.timed ? draft.valid_until : null,
      ...(this._data?.profile_settings
        ? {
            permission_overrides: draft.permission_overrides ?? {},
            access_policy_revision: this._editorPolicyRevision,
          }
        : { assignments: draft.assignments }),
      cards: draft.cards.map((card) => ({
        ...(card.id ? { id: card.id } : { card_no: card.card_no }),
        label: card.label,
        card_type: card.card_type,
        enabled: card.enabled,
      })),
    };
    if (draft.pin !== undefined) data.pin = draft.pin;
    if (this._data?.profile_settings) {
      if (draft.profile !== undefined) data.profile = draft.profile;
      if (draft.group_ids !== undefined) data.group_ids = draft.group_ids;
      if (draft.photo !== undefined) data.photo = draft.photo;
    }
    const success = await this.run(
      () =>
        draft.id
          ? this.api("users/update", {
              user_id: draft.id,
              revision: draft.revision,
              data,
              sync_now,
            })
          : this.api("users/create", { data, sync_now }),
      sync_now ? "saved_sync" : "saved",
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
    const removed = await this.run(
      () => this.api("users/delete", { user_id: user.id, revision: user.revision }),
      "deleted",
    );
    if (removed && this._dialog === "editor") this.close();
  }
  private clearCapture() {
    this._captureEpoch++;
    clearTimeout(this._captureTimer);
    const id = this._capture?.session_id;
    this._capture = undefined;
    if (id) void this.api("cards/capture_cancel", { session_id: id }).catch(() => {});
  }
  private openCapture(user: Person) {
    this.clearCapture();
    this._error = "";
    this._dialog = "capture";
    const station = this._data?.stations.find((s) => s.lock_enabled && s.online)?.id ?? "";
    this._capture = { user, station, reader: 0, loading: false, state: "choose", label: "" };
    if (station) void this.readCaptureCapabilities(station);
  }
  private async readCaptureCapabilities(station: string) {
    const old = this._capture;
    if (!old) return;
    this.clearCapture();
    this._capture = {
      user: old.user,
      station,
      reader: 0,
      loading: true,
      state: "choose",
      label: old.label,
    };
    const epoch = this._captureEpoch;
    try {
      const caps = await this.api<{ readers: number[] }>("cards/reader_capabilities", {
        station_id: station,
      });
      if (epoch !== this._captureEpoch || !this._capture) return;
      this._capture = { ...this._capture, readers: caps.readers, reader: caps.readers[0] ?? 0 };
    } catch (error) {
      if (epoch === this._captureEpoch && this._capture)
        this._capture = {
          ...this._capture,
          error: (error as { code?: string })?.code ?? "capture_failed",
        };
    } finally {
      if (epoch === this._captureEpoch && this._capture)
        this._capture = { ...this._capture, loading: false };
    }
  }
  private captureStale() {
    return (
      !this._capture ||
      this._data?.users.find((user) => user.id === this._capture?.user.id)?.revision !==
        this._capture.user.revision
    );
  }
  private async startCapture() {
    const capture = this._capture;
    if (!capture || this.captureStale() || capture.loading || !capture.readers?.length) return;
    const epoch = this._captureEpoch;
    const hass = this.hass;
    this._capture = { ...capture, loading: true, state: "preparing", error: null };
    try {
      const result = await this.api<{ session_id: string }>("cards/capture_start", {
        station_id: capture.station,
        user_id: capture.user.id,
        revision: capture.user.revision,
        reader_id: capture.reader,
      });
      if (epoch !== this._captureEpoch || !this._capture) {
        void hass
          ?.callWS({
            type: "hikvision_intercom/cards/capture_cancel",
            session_id: result.session_id,
          })
          .catch(() => {});
        return;
      }
      this._capture = { ...this._capture, session_id: result.session_id, loading: false };
      void this.pollCapture(epoch);
    } catch (error) {
      if (epoch === this._captureEpoch && this._capture)
        this._capture = {
          ...this._capture,
          loading: false,
          state: "error",
          error: (error as { code?: string })?.code ?? "capture_failed",
        };
    }
  }
  private async pollCapture(epoch: number) {
    const id = this._capture?.session_id;
    if (!id || epoch !== this._captureEpoch) return;
    try {
      const result = await this.api<{
        state: string;
        card: ReaderCapture["card"];
        error: string | null;
      }>("cards/capture_status", { session_id: id });
      if (epoch !== this._captureEpoch || !this._capture) return;
      this._capture = {
        ...this._capture,
        state: result.state,
        card: result.card,
        error: result.error,
      };
      if (["preparing", "waiting"].includes(result.state))
        this._captureTimer = setTimeout(() => void this.pollCapture(epoch), 1000);
    } catch (error) {
      if (epoch === this._captureEpoch && this._capture)
        this._capture = {
          ...this._capture,
          state: "error",
          error: (error as { code?: string })?.code ?? "capture_failed",
        };
    }
  }
  private async confirmCapture() {
    const capture = this._capture;
    if (!capture?.session_id || capture.state !== "captured" || this.captureStale()) return;
    if (!confirm(this.t("capture_confirm_prompt").replace("{name}", capture.user.display_name)))
      return;
    const epoch = this._captureEpoch;
    const success = await this.run(
      () =>
        this.api("cards/capture_confirm", { session_id: capture.session_id, label: capture.label }),
      "saved",
    );
    if (epoch !== this._captureEpoch) return;
    if (success) this.close();
    else if (this._capture) this._capture = { ...this._capture, state: "unconfirmed", card: null };
  }
  private captureBody() {
    const capture = this._capture;
    if (!capture) return nothing;
    const locked = capture.loading || capture.state !== "choose";
    return html`<p>
        <strong>${capture.user.display_name}</strong> · <bdi>${capture.user.employee_no}</bdi>
      </p>
      <p class="field-note">${this.t("capture_hint")}</p>
      <div class="form-grid">
        <label
          >${this.t("station")}<select
            ?disabled=${locked}
            .value=${capture.station}
            @change=${(event: Event) => this.readCaptureCapabilities(value(event))}
          >
            <option value="" disabled>${this.t("select_station")}</option>
            ${(this._data?.stations ?? []).filter((s) => s.lock_enabled && s.online).map((s) => html`<option value=${s.id}>${s.name}</option>`)}
          </select></label
        >
        <label
          >${this.t("capture_reader")}<select
            aria-label=${this.t("capture_reader")}
            ?disabled=${locked || !capture.readers?.length}
            .value=${String(capture.reader)}
            @change=${(event: Event) => {
              if (this._capture) this._capture = { ...this._capture, reader: Number(value(event)) };
            }}
          >
            ${(capture.readers ?? []).map((id) => html`<option value=${id}>${id === 0 ? this.t("capture_default_reader") : id}</option>`)}
          </select></label
        >
      </div>
      ${capture.error ? html`<p class="notice error" role="alert">${this.t(capture.error)}</p>` : nothing}
      ${this.captureStale() ? html`<p class="notice error" role="alert">${this.t("capture_revision_changed")}</p>` : nothing}
      <p role="status">
        ${capture.loading && capture.state === "choose" ? this.t("loading") : this.t("capture_state_" + capture.state)}
      </p>
      ${
        capture.card
          ? html`<div class="notice">
                <bdi>${capture.card.masked_number}</bdi
                >${capture.card.technology ? html`<span> · <bdi>${capture.card.technology}</bdi></span>` : nothing}
              </div>
              <label
                >${this.t("card_label")}<input
                  maxlength="64"
                  .value=${capture.label}
                  @input=${(event: Event) => {
                    if (this._capture) this._capture.label = value(event);
                  }}
              /></label>
              <p class="field-note">
                ${this.t("capture_targets")}:
                ${
                  Object.keys(capture.user.assignments)
                    .map((id) => this.stationName(id))
                    .join(", ") || this.t("csv_no_stations")
                }
              </p>`
          : nothing
      }
      <p class="field-note">${this.t("capture_limits")}</p>`;
  }
  private captureFooter() {
    const capture = this._capture;
    if (!capture) return nothing;
    return html` ${capture.state === "choose" ? html`<button class="primary" ?disabled=${capture.loading || !capture.readers?.length || this.captureStale()} @click=${() => this.startCapture()}>${this.t("capture_start")}</button>` : nothing}
      ${capture.state === "captured" ? html`<button class="primary" ?disabled=${this._busy || this.captureStale()} @click=${() => this.confirmCapture()}>${this.t("capture_save")}</button>` : nothing}
      ${["error", "captured"].includes(capture.state) ? html`<button ?disabled=${this._busy} @click=${() => this.readCaptureCapabilities(capture.station)}>${this.t("capture_again")}</button>` : nothing}
      <button @click=${() => this.close()} ?disabled=${this._busy}>${this.t("close")}</button>`;
  }
  private clearCsv() {
    this._csvContent = "";
    this._csvPreview = undefined;
    this._csvName = "";
    this._csvMapping = {};
    this._csvMode = "create";
  }
  private openCsv() {
    this.clearCsv();
    this.clearCapture();
    this._error = "";
    this._dialog = "csv";
  }
  private async readCsv(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    this._csvContent = "";
    this._csvPreview = undefined;
    this._csvName = "";
    this._csvMapping = {};
    this._error = "";
    if (!file) return;
    const epoch = this._epoch;
    await this.run(async () => {
      if (file.size > 262144) throw { code: "csv_too_large" };
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw { code: "csv_invalid_encoding" };
      }
      const inspected = await this.api<{ headers: string[]; mapping: Record<string, string> }>(
        "users/csv_inspect",
        { csv: content },
      );
      if (
        epoch === this._epoch &&
        this.isConnected &&
        this.hass?.user?.is_admin &&
        this._dialog === "csv"
      ) {
        this._csvMapping = inspected.mapping;
        this._csvContent = content;
        this._csvName = file.name;
      }
    }, "");
  }
  private async previewCsv() {
    const epoch = this._epoch;
    this._csvPreview = undefined;
    await this.run(async () => {
      const result = await this.api<CsvPreview>("users/csv_preview", {
        csv: this._csvContent,
        column_map: this._csvMapping,
        mode: this._csvMode,
      });
      if (
        epoch === this._epoch &&
        this.isConnected &&
        this.hass?.user?.is_admin &&
        this._dialog === "csv"
      )
        this._csvPreview = result;
    }, "");
  }
  private async applyCsv() {
    const preview = this._csvPreview;
    if (
      !preview?.review_token ||
      preview.errors.length ||
      !confirm(
        this.t("csv_confirm").replace(
          "{count}",
          String(preview.counts.create + preview.counts.update),
        ),
      )
    )
      return;
    const success = await this.run(async () => {
      try {
        await this.api("users/csv_apply", {
          csv: this._csvContent,
          column_map: this._csvMapping,
          mode: this._csvMode,
          review_token: preview.review_token,
        });
      } catch (error) {
        this._csvPreview = undefined;
        throw error;
      }
    }, "csv_saved");
    if (success) this.close();
  }
  private async exportCsv() {
    const epoch = this._epoch;
    await this.run(async () => {
      const result = await this.api<{ csv: string }>("users/csv_export");
      if (epoch === this._epoch && this.isConnected && this.hass?.user?.is_admin)
        downloadText(result.csv, "hikvision-users.csv");
    }, "");
  }
  private csvTargets(): string[] {
    return [
      "employee_no",
      "display_name",
      "active",
      "valid_from",
      "valid_until",
      "stations",
      "pin",
      "cards",
      "group_ids",
      "permission_overrides",
      ...(this._data?.profile_settings?.fields ?? []).map((field) => `profile:${field.id}`),
    ];
  }
  private csvColumnLabel(key: string): string {
    if (key.startsWith("profile:"))
      return (
        this._data?.profile_settings?.fields.find((field) => field.id === key.slice(8))?.label ??
        key
      );
    return this.t(`csv_field_${key}`);
  }
  private csvBody() {
    const preview = this._csvPreview;
    return html`<p>${this.t("csv_hint")}</p>
      <div class="form-grid">
        <label
          >${this.t("csv_file")}<input
            type="file"
            accept=".csv,text/csv"
            ?disabled=${this._busy}
            @change=${this.readCsv}
        /></label>
        <label
          >${this.t("csv_mode")}<select
            .value=${this._csvMode}
            ?disabled=${this._busy}
            @change=${(event: Event) => {
              this._csvMode = value(event);
              this._csvPreview = undefined;
            }}
          >
            <option value="create">${this.t("csv_create_only")}</option>
            <option value="upsert">${this.t("csv_update_existing")}</option>
          </select></label
        >
      </div>
      ${
        this._csvName
          ? html`<p class="sub">${this._csvName}</p>
              <details open class="csv-mapping">
                <summary>${this.t("csv_mapping")}</summary>
                <p>${this.t("csv_mapping_hint")}</p>
                <div class="form-grid">
                  ${Object.entries(this._csvMapping).map(
                    ([header, target]) =>
                      html`<label
                        >${header}<select
                          aria-label=${header}
                          .value=${target}
                          ?disabled=${this._busy}
                          @change=${(event: Event) => {
                            this._csvMapping = { ...this._csvMapping, [header]: value(event) };
                            this._csvPreview = undefined;
                          }}
                        >
                          <option value="">${this.t("csv_ignore_column")}</option>
                          ${this.csvTargets().map((key) => html`<option value=${key}>${this.csvColumnLabel(key)} (${key})</option>`)}
                        </select></label
                      >`,
                  )}
                </div>
              </details>`
          : nothing
      }
      <button
        ?disabled=${this._busy}
        @click=${() => downloadText("\ufeff" + this.csvTargets().join(",") + "\r\n", "wiskey-users-template.csv")}
      >
        ${this.t("csv_template")}
      </button>
      <details>
        <summary>${this.t("csv_format")}</summary>
        <p>${this.t("csv_columns_hint")}</p>
        <p>${this.t("csv_clear_hint")}</p>
        <p>${this.t("csv_station_hint")}</p>
        <p>${this.t("csv_profile_hint")}</p>
        <p>${this.t("csv_group_hint")}</p>
        <ul>
          ${(this._data?.profile_settings?.groups ?? []).map((group) => html`<li>${group.label}: <code>${group.id}</code></li>`)}
        </ul>
        <ul>
          ${(this._data?.stations ?? []).map((station) => html`<li>${station.name}: <code>${station.id}</code></li>`)}
        </ul>
        <p>${this.t("csv_example")}</p>
        <code>{"STATION_ID":true}</code>
        <p>${this.t("csv_card_example")}</p>
        <code>["000099990001"]</code>
      </details>
      ${
        preview
          ? html`<p class="notice">
                ${this.t("plan_create")}: ${preview.counts.create} · ${this.t("plan_update")}:
                ${preview.counts.update} · ${this.t("bulk_unchanged")}: ${preview.counts.unchanged}
              </p>
              ${preview.errors.map((error) => html`<p class="notice error" role="alert">${error.line ? `${this.t("csv_line")} ${error.line}: ` : ""}${error.column ? `${this.csvColumnLabel(error.column)}: ` : ""}${this.t(error.code)}</p>`)}
              ${preview.errors.length ? html`<button @click=${() => downloadText(JSON.stringify({ errors: preview.errors.map(({ line, column, code }) => ({ line, column, code })) }, null, 2), "wiskey-import-errors.json", "application/json")}>${this.t("csv_download_errors")}</button>` : nothing}
              ${preview.rows.map(
                (row) =>
                  html`<article class="import-row">
                    <div class="row between">
                      <strong>${row.display_name}</strong
                      ><span class="status">${this.t(`bulk_${row.operation}`)}</span>
                    </div>
                    <p class="sub">
                      ${this.t("csv_line")} ${row.line} · ${this.t("employee_id")}:
                      <bdi>${row.employee_no}</bdi>
                    </p>
                    <p>
                      ${row.changed_fields.map((field) => this.t(`csv_field_${field}`)).join(", ") || this.t("bulk_unchanged")}
                    </p>
                    <p class="sub">
                      ${this.t("pin")}:
                      ${this.t(row.pin_configured ? "configured" : "not_configured")} ·
                      ${this.t("cards")}: ${row.card_count}
                    </p>
                    <p>
                      ${row.stations.map((id) => this.stationName(id)).join(", ") || this.t("csv_no_stations")}
                    </p>
                    ${row.group_ids ? html`<p>${this.t("groups")}: ${row.group_ids.map((id) => this._data?.profile_settings?.groups.find((group) => group.id === id)?.label ?? id).join(", ") || "—"}</p>` : nothing}
                    ${
                      row.profile
                        ? html`<p>
                            ${Object.entries(row.profile)
                              .map(([id, val]) => `${this.csvColumnLabel(`profile:${id}`)}: ${val}`)
                              .join(" · ")}
                          </p>`
                        : nothing
                    }
                    ${
                      row.permission_overrides
                        ? html`<p>
                            ${this.t("csv_field_permission_overrides")}:
                            ${
                              Object.entries(row.permission_overrides)
                                .map(
                                  ([id, mode]) =>
                                    `${this.stationName(id)}: ${this.t(mode === "allow" ? "permission_personal" : "permission_denied")}`,
                                )
                                .join(" · ") || "—"
                            }
                          </p>`
                        : nothing
                    }
                    ${row.access_removed ? html`<p class="danger">${this.t("csv_revocation")}</p>` : nothing}
                  </article>`,
              )} `
          : nothing
      }`;
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
    if (
      !review ||
      this.reviewStale() ||
      !review.actions[review.deletion_pending ? "delete" : direction]?.allowed
    )
      return;
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
    const success = await this.run(async () => {
      try {
        await this.api(
          review.deletion_pending ? "conflicts/resolve_deletion" : "conflicts/resolve",
          {
            station_id: review.station_id,
            user_id: review.user_id,
            review_token: review.review_token,
            ...(!review.deletion_pending ? { revision: review.revision, direction } : {}),
          },
        );
      } catch (error) {
        if (
          ["review_stale", "revision_conflict"].includes(
            (error as { code?: string })?.code ?? "",
          ) &&
          this._review === review
        )
          this._review = { ...review, invalidated: true };
        throw error;
      }
    });
    if (success) this.close();
  }
  private releasing(station: Station) {
    return (
      !!this._releases.get(station.id)?.pending ||
      this.hass?.states[station.entities.lock]?.state === "unlocking"
    );
  }
  private releaseButton(station: Station, primary = false) {
    return html`<button
      class=${primary ? "primary" : ""}
      aria-label=${this.unlockLabel(station)}
      aria-busy=${this.releasing(station) ? "true" : "false"}
      ?disabled=${!this._haConnected || !station.online || !station.lock_enabled || this.releasing(station)}
      @click=${() => this.unlock(station)}
    >
      ${icon("lock")}${this.releasing(station) ? this.t("releasing") : this.unlockLabel(station)}
    </button>`;
  }
  private releaseFeedback(station: Station) {
    const state = this._releases.get(station.id);
    if (!state || !station.lock_enabled) return nothing;
    return html`<div
      class="release-feedback ${!state.pending && state.code !== "release_sent" ? "danger" : ""}"
      role="status"
    >
      <span class="sub"
        >${this.t("last_release_request")} ·
        <bdi>${this.dateText(state.requestedAt, station)}</bdi></span
      >
      <p>${this.t(state.code)}</p>
    </div>`;
  }
  private async unlock(station: Station) {
    const current = this._data?.stations.find((item) => item.id === station.id);
    if (
      !this.hass?.user?.is_admin ||
      !this.isConnected ||
      !this._haConnected ||
      this.hass.connection.connected === false ||
      !current?.online ||
      !current.lock_enabled ||
      this.releasing(current)
    )
      return;
    const epoch = this._epoch;
    const state: ReleaseState = {
      pending: true,
      code: "releasing",
      requestedAt: new Date().toISOString(),
    };
    // Record synchronously, before awaiting I/O, to reject double clicks across views.
    this._releases = new Map(this._releases).set(current.id, state);
    let code = "release_sent";
    try {
      await this.api("stations/test_unlock", { station_id: current.id, lock: 1 });
    } catch (error) {
      const candidate = (error as { code?: string })?.code;
      code = candidate && releaseErrors.has(candidate) ? candidate : "release_unconfirmed";
    }
    if (
      epoch === this._epoch &&
      this.isConnected &&
      this.hass?.user?.is_admin &&
      this._releases.get(current.id) === state
    ) {
      this._releases = new Map(this._releases).set(current.id, { ...state, pending: false, code });
      // A slow overview refresh must not extend the release button's pending state.
      void this.refresh();
    }
  }
  private setCallBusy = (stationId: string, busy: boolean) => {
    const next = new Set(this._callBusy);
    busy ? next.add(stationId) : next.delete(stationId);
    this._callBusy = next;
  };
  private callControls(station: Station, compact = false) {
    return html`<hikvision-intercom-call-controls
      .hass=${this.hass}
      .station=${station}
      .compact=${compact}
      .blocked=${this._callBusy.has(station.id)}
      .onBusy=${this.setCallBusy}
    ></hikvision-intercom-call-controls>`;
  }
  private camera(station: Station, live = false) {
    return html`<hikvision-intercom-camera
      .stationId=${station.id}
      .media=${this._data?.media_settings}
      .hass=${this.hass}
      .entity=${station.entities.camera ?? ""}
      .version=${this._data?.version ?? ""}
      .live=${live}
      .label=${station.entities.camera ? `${this.t("camera")} · ${station.name}` : this.t("no_camera")}
    ></hikvision-intercom-camera>`;
  }
  private userActions(user: Person) {
    return html`<div class="user-action-group">
      <button class="user-edit" @click=${() => this.edit(user)} ?disabled=${this._busy}>
        ${this.t("edit")}
      </button>
      <button
        @click=${() => this.run(() => this.api("sync/user", { user_id: user.id }))}
        ?disabled=${this._busy}
      >
        ${this.t("sync_now")}
      </button>
    </div>`;
  }
  private editorAction(action: (user: Person) => void) {
    if (this._busy || !this._draft?.id) return;
    if (
      JSON.stringify(this._draft) !== this._editorBaseline ||
      this._validityFrom !== localInput(this._draft.valid_from, this.validityZone()) ||
      this._validityUntil !== localInput(this._draft.valid_until, this.validityZone())
    ) {
      this._error = this.t("profile_save_first");
      return;
    }
    const user = this._data?.users.find((u) => u.id === this._draft?.id);
    if (user) action(user);
  }
  private visibleProfileFields() {
    const fields = this._data?.profile_settings?.fields.filter((f) => f.enabled) ?? [];
    return this._userColumns === null
      ? fields
      : this._userColumns.flatMap((id) => fields.filter((f) => f.id === id));
  }
  private userGroupNames(user: Person) {
    return (
      this._data?.profile_settings?.groups
        .filter((g) => g.enabled && user.group_ids?.includes(g.id))
        .map((g) => g.label)
        .join(", ") ?? ""
    );
  }
  private profileEditor() {
    const draft = this._draft!;
    const policy = this._data?.profile_settings;
    if (
      !policy ||
      (!policy.photo_enabled &&
        !policy.fields.some((f) => f.enabled) &&
        !policy.groups.some((g) => g.enabled))
    )
      return nothing;
    return html`<fieldset class="editor-profile">
      <legend>${this.t("profile_details")}</legend>
      ${
        !draft.id && policy.templates?.some((t) => t.enabled)
          ? html`<div class="row">
              <label
                >${this.t("onboarding_template")}<select
                  .value=${this._onboarding}
                  @change=${(e: Event) => (this._onboarding = value(e))}
                >
                  <option value="">—</option>
                  ${policy.templates.filter((t) => t.enabled).map((t) => html`<option value=${t.id}>${t.label}</option>`)}
                </select></label
              ><button
                type="button"
                ?disabled=${!this._onboarding}
                @click=${() => {
                  const t = policy.templates?.find((t) => t.id === this._onboarding);
                  if (t) {
                    this.patchDraft("profile", structuredClone(t.profile));
                    this.patchDraft("group_ids", [...t.group_ids]);
                    this._draft!.permission_overrides = {};
                    this.refreshDraftPermissions();
                  }
                }}
              >
                ${this.t("onboarding_apply")}
              </button>
              <p class="sub">${this.t("onboarding_apply_hint")}</p>
            </div>`
          : nothing
      }

      <div class="fields">
        ${policy.fields
          .filter((f) => f.enabled)
          .map(
            (f) =>
              html`<label
                >${f.label}
                ${
                  f.type === "select"
                    ? html`<select
                        .value=${draft.profile?.[f.id] ?? ""}
                        ?required=${!draft.id && f.required}
                        @change=${(e: Event) => this.patchDraft("profile", { ...draft.profile, [f.id]: value(e) })}
                      >
                        <option value="">—</option>
                        ${draft.profile?.[f.id] && !f.options.includes(draft.profile[f.id]) ? html`<option value=${draft.profile[f.id]}>${draft.profile[f.id]} (${this.t("profile_legacy_value")})</option>` : nothing}
                        ${f.options.map((o) => html`<option value=${o}>${o}</option>`)}
                      </select>`
                    : html`<input
                          maxlength="100"
                          type=${f.type === "number" ? "text" : f.type === "date" && (!draft.profile?.[f.id] || validProfileValue(f, draft.profile[f.id])) ? "date" : "text"}
                          inputmode=${f.type === "number" ? "decimal" : "text"}
                          ?required=${!draft.id && f.required}
                          list=${"profile-options-" + f.id}
                          .value=${draft.profile?.[f.id] ?? ""}
                          @input=${(e: Event) => this.patchDraft("profile", { ...draft.profile, [f.id]: value(e) })}
                        />
                        <datalist id=${"profile-options-" + f.id}>
                          ${f.options.map((o) => html`<option value=${o}></option>`)}
                        </datalist>`
                }
                ${f.required ? html`<small>${this.t("profile_field_required")}</small>` : nothing}
              </label>`,
          )}
      </div>
      ${
        policy.groups.some((g) => g.enabled)
          ? html`<p>${this.t("profile_groups")}</p>
              <div class="fields">
                ${policy.groups
                  .filter((g) => g.enabled)
                  .map(
                    (g) =>
                      html`<label class="check"
                        ><input
                          type="checkbox"
                          .checked=${draft.group_ids?.includes(g.id) ?? false}
                          @change=${(e: Event) => this.patchDraft("group_ids", checked(e) ? [...(draft.group_ids ?? []), g.id] : (draft.group_ids ?? []).filter((id) => id !== g.id))}
                        />${g.label}</label
                      >`,
                  )}
              </div>`
          : nothing
      }
      ${
        policy.photo_enabled
          ? html`<hikvision-user-photo
              .hass=${this.hass}
              .userId=${draft.id ?? ""}
              .configured=${draft.photo_configured ?? false}
              .revision=${draft.revision ?? 0}
              .image=${draft.photo}
              @photo-changed=${(e: CustomEvent) => this.patchDraft("photo", e.detail)}
            ></hikvision-user-photo>`
          : nothing
      }
      <p class="sub">${this.t("profile_local_hint")}</p>
    </fieldset>`;
  }
  private editorActions() {
    if (!this._draft?.id) return nothing;
    return html`<fieldset class="editor-user-actions">
      <legend>${this.t("user_more_actions")}</legend>
      <div class="row" style="flex-wrap:wrap">
        <button
          type="button"
          ?disabled=${this._busy}
          @click=${() => this.editorAction((u) => this.openCapture(u))}
        >
          ${this.t("capture_card")}
        </button>
        <button
          type="button"
          ?disabled=${this._busy}
          @click=${() =>
            this.editorAction((u) => {
              this._auditUser = u.id;
              this.close();
              this._tab = "audit";
            })}
        >
          ${this.t("audit_show_user")}
        </button>
        <button
          type="button"
          class="danger"
          ?disabled=${this._busy}
          @click=${() =>
            this.editorAction((u) => {
              void this.removeUser(u);
            })}
        >
          ${this.t("delete")}
        </button>
      </div>
      <p class="sub">${this.t("profile_actions_hint")}</p>
    </fieldset>`;
  }
  private overviewView() {
    const stations = [...(this._data?.stations ?? [])].sort(
      (a, b) => Number(b.call_state === "ringing") - Number(a.call_state === "ringing"),
    );
    return html`<div class="overview-header">
        <div class="page-heading">
          <div>
            <h2>${this.t("overview_heading")}</h2>
            <p class="sub">${this.t("overview_intro")}</p>
            <hikvision-live-clock
              .language=${this.hass?.language ?? "en"}
              .zone=${this._data?.default_zone ?? UTC_ZONE}
            ></hikvision-live-clock>
          </div>
        </div>
        <section class="metrics" aria-label=${this.t("overview")}>
          ${[
            [
              `${stations.filter((s) => s.online).length} / ${stations.length}`,
              "online_stations",
              "devices",
              "metric_online",
            ],
            [
              stations.filter((s) => s.call_state === "ringing").length,
              "ringing_now",
              "health",
              "metric_ringing",
            ],
            [this._data?.users.length ?? 0, "total_users", "users", "metric_users"],
            [this.pendingCount(), "pending_sync", "sync", "metric_pending"],
          ].map(
            ([count, label, glyph, shortLabel]) =>
              html`<div
                class="metric"
                role="group"
                aria-label=${`${this.t(String(label))}: ${count}`}
              >
                <span class="metric-icon" aria-hidden="true">${icon(String(glyph))}</span>
                <div class="metric-copy">
                  <strong><bdi dir="ltr">${count}</bdi></strong
                  ><span class="metric-label-full">${this.t(String(label))}</span
                  ><span class="metric-label-short">${this.t(String(shortLabel))}</span>
                </div>
              </div>`,
          )}
        </section>
      </div>
      ${
        !stations.length
          ? html`<div class="empty">
              <h2>${this.t("no_stations")}</h2>
              <a href=${settingsPath}>${this.t("settings")}</a>
            </div>`
          : html`<div class="grid">
              ${repeat(
                stations,
                (s) => s.id,
                (station) =>
                  html`<article
                    class="station overview-station ${station.call_state === "ringing" ? "ringing" : ""}"
                  >
                    <div class="row between station-head">
                      <h3>${station.name}</h3>
                      ${this.badge(station.online ? "online" : "offline")}
                    </div>
                    ${station.call_state === "ringing" ? html`<div class="ring-banner" role="status">${icon("health")} ${this.t("ringing")}</div>` : nothing}
                    <div class="camera-wrap">
                      ${this.camera(station)}<button
                        @click=${() => {
                          this._cameraStation = station;
                          this._dialog = "camera";
                        }}
                        ?disabled=${!station.entities.camera}
                      >
                        ${icon("camera")}${this.t("enlarge")}
                      </button>
                    </div>
                    <div class="station-content">
                      ${
                        station.lock_enabled
                          ? html`<div class="door-action">${this.releaseButton(station, true)}</div>
                              ${this.releaseFeedback(station)}`
                          : html`<p class="sub">${this.t("camera_only")}</p>`
                      }
                      <div class="row between station-state">
                        <span class="sub">${this.t(station.call_state)}</span
                        ><span title=${this.t("sync_status_hint")}
                          >${this.badge(station.sync_state)}</span
                        >
                      </div>
                      ${this.callControls(station, true)}
                      <details class="station-more" ?open=${this._appearance === "current"}>
                        <summary>${this.t("station_activity")}</summary>
                        ${this.lastAccess(station)}
                        <p class="sub pending-users">
                          ${this.t("pending_users")}: ${station.pending_user_count}
                        </p>
                        ${!station.online ? html`<p class="sub last-seen">${this.t("last_seen")}: <bdi>${this.dateText(station.last_seen, station)}</bdi></p>` : nothing}
                        <button
                          class="station-settings"
                          @click=${() => {
                            this._deviceFocus = station.id;
                            this.navigate("devices");
                          }}
                        >
                          ${this.t("station_details")}${icon("arrow")}
                        </button>
                      </details>
                    </div>
                  </article>`,
              )}
            </div>`
      }`;
  }
  private navigation() {
    const management = !["overview", "users", "events"].includes(this._tab);
    return html`<nav class="nav" aria-label=${this.t("title")}>
      <div class="nav-group nav-primary">
        ${["overview", "users", "events", "tools"].map(
          (tab) =>
            html`<button
              aria-current=${this._tab === tab || (tab === "tools" && management) ? "page" : nothing}
              @click=${() => this.navigate(tab)}
            >
              ${icon(tab)}<span>${this.t(tab)}</span>
            </button>`,
        )}
      </div>
    </nav>`;
  }
  private toolsView() {
    return html`<div class="page-heading">
        <div>
          <h2>${this.t("tools")}</h2>
          <p class="sub">${this.t("tools_intro")}</p>
        </div>
      </div>
      <section class="tools-grid" aria-label=${this.t("tools")}>
        ${[
          "media_options",
          "profile_options",
          "permission_directory",
          "camera_wall",
          "users",
          "devices",
          "sync",
          "audit",
          "health",
          "schedules",
        ].map(
          (tab) =>
            html`<article class="tool-card">
              <button aria-describedby=${"tool-" + tab} @click=${() => this.navigate(tab)}>
                ${icon(tab)}${this.t(tab)}${icon("arrow")}
              </button>
              <p class="sub" id=${"tool-" + tab}>${this.t("tools_" + tab)}</p>
            </article>`,
        )}
        <article class="tool-card">
          ${this.appearanceButton()}
          <p class="sub">${this.t("tools_appearance")}</p>
        </article>
        <article class="tool-card">
          <a href=${settingsPath}>${icon("tools")}${this.t("tools_settings")}${icon("arrow")}</a>
          <p class="sub">${this.t("tools_settings_hint")}</p>
        </article>
      </section>`;
  }

  private userSelection(user: Person) {
    return html`<input
      type="checkbox"
      class="user-selection"
      aria-label=${this.t("select_user") + " " + user.display_name}
      .checked=${this._selectedUsers.has(user.id)}
      ?disabled=${!this._selectedUsers.has(user.id) && this._selectedUsers.size >= 200}
      @change=${(e: Event) => {
        const next = new Set(this._selectedUsers);
        (e.target as HTMLInputElement).checked ? next.add(user.id) : next.delete(user.id);
        this._selectedUsers = next;
      }}
    />`;
  }
  private usersView() {
    const users = matchingUsers(this._data?.users ?? [], this._query, this._userFilters);
    const filtered =
      !!this._query.trim() ||
      Object.entries(this._userFilters).some(
        ([key, value]) =>
          key !== "sort" &&
          (typeof value === "object" ? Object.values(value).some(Boolean) : !!value),
      );
    return html`<div class="page-heading users-heading">
        <div>
          <h2>${this.t("users")}</h2>
          <p class="sub">${this.t("users_intro")}</p>
        </div>
        <button class="primary" @click=${() => this.edit()} ?disabled=${this._busy}>
          + ${this.t("add_user")}
        </button>
      </div>
      <div class="toolbar users-tools">
        <input
          type="search"
          .value=${this._query}
          placeholder=${this.t("search")}
          aria-label=${this.t("search")}
          @input=${(event: Event) => {
            this._query = value(event);
            this._selectedUsers = new Set();
          }}
        /><button @click=${() => this.openCsv()} ?disabled=${this._busy}>
          ${this.t("csv_import")}</button
        ><button @click=${() => this.exportCsv()} ?disabled=${this._busy}>
          ${this.t("csv_export")}</button
        ><button @click=${() => this.openImport()} ?disabled=${this._busy}>
          ${this.t("import_existing")}</button
        ><button @click=${() => this.run(() => this.api("sync/all"))} ?disabled=${this._busy}>
          ${this.t("sync_all")}
        </button>
      </div>
      <wiskey-saved-user-views
        .hass=${this.hass}
        .fields=${this._data?.profile_settings?.fields ?? []}
        .value=${{ query: this._query, filters: this._userFilters, columns: this._userColumns }}
        @columns-change=${(e: CustomEvent<string[]>) => (this._userColumns = e.detail)}
        @view-load=${(e: CustomEvent<UserView>) => {
          this._query = e.detail.query;
          this._userFilters = e.detail.filters;
          this._userColumns = e.detail.columns;
          this._selectedUsers = new Set();
        }}
      ></wiskey-saved-user-views>
      <details class="user-filters">
        <summary>${this.t("user_filter_controls")}</summary>
        <div class="toolbar">
          ${(
            [
              [
                "station",
                "user_filter_station",
                this._data?.stations.map((st) => [st.id, st.name]) ?? [],
              ],
              [
                "rights",
                "user_filter_rights",
                ["assigned", "unassigned", "disabled"].map((v) => [v, this.t("filter_" + v)]),
              ],
              [
                "state",
                "user_filter_state",
                ["active", "inactive", "expired", "upcoming"].map((v) => [
                  v,
                  this.t("filter_" + v),
                ]),
              ],
              [
                "credential",
                "user_filter_credential",
                ["pin", "no_pin", "card", "no_card"].map((v) => [v, this.t("filter_" + v)]),
              ],
              [
                "sort",
                "user_sort",
                ["name", "name_desc", "employee"].map((v) => [v, this.t("sort_" + v)]),
              ],
            ] as [keyof UserFilters, string, string[][]][]
          ).map(
            ([key, label, options]) =>
              html`<label
                >${this.t(label)}<select
                  aria-label=${this.t(label)}
                  .value=${this._userFilters[key]}
                  @change=${(e: Event) => {
                    this._userFilters = {
                      ...this._userFilters,
                      [key]: (e.target as HTMLSelectElement).value,
                    };
                    this._selectedUsers = new Set();
                  }}
                >
                  ${key !== "sort" ? html`<option value="">${this.t("filter_any")}</option>` : nothing}${options.map(([id, name]) => html`<option value=${id} ?selected=${this._userFilters[key] === id}>${name}</option>`)}
                </select></label
              >`,
          )}
        </div>
        <div class="toolbar profile-filters">
          ${this._data?.profile_settings?.fields
            .filter((f) => f.enabled)
            .map(
              (f) =>
                html`<label
                  >${f.label}<select
                    aria-label=${f.label}
                    .value=${this._userFilters.profile?.[f.id] ?? ""}
                    @change=${(e: Event) => {
                      this._userFilters = {
                        ...this._userFilters,
                        profile: { ...this._userFilters.profile, [f.id]: value(e) },
                      };
                      this._selectedUsers = new Set();
                    }}
                  >
                    <option value="">${this.t("filter_any")}</option>
                    ${[...new Set((this._data?.users ?? []).map((u) => u.profile?.[f.id]).filter((v): v is string => !!v))].sort().map((v) => html`<option value=${v}>${v}</option>`)}
                  </select></label
                >`,
            )}
          <label
            >${this.t("profile_groups")}<select
              aria-label=${this.t("profile_groups")}
              .value=${this._userFilters.group ?? ""}
              @change=${(e: Event) => {
                this._userFilters = { ...this._userFilters, group: value(e) };
                this._selectedUsers = new Set();
              }}
            >
              <option value="">${this.t("filter_any")}</option>
              ${this._data?.profile_settings?.groups.filter((g) => g.enabled).map((g) => html`<option value=${g.id}>${g.label}</option>`)}
            </select></label
          >
        </div>
      </details>
      <div class="user-result-bar">
        <p role="status">
          ${this.t("user_results")}:
          <bdi dir="ltr">${users.length} / ${this._data?.users.length ?? 0}</bdi>
        </p>
        ${
          filtered
            ? html`<button
                @click=${() => {
                  this._query = "";
                  this._userFilters = {
                    ...this._userFilters,
                    station: "",
                    rights: "",
                    state: "",
                    credential: "",
                    profile: {},
                    group: "",
                  };
                  this._selectedUsers = new Set();
                }}
              >
                ${this.t("clear_user_filters")}
              </button>`
            : nothing
        }
      </div>
      <div class="toolbar">
        <button
          ?disabled=${!users.length}
          @click=${() => {
            this._selectedUsers = new Set(users.slice(0, 200).map((u) => u.id));
          }}
        >
          ${this.t("select_visible")}</button
        ><button
          ?disabled=${!this._selectedUsers.size}
          @click=${() => {
            this._selectedUsers = new Set();
          }}
        >
          ${this.t("clear_selection")}
        </button>
      </div>
      <hikvision-bulk-users
        .hass=${this.hass}
        .policy=${this._data?.profile_settings}
        .users=${this._data?.users ?? []}
        .selected=${[...this._selectedUsers]}
        .stations=${this._data?.stations ?? []}
        @access-changed=${() => this.refresh()}
      ></hikvision-bulk-users>
      ${
        !users.length
          ? html`<div class="empty">
              <h2>${this.t(filtered ? "no_results" : "no_users")}</h2>
              ${!filtered ? html`<p>${this.t("no_users_detail")}</p>` : nothing}
            </div>`
          : html`<div class="table-wrap desktop-users">
                <table>
                  <thead>
                    <tr>
                      <th>${this.t("select_user")}</th>
                      ${["name", "employee_id"].map((key) => html`<th>${this.t(key)}</th>`)}
                      ${this.visibleProfileFields().map((f) => html`<th class="custom-user-field">${f.label}</th>`)}
                      ${this._data?.profile_settings?.groups.some((g) => g.enabled) ? html`<th>${this.t("profile_groups")}</th>` : nothing}
                      ${["pin", "cards", "assignments", "validity", "status", "other"].map((key) => html`<th>${this.t(key)}</th>`)}
                    </tr>
                  </thead>
                  <tbody>
                    ${repeat(
                      users,
                      (user) => user.id,
                      (user) =>
                        html`<tr>
                          <td>${this.userSelection(user)}</td>
                          <td>
                            <div class="person-name">
                              ${
                                this._data?.profile_settings?.photo_enabled && user.photo_configured
                                  ? html`<hikvision-user-photo
                                      compact
                                      .hass=${this.hass}
                                      .userId=${user.id}
                                      .configured=${true}
                                      .revision=${user.revision}
                                    ></hikvision-user-photo>`
                                  : html`<span class="person-avatar" aria-hidden="true"
                                      >${user.display_name
                                        .trim()
                                        .split(/\s+/)
                                        .slice(0, 2)
                                        .map((part) => Array.from(part)[0])
                                        .join("")}</span
                                    >`
                              }
                              <strong>${user.display_name}</strong>
                            </div>
                          </td>
                          <td><bdi>${user.employee_no}</bdi></td>
                          ${this.visibleProfileFields().map((f) => html`<td class="custom-user-field">${user.profile?.[f.id] || "—"}</td>`)}
                          ${this._data?.profile_settings?.groups.some((g) => g.enabled) ? html`<td class="custom-user-field">${this.userGroupNames(user) || "—"}</td>` : nothing}
                          <td>${this.t(user.pin_configured ? "configured" : "not_configured")}</td>
                          <td>${user.cards.length}</td>
                          <td>
                            ${Object.values(user.assignments).filter((item) => item.enabled).length}
                          </td>
                          <td>${this.validitySummary(user)}</td>
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
                        ${this.userSelection(user)}
                        ${this._data?.profile_settings?.photo_enabled && user.photo_configured ? html`<hikvision-user-photo compact .hass=${this.hass} .userId=${user.id} .configured=${true} .revision=${user.revision}></hikvision-user-photo>` : nothing}
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
                      <dl class="user-custom-details">
                        ${this.visibleProfileFields().map(
                          (f) =>
                            html`<div>
                              <dt>${f.label}</dt>
                              <dd>${user.profile?.[f.id] || "—"}</dd>
                            </div>`,
                        )}
                        ${
                          this.userGroupNames(user)
                            ? html`<div>
                                <dt>${this.t("profile_groups")}</dt>
                                <dd>${this.userGroupNames(user)}</dd>
                              </div>`
                            : nothing
                        }
                      </dl>
                      ${this.validitySummary(user)}
                      <div class="row actions">${this.userActions(user)}</div>
                    </article>`,
                )}
              </div>`
      }`;
  }
  private capabilityDetails(station: Station) {
    return html`<section class="capability-details">
      <h4>${this.t("capabilities_title")}</h4>
      <p class="field-note">${this.t("capability_hint")}</p>
      <ul class="capability-list">
        ${["call_status", "snapshot", "video_channel", "user_info", "card_info", "event_query"].map(
          (key) =>
            html`<li>
              <span>${this.t(`cap_${key}`)}</span>
              <span class="sub"
                >${station.observations[key] ? "✓" : "?"}
                ${this.t(station.observations[key] ? "observed" : "not_verified")}</span
              >
            </li>`,
        )}
      </ul>
      <h4>${this.t("integrated_locks")}</h4>
      ${
        station.integrated_locks.length
          ? station.integrated_locks.map(
              (lock) => html`
                <p class="sub lock-mapping">
                  ${lock.name ? html`<strong>${lock.name}</strong> · ` : nothing}${this.t("physical_lock")}
                  ${lock.physical_index} → <bdi>API ${lock.api_id}</bdi>
                </p>
              `,
            )
          : html`<p class="sub">${this.t("camera_only")}</p>`
      }
      <dl class="event-health">
        <dt>${this.t("live_events")}</dt>
        <dd>${this.t(`event_${station.event_status?.stream ?? "unknown"}`)}</dd>
        <dt>${this.t("history_recovery")}</dt>
        <dd>${this.t(`event_${station.event_status?.history ?? "unknown"}`)}</dd>
        <dt>${this.t("history_until")}</dt>
        <dd><bdi>${this.dateText(station.event_status?.recovered_until ?? null, station)}</bdi></dd>
      </dl>
    </section>`;
  }
  private devicesView() {
    return html`<div class="toolbar">
        <h2>${this.t("devices")}</h2>
        <a href=${settingsPath}>${this.t("settings")}</a>
      </div>
      <label class="device-selector"
        >${this.t("device_selection")}<select
          .value=${this._deviceFocus}
          @change=${(event: Event) => {
            this._deviceFocus = value(event);
          }}
        >
          <option value="">${this.t("all")}</option>
          ${this._data?.stations.map((station) => html`<option value=${station.id}>${station.name}</option>`)}
        </select></label
      >
      <div class="grid device-grid">
        ${(this._data?.stations ?? []).map(
          (station) =>
            html`<article
              class="station device-station"
              ?hidden=${this._appearance === "modern" && !!this._deviceFocus && station.id !== this._deviceFocus}
            >
              <div class="row between">
                <h3>${station.name}</h3>
                ${this.badge(station.online ? "online" : "offline")}
              </div>
              <details
                class="device-information"
                ?open=${this._appearance === "current" || this._deviceFocus === station.id}
              >
                <summary>${this.t("station_details")} · <bdi>${station.model}</bdi></summary>
                <dl>
                  ${[
                    ["model", station.model],
                    ["firmware", station.firmware],
                    ["address", station.host],
                    ["last_seen", this.dateText(station.last_seen, station)],
                    [
                      "last_poll",
                      station.last_poll_ms === null
                        ? this.t("not_observed")
                        : `${station.last_poll_ms} ms`,
                    ],
                    ["managed_users", station.managed_user_count ?? this.t("not_observed")],
                    ["pending_users", station.pending_user_count],
                    ["last_reconciliation", this.dateText(station.reconciled_at, station)],
                    [
                      "last_scan",
                      station.scanned_at ? this.dateText(station.scanned_at, station) : "—",
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
              </details>
              <div class="device-metrics">
                <div>
                  <strong>${station.managed_user_count ?? "—"}</strong>${this.t("managed_users")}
                </div>
                <div><strong>${station.pending_user_count}</strong>${this.t("pending_users")}</div>
                <div>
                  <strong>${station.integrated_locks.length}</strong>${this.t("integrated_locks")}
                </div>
              </div>
              <details class="device-extra" ?open=${this._appearance === "current"}>
                <summary>${this.t("clock_title")}</summary>
                ${this.clockView(station)}
              </details>
              <details class="device-extra" ?open=${this._appearance === "current"}>
                <summary>${this.t("capabilities_title")}</summary>
                ${this.capabilityDetails(station)}
              </details>
              <p class="field-note">${this.t("inspection_hint")}</p>
              ${station.scanning ? html`<p role="status">${this.t("scanning")}</p>` : nothing}
              ${station.scan_error ? html`<p class="danger scan-error">${this.t("scan_failed")}: ${this.t(station.scan_error)}</p>` : nothing}
              <p class="sub">${this.t(station.lock_enabled ? "station_access" : "camera_only")}</p>
              ${station.last_error ? html`<p class="danger">${this.t(station.last_error)}</p>` : nothing}
              <div class="row">
                <button
                  @click=${() => this.run(() => this.api("stations/rescan", { station_id: station.id }), "scan_complete")}
                  ?disabled=${this._busy || station.scanning || !station.loaded}
                >
                  ${this.t("rescan")}</button
                ><button
                  @click=${() => this.run(() => this.api("sync/station", { station_id: station.id }))}
                  ?disabled=${this._busy}
                >
                  ${this.t("sync_now")}
                </button>
                ${station.lock_enabled ? this.releaseButton(station) : nothing}
                <a href=${settingsPath}>${this.t("configure")}</a>
              </div>
              ${this.releaseFeedback(station)}
            </article>`,
        )}
      </div>`;
  }
  private async downloadSyncDiagnostics() {
    await this.run(async () => {
      const report = await this.api<Record<string, unknown>>("sync/diagnostics");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "hikvision-sync-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "diagnostics_downloaded");
  }
  private syncView() {
    const data = this._data!;
    const stations = data.stations.filter(
      (st) => !this._syncStation || st.id === this._syncStation,
    );
    const query = this._syncQuery.trim().toLocaleLowerCase();
    const users = data.users.filter(
      (user) =>
        (!query ||
          `${user.display_name} ${user.employee_no}`.toLocaleLowerCase().includes(query)) &&
        (!this._syncAttention ||
          stations.some((st) => {
            const assignment = user.assignments[st.id];
            return (
              assignment &&
              ((assignment.sync_state ?? "pending") !== "synced" || !!assignment.last_error)
            );
          })),
    );
    return html`<div class="page-heading">
        <div>
          <h2>${this.t("sync")}</h2>
          <p class="sub">${this.t("sync_intro")}</p>
        </div>
        <div class="row">
          <button @click=${() => this.downloadSyncDiagnostics()} ?disabled=${this._busy}>
            ${this.t("download_sync_diagnostics")}
          </button>
          <button
            class="primary"
            @click=${() => this.run(() => this.api("sync/all"))}
            ?disabled=${this._busy}
          >
            ${this.t("sync_all")}
          </button>
        </div>
      </div>
      <div class="toolbar sync-filters">
        <label
          >${this.t("sync_search")}<input
            type="search"
            .value=${this._syncQuery}
            @input=${(e: Event) => {
              this._syncQuery = value(e);
            }}
        /></label>
        <label
          >${this.t("sync_filter_station")}<select
            .value=${this._syncStation}
            @change=${(e: Event) => {
              this._syncStation = value(e);
            }}
          >
            <option value="">${this.t("all")}</option>
            ${data.stations.map((st) => html`<option value=${st.id}>${st.name}</option>`)}
          </select></label
        >
        <label class="check"
          ><input
            type="checkbox"
            .checked=${this._syncAttention}
            @change=${(e: Event) => {
              this._syncAttention = checked(e);
            }}
          />${this.t("sync_attention_only")}</label
        >
      </div>
      <p class="sub" role="status">
        ${this.t("user_results")}: <bdi dir="ltr">${users.length} / ${data.users.length}</bdi> ·
        ${this.t("devices")}: ${stations.length}
      </p>
      ${
        users.length && stations.length
          ? html`<div class="table-wrap matrix">
              <table>
                <thead>
                  <tr>
                    <th scope="col">${this.t("name")}</th>
                    ${stations.map(
                      (station) =>
                        html`<th scope="col">
                          ${station.name}
                          ${station.sync_reference ? html`<small class="sub"><bdi>${station.sync_reference}</bdi></small>` : nothing}
                          ${station.last_error ? html`<p class="danger">${this.t(station.last_error)}</p>` : nothing}
                        </th>`,
                    )}
                  </tr>
                </thead>
                <tbody>
                  ${users.map(
                    (user) =>
                      html`<tr>
                        <td class="sync-person">
                          <strong>${user.display_name}</strong
                          >${user.sync_reference ? html`<p class="sub"><bdi>${user.sync_reference}</bdi></p>` : nothing}
                        </td>
                        ${stations.map((station) => {
                          const assignment = user.assignments[station.id];
                          return html`<td class=${assignment ? "sync-assigned" : "sync-unassigned"}>
                            <span class="sync-cell-station">${station.name}</span>
                            ${assignment ? html`<button @click=${() => this.inspect(user.id, station.id)} ?disabled=${this._busy || !station.online}>${this.badge(assignment.sync_state ?? "pending")}</button>${assignment.last_error ? html`<p class="danger sync-error">${this.t(assignment.last_error)}</p>` : nothing}` : html`<span class="sub">—</span>`}
                          </td>`;
                        })}
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
          : html`<div class="empty">
              <p>
                ${this.t(data.users.length && data.stations.length ? "sync_no_matches" : "no_sync")}
              </p>
            </div>`
      }
      <h2 class="section-title">${this.t("pending_removals")}</h2>
      <div class="box">
        ${!data.tombstones.length && !data.revocations.length && !data.card_removals.length && !data.pin_removals.length ? html`<p class="sub">${this.t("no_pending_removals")}</p>` : nothing}${data.tombstones.map(
          (item) =>
            html`<div class="removal">
              <strong>${this.t("employee_id")}: <bdi>${item.employee_no}</bdi></strong
              >${item.targets.filter((id) => !item.confirmed.includes(id)).map((id) => html`<div class="row actions"><span>${this.stationName(id)}</span>${this.badge(item.stations?.[id]?.sync_state ?? "delete_pending")}<button @click=${() => this.inspect(item.user_id, id)} ?disabled=${this._busy}>${this.t("inspect")}</button><button @click=${() => this.run(() => this.api("sync/station", { station_id: id }))} ?disabled=${this._busy}>${this.t("sync_now")}</button></div>`)}
            </div>`,
        )}${data.revocations.map((item) => html`<div class="removal row"><span>${data.users.find((user) => user.id === item.user_id)?.display_name} · ${this.stationName(item.station_id)}</span>${this.badge(item.sync_state)}<button @click=${() => this.inspect(item.user_id, item.station_id)} ?disabled=${this._busy}>${this.t("inspect")}</button></div>`)}${[
          ...data.card_removals.map((item) => ({ ...item, kind: "cards" })),
          ...data.pin_removals.map((item) => ({ ...item, kind: "retired_pin" })),
        ].map(
          (item) =>
            html`<p class="sub">
              ${this.t(item.kind)} ·
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
    return html`<div class="editor-summary">
        <span class="avatar">${icon("users")}</span>
        <div>
          <strong>${draft.display_name || this.t("new_person_heading")}</strong>
          <p class="sub">${this.t("editor_intro")}</p>
        </div>
      </div>
      <form id="user-form" @submit=${(event: SubmitEvent) => this.save(event)}>
        <p class="field-note">${this.t("save_hint")}</p>
        <div class="editor-person-column">
          <fieldset class="editor-person">
            <legend>${icon("users")}${this.t("person_details")}</legend>
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
          ${this.profileEditor()} ${this.editorActions()}
          <fieldset class="editor-validity">
            <legend>${icon("schedules")}${this.t("validity")}</legend>
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
                ? html`<label
                      >${this.t("clock_validity_basis")}<select
                        aria-label=${this.t("clock_validity_basis")}
                        @change=${(e: Event) => {
                          this.changeValidityZone(value(e));
                          (e.target as HTMLSelectElement).value = this._validityStation;
                        }}
                      >
                        <option value="__utc__" ?selected=${this._validityStation === "__utc__"}>
                          UTC
                        </option>
                        <option value="" ?selected=${this._validityStation === ""}>
                          ${this.t("clock_ha_zone")} · ${this._data?.default_zone?.name ?? "UTC"}
                        </option>
                        ${this._data?.stations.map((station) => html`<option value=${station.id} ?selected=${this._validityStation === station.id}>${station.name} · ${this.zone(station).name}</option>`)}
                      </select></label
                    >
                    <div class="fields" style="margin-top:14px">
                      <label
                        >${this.t("valid_from")}<input
                          required
                          type="datetime-local"
                          .value=${live(this._validityFrom)}
                          @input=${(event: Event) => {
                            this._validityFrom = value(event);
                          }} /></label
                      ><label
                        >${this.t("valid_until")}<input
                          required
                          type="datetime-local"
                          .value=${live(this._validityUntil)}
                          @input=${(event: Event) => {
                            this._validityUntil = value(event);
                          }}
                      /></label>
                    </div>
                    <p class="field-note">${this.t("validity_hint")}</p>`
                : html`<p class="sub">${this.t("permanent")}</p>`
            }
          </fieldset>
          <fieldset class="editor-pin">
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
                  .value=${live(draft.pin ?? "")}
                  ?disabled=${blocked || draft.pin === null}
                  @input=${(event: Event) => this.patchDraft("pin", value(event) || undefined)} /></label
              ><label
                >${this.t("confirm_pin")}<input
                  type="password"
                  inputmode="numeric"
                  autocomplete="new-password"
                  pattern="[0-9]*"
                  maxlength="128"
                  .value=${live(draft.confirm_pin)}
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
          <fieldset class="editor-cards">
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
            <wiskey-usb-card-input
              .hass=${this.hass}
              .locked=${this._busy}
              @card-reviewed=${(e: CustomEvent<{ card_no: string }>) => {
                if (!draft.cards.some((c) => c.card_no === e.detail.card_no)) {
                  draft.cards = [
                    ...draft.cards,
                    {
                      card_no: e.detail.card_no,
                      label: "",
                      card_type: "normalCard",
                      enabled: true,
                    },
                  ];
                  this.requestUpdate();
                }
              }}
            ></wiskey-usb-card-input>
          </fieldset>
        </div>
        <fieldset class="editor-assignments">
          <legend>${icon("devices")}${this.t("assignments")}</legend>
          <div class="row assignment-tools">
            <button type="button" @click=${() => this.selectStations(true)} ?disabled=${this._busy}>
              ${this.t("select_all_stations")}
            </button>
            <button
              type="button"
              @click=${() => this.selectStations(false)}
              ?disabled=${this._busy}
            >
              ${this.t("clear_stations")}
            </button>
            <button
              type="button"
              ?disabled=${this._busy}
              @click=${() => {
                draft.permission_overrides = {};
                this.refreshDraftPermissions();
                this.requestUpdate();
              }}
            >
              ${this.t("permission_reset_all")}
            </button>
            <span class="sub"
              >${this.t("selected_stations")}:
              ${Object.values(draft.assignments).filter((item) => item.enabled).length}</span
            >
          </div>
          <p class="field-note">${this.t("group_permission_hint")}</p>
          <div class="assignment-list">
            ${(this._data?.stations ?? []).map(
              (station) =>
                html`<div class="assignment">
                  <label class="check"
                    ><input
                      type="checkbox"
                      .checked=${!!draft.assignments[station.id]?.enabled}
                      ?disabled=${!station.lock_enabled}
                      @change=${(event: Event) => {
                        this.setPersonalPermission(station.id, checked(event) ? "allow" : "deny");
                      }}
                    /><strong>${station.name}</strong
                    >${this.badge(station.online ? "online" : "offline")}</label
                  ><small
                    >${this.t(station.lock_enabled ? "station_access" : "camera_only")}${station.lock_enabled && this.lockName(station) ? html` · ${this.lockName(station)}` : nothing}</small
                  >
                  <small class="permission-source"
                    >${this.t(draft.permission_overrides?.[station.id] === "deny" ? "permission_denied" : draft.permission_overrides?.[station.id] === "allow" ? "permission_personal" : this.inheritedGroups(station.id).length ? "permission_inherited" : "permission_none")}${
                      this.inheritedGroups(station.id).length
                        ? html` ·
                          ${this.inheritedGroups(station.id)
                            .map((g) => g.label)
                            .join(", ")}`
                        : nothing
                    }</small
                  >
                  ${draft.permission_overrides?.[station.id] ? html`<button type="button" class="permission-reset" @click=${() => this.setPersonalPermission(station.id, "inherit")}>${this.t("permission_reset")}</button>` : nothing}
                  ${draft.assignments[station.id]?.enabled ? this.badge(draft.assignments[station.id]?.sync_state ?? "pending") : nothing}
                </div>`,
            )}
          </div>
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
  private reviewStale() {
    const review = this._review;
    if (!review) return false;
    if (review.invalidated) return true;
    if (review.deletion_pending)
      return !this._data?.tombstones.some(
        (item) =>
          item.user_id === review.user_id &&
          item.targets.includes(review.station_id) &&
          !item.confirmed.includes(review.station_id),
      );
    return (
      this._data?.users.find((item) => item.id === review.user_id)?.revision !== review.revision
    );
  }
  private reviewValue(state: ReviewState | null, field: string) {
    if (!state) return this.t("not_verified");
    if (field === "presence") return this.t(state.present ? "review_present" : "absent");
    if (!state.present && field !== "cards") return "—";
    if (field === "display_name") return state.display_name ?? "—";
    if (field === "user_type") return state.user_type ?? this.t("not_verified");
    if (field === "pin")
      return this.t(
        state.pin_configured === null
          ? "not_verified"
          : state.pin_configured
            ? "configured"
            : "not_configured",
      );
    if (field === "validity") {
      const valid = state.validity;
      if (!valid.timed) return this.t("permanent");
      return html`<span
          >${
            valid.time_type === "UTC"
              ? this.dateText(
                  valid.from,
                  this._data?.stations.find((s) => s.id === this._reviewStation),
                )
              : valid.from
          }
          →
          ${
            valid.time_type === "UTC"
              ? this.dateText(
                  valid.until,
                  this._data?.stations.find((s) => s.id === this._reviewStation),
                )
              : valid.until
          }</span
        ><span class="sub">
          · ${valid.time_type === "UTC" ? this.t("review_utc") : this.t("review_local")}</span
        >`;
    }
    if (field === "door_rights")
      return (
        state.door_rights
          .map((id) => {
            const station = this._data?.stations.find((item) => item.id === this._reviewStation);
            const lock = station?.integrated_locks.find((item) => item.api_id === id);
            return lock?.name || `${this.t("physical_lock")} ${lock?.physical_index ?? id}`;
          })
          .join(", ") || "—"
      );
    if (field === "cards")
      return (
        state.cards.map((card) => `${card.masked_number} (${card.card_type})`).join(", ") || "—"
      );
    return this.t(
      (
        field === "schedule"
          ? state.schedule_configured
          : field === "privileged"
            ? state.privileged
            : state.other_credentials
      )
        ? "configured"
        : "not_configured",
    );
  }
  private reviewBody() {
    const review = this._review;
    const user = this._data?.users.find((item) => item.id === this._reviewUser);
    const assignment = user?.assignments[this._reviewStation];
    if (!review) return this._busy ? html`<p>${this.t("loading")}</p>` : nothing;
    const fields = [
      "presence",
      "display_name",
      "user_type",
      "validity",
      "door_rights",
      "pin",
      "cards",
      "schedule",
      "privileged",
      "other_credentials",
    ];
    return html`<div class="row between">
        <strong>${this.stationName(review.station_id)}</strong
        ><button
          ?disabled=${this._busy}
          @click=${() => this.inspect(review.user_id, review.station_id)}
        >
          ${this.t("review_refresh")}
        </button>
      </div>
      <p class="field-note">${this.t("review_hint")}</p>
      <p class="sub">
        ${this.t("review_timestamp")}:
        ${this.dateText(
          review.reviewed_at,
          this._data?.stations.find((s) => s.id === this._reviewStation),
        )}
        · ${this.t("desired")}: ${review.revision ?? "—"} · ${this.t("applied")}:
        ${assignment?.applied_revision ?? "—"}
      </p>
      ${
        assignment?.last_sync_at
          ? html`<p class="sub">
              ${this.t("last_reconciliation")}:
              ${this.dateText(
                assignment.last_sync_at,
                this._data?.stations.find((s) => s.id === this._reviewStation),
              )}
            </p>`
          : nothing
      }
      ${assignment ? html`<p>${this.badge(assignment.sync_state ?? "pending")}${assignment.last_error ? html` <span class="danger">${this.t(assignment.last_error)}</span>` : nothing}</p>` : nothing}
      ${this.reviewStale() && !this._error ? html`<p class="notice error" role="alert">${this.t("review_revision_changed")}</p>` : nothing}
      ${!review.active ? html`<p class="notice">${this.t("review_inactive")}</p>` : nothing}
      <div class="review-fields">
        ${fields.map(
          (field) =>
            html`<section
              class="review-field ${review.differences.includes(field) ? "changed" : ""}"
              data-field=${field}
            >
              <div class="row between">
                <h3>${this.t(`review_${field}`)}</h3>
                <span class="sub"
                  >${this.t(!review.central || review.unverified_fields.includes(field) ? "not_verified" : review.differences.includes(field) ? "review_different" : "review_same")}</span
                >
              </div>
              <div class="review-values">
                <div>
                  <span class="sub">${this.t("central_state")}</span>
                  <div>${this.reviewValue(review.central, field)}</div>
                </div>
                <div>
                  <span class="sub">${this.t("device_state")}</span>
                  <div>${this.reviewValue(review.device, field)}</div>
                </div>
              </div>
            </section>`,
        )}
      </div>
      ${
        review.plan
          ? html`<section class="review-plan">
              <h3>${this.t("review_plan")}</h3>
              <p>
                ${this.t("review_person_operation")}:
                <strong>${this.t(`plan_${review.plan.person}`)}</strong> · ${this.t("pin")}:
                <strong
                  >${review.unverified_fields.includes("pin") ? this.t("not_verified") : this.t(`plan_${review.plan.pin}`)}</strong
                >
              </p>
              <p>
                ${this.t("cards")}: ${this.t("plan_create")} ${review.plan.cards_add} ·
                ${this.t("plan_delete")} ${review.plan.cards_remove} · ${this.t("plan_update")}
                ${review.plan.cards_update}
              </p>
            </section>`
          : nothing
      }
      <h3>${this.t("review_impact")}</h3>
      <p>${this.t("review_impact_hint")}</p>
      <ul>
        ${review.affected_stations.map((id) => html`<li>${this.stationName(id)} · ${this.badge(this._data?.stations.find((item) => item.id === id)?.online ? "online" : "offline")}</li>`)}
      </ul>
      ${[review.deletion_pending ? "delete" : "central", ...(!review.deletion_pending ? ["device"] : [])].map((action) => (review.actions[action]?.reason ? html`<p class="notice error">${this.t(action === "delete" ? "resolve_delete" : action)}: ${this.t(review.actions[action].reason!)}</p>` : nothing))} `;
  }
  private cameraBody(station: Station) {
    return html`<div class="camera-layout">
      <div class="camera-video">${this.camera(station, true)}</div>
      <div class="camera-controls">
        ${this.callControls(station)}
        <hikvision-intercom-audio-controls
          .hass=${this.hass}
          .station=${station}
        ></hikvision-intercom-audio-controls>
        ${this.releaseFeedback(station)}
      </div>
    </div>`;
  }
  private dialogView() {
    if (!this._dialog) return nothing;
    const cameraStation = this._data?.stations.find(
      (station) => station.id === this._cameraStation?.id,
    );
    const title =
      this._dialog === "capture"
        ? this.t("capture_card")
        : this._dialog === "editor"
          ? this.t(this._draft?.id ? "edit_user" : "add_user")
          : this._dialog === "csv"
            ? this.t("csv_import")
            : this._dialog === "import"
              ? this.t("import_title")
              : this._dialog === "camera"
                ? cameraStation?.name
                : this.t("review");
    return html`<dialog
      class=${this._dialog === "camera" ? "camera-dialog" : this._dialog === "capture" ? "capture-dialog" : this._dialog === "editor" ? "editor-dialog" : ""}
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
        ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}${this._dialog === "capture" ? this.captureBody() : this._dialog === "csv" ? this.csvBody() : this._dialog === "editor" ? this.editorBody() : this._dialog === "import" ? this.importBody() : this._dialog === "review" ? this.reviewBody() : cameraStation ? this.cameraBody(cameraStation) : nothing}
      </div>
      <div class="dialog-foot">
        ${this._dialog === "capture" ? this.captureFooter() : this._dialog === "csv" ? html`<button ?disabled=${this._busy || !this._csvContent} @click=${() => this.previewCsv()}>${this.t("csv_preview")}</button><button class="primary" ?disabled=${this._busy || !this._csvPreview?.review_token || !!this._csvPreview?.errors.length || !(this._csvPreview.counts.create + this._csvPreview.counts.update)} @click=${() => this.applyCsv()}>${this.t("csv_apply")}</button>` : this._dialog === "editor" ? html`<button @click=${() => this.close()} ?disabled=${this._busy}>${this.t("cancel")}</button><button type="submit" form="user-form" value="save" ?disabled=${this._busy}>${this.t("save")}</button><button class="primary" type="submit" form="user-form" value="sync" ?disabled=${this._busy}>${this.t(this._busy ? "wait" : "save_sync")}</button>` : this._dialog === "review" && this._review ? html`${this._review.deletion_pending ? html`<button class="danger" ?disabled=${this._busy || this.reviewStale() || !this._review.actions[this._review.deletion_pending ? "delete" : "central"]?.allowed} @click=${() => this.resolve("central")}>${this.t("resolve_delete")}</button>` : html`<button ?disabled=${this._busy || this.reviewStale() || !this._review.actions.device?.allowed} @click=${() => this.resolve("device")}>${this.t("device")}</button><button class="primary" ?disabled=${this._busy || this.reviewStale() || !this._review.actions[this._review.deletion_pending ? "delete" : "central"]?.allowed} @click=${() => this.resolve("central")}>${this.t("central")}</button>`}` : this._dialog === "camera" && cameraStation?.lock_enabled ? this.releaseButton(cameraStation, true) : html`<button @click=${() => this.close()} ?disabled=${this._busy}>${this.t("close")}</button>`}
      </div>
    </dialog>`;
  }
  render() {
    const he = this.hass?.language?.startsWith("he");
    if (!this.hass?.user?.is_admin)
      return html`<div class="empty" dir=${he ? "rtl" : "ltr"}>
        <h2>${this.t("admin_only")}</h2>
      </div>`;
    return html`<div class="app-shell" dir=${he ? "rtl" : "ltr"}>
      <header>
        <div class="head">
          <button
            class="quiet"
            aria-label="Menu"
            @click=${() => this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))}
          >
            ${icon("menu")}
          </button>
          <div class="brand" aria-hidden="true">${icon("devices")}</div>
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
            ${icon("sync")} <span class="refresh-label">${this.t("refresh")}</span>
          </button>
        </div>
        ${this.navigation()}
      </header>
      <main tabindex="-1">
        ${!["overview", "users", "events", "tools"].includes(this._tab) ? html`<button class="tools-back" @click=${() => this.navigate("tools")}>${this.t("tools_back")}</button>` : nothing}
        ${!this._haConnected ? html`<p class="notice error" role="status">${this.t("panel_connection_lost")}</p>` : this._refreshFailed ? html`<p class="notice error" role="status">${this.t(this._data ? "panel_data_stale" : "panel_load_failed")}</p>` : nothing}
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
            ? html`<p class="loader">
                ${this.t(this._refreshFailed || !this._haConnected ? "panel_retry_hint" : "loading")}
              </p>`
            : this._tab === "camera_wall"
              ? html`<wiskey-camera-wall
                  .hass=${this.hass}
                  .stations=${this._data.stations}
                  .media=${this._data.media_settings}
                  .version=${this._data.version}
                  .suspended=${!!this._dialog}
                  @open-station=${(e: CustomEvent<string>) => {
                    this._cameraStation = this._data?.stations.find((s) => s.id === e.detail);
                    this._dialog = "camera";
                  }}
                ></wiskey-camera-wall>`
              : this._tab === "permission_directory"
                ? html`<hikvision-permission-directory
                    .hass=${this.hass}
                    .stations=${this._data.stations}
                    .stamp=${JSON.stringify([this._data.profile_settings?.revision, this._data.users.map((u) => [u.id, u.revision])])}
                    @edit-person=${(e: CustomEvent<string>) => {
                      const user = this._data?.users.find((u) => u.id === e.detail);
                      if (user) this.edit(user);
                    }}
                  ></hikvision-permission-directory>`
                : this._tab === "profile_options"
                  ? html`<hikvision-profile-settings
                      .hass=${this.hass}
                      .settings=${this._data.profile_settings}
                      .stations=${this._data.stations}
                      @profile-saved=${(e: CustomEvent) => {
                        if (this._data) this._data = { ...this._data, profile_settings: e.detail };
                      }}
                    ></hikvision-profile-settings>`
                  : this._tab === "media_options"
                    ? html`<hikvision-media-settings
                        .hass=${this.hass}
                        .settings=${this._data.media_settings}
                        @media-saved=${(e: CustomEvent) => {
                          if (this._data) this._data = { ...this._data, media_settings: e.detail };
                        }}
                      ></hikvision-media-settings>`
                    : this._tab === "tools"
                      ? this.toolsView()
                      : this._tab === "overview"
                        ? this.overviewView()
                        : this._tab === "users"
                          ? this.usersView()
                          : this._tab === "devices"
                            ? this.devicesView()
                            : this._tab === "sync"
                              ? this.syncView()
                              : this._tab === "audit"
                                ? html`<hikvision-admin-audit
                                    .hass=${this.hass}
                                    .users=${this._data.users}
                                    .stations=${this._data.stations}
                                    .focusUser=${this._auditUser}
                                    .zone=${this._data.default_zone ?? UTC_ZONE}
                                    @review-user=${(e: CustomEvent) => this.inspect(e.detail.user_id, e.detail.station_id)}
                                  ></hikvision-admin-audit>`
                                : this._tab === "health"
                                  ? html`<hikvision-intercom-health
                                      .callBusy=${this._callBusy}
                                      .onCallBusy=${this.setCallBusy}
                                      .hass=${this.hass}
                                      .stations=${this._data.stations}
                                    ></hikvision-intercom-health>`
                                  : this._tab === "schedules"
                                    ? html`<hikvision-intercom-schedules
                                        .hass=${this.hass}
                                        .stations=${this._data.stations}
                                      ></hikvision-intercom-schedules>`
                                    : html`<hikvision-intercom-events
                                        .policy=${this._data.profile_settings}
                                        .hass=${this.hass}
                                        .stations=${this._data.stations}
                                        .defaultZone=${this._data.default_zone ?? UTC_ZONE}
                                      ></hikvision-intercom-events>`
        }
      </main>
      ${this.dialogView()}
      <hikvision-appearance-picker
        .language=${this.hass?.language ?? "en"}
        @appearance-change=${(event: CustomEvent<Appearance>) => {
          this._appearance = event.detail;
          if (!saveAppearance(this._appearanceUser, event.detail))
            this._notice = this.t("appearance_session");
        }}
      ></hikvision-appearance-picker>
    </div>`;
  }
}
customElements.define("hikvision-intercom-panel", IntercomManagerPanel);
