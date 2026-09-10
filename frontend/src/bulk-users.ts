import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { boundedRequest } from "./request";
import { styles } from "./styles";
import { translate } from "./i18n";
import { formatTime, UTC_ZONE } from "./time";
import type { Hass, Person, Station } from "./types";
import type { ProfilePolicy } from "./profile-settings";
interface Preview {
  operation_id: string;
  action: string;
  selected: number;
  changed: number;
  stations: string[];
  rows: {
    user_id: string;
    display_name: string;
    employee_no: string;
    changed_fields: string[];
    profile_changes?: Record<string, { before: string; after: string }>;
    groups_before?: string[];
    groups_after?: string[];
    permissions_before?: string[];
    permissions_after?: string[];
    overrides_before?: number;
    overrides_after?: number;
    changed: boolean;
    stations: string[];
  }[];
  capacity: {
    station_id: string;
    checked_at: string | null;
    users_now: number | null;
    users_projected: number | null;
    max_users: number | null;
    cards_now: number | null;
    cards_projected: number | null;
    max_cards: number | null;
    capacity_warning: boolean;
  }[];
}
interface Receipt {
  operation_id: string;
  action: string;
  saved_at: string;
  changed: number;
  stations: string[];
  user_ids: string[];
}
// Session-only recovery: no credentials or roster data, and never replay a write.
interface PendingBulk {
  operation: string;
  actor: string | undefined;
  checked: boolean;
}
const pending = new WeakMap<Hass["connection"], PendingBulk>();
export class BulkUsers extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
        margin: 12px 0;
      }
      .toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      label {
        min-width: 0;
      }
      .preview {
        border: 1px solid var(--divider-color, #ddd);
        padding: 12px;
        border-radius: 10px;
      }
      .items {
        max-height: 360px;
        overflow: auto;
      }
      .items p {
        overflow-wrap: anywhere;
      }
      select {
        max-width: 100%;
      }
      .confirm {
        display: flex;
        gap: 8px;
        align-items: center;
        margin: 16px 0;
      }
      .confirm input {
        width: auto;
      }
      .notice {
        overflow-wrap: anywhere;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    policy: { attribute: false },
    _profileValue: { state: true },
    users: { attribute: false },
    selected: { attribute: false },
    stations: { attribute: false },
    _action: { state: true },
    _target: { state: true },
    _preview: { state: true },
    _receipt: { state: true },
    _recent: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _approved: { state: true },
    _unknown: { state: true },
    _checked: { state: true },
    _online: { state: true },
  };
  hass?: Hass;
  policy?: ProfilePolicy;
  private _profileValue = "";
  users: Person[] = [];
  selected: string[] = [];
  stations: Station[] = [];
  private _action = "disable";
  private _target = "";
  private _preview?: Preview;
  private _receipt?: Receipt;
  private _recent?: Receipt[];
  private _busy = false;
  private _approved = false;
  private _error = "";
  private _unknown = "";
  private _checked = false;
  private _online = true;
  private connection?: Hass["connection"];
  private actor?: string;
  private controller?: AbortController;
  private running = "";
  private epoch = 0;
  private signature = "";
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private current() {
    return this.users
      .filter((u) => this.selected.includes(u.id))
      .map((u) => ({ user_id: u.id, revision: u.revision }));
  }
  private stamp() {
    return JSON.stringify([
      this.current(),
      this._action,
      this._target,
      this._profileValue,
      this.policy?.revision,
    ]);
  }
  private reset() {
    this.epoch++;
    this.controller?.abort();
    this.controller = undefined;
    this.running = "";
    this._busy = false;
    this._preview = undefined;
    this._approved = false;
    this._receipt = undefined;
    this._recent = undefined;
    this._error = "";
  }
  private restore() {
    const item = this.connection && pending.get(this.connection);
    this._unknown = item?.actor === this.actor ? (item?.operation ?? "") : "";
    this._checked = !!this._unknown && !!item?.checked;
  }
  private forget(operation: string) {
    if (this.connection && pending.get(this.connection)?.operation === operation)
      pending.delete(this.connection);
    this.restore();
  }
  private lost = () => {
    this.reset();
    this._online = false;
    this.restore();
    this._error = this.t("connection_lost");
  };
  private ready = () => {
    this._online = true;
  };
  private bind(connection?: Hass["connection"]) {
    this.connection?.removeEventListener?.("disconnected", this.lost);
    this.connection?.removeEventListener?.("ready", this.ready);
    this.connection = connection;
    this._online = connection?.connected !== false;
    connection?.addEventListener?.("disconnected", this.lost);
    connection?.addEventListener?.("ready", this.ready);
  }
  connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  protected updated(_changed: PropertyValues) {
    const hass = this.hass;
    if (!hass?.user?.is_admin) {
      if (this.connection) pending.delete(this.connection);
      this.reset();
      this.bind(undefined);
      this._unknown = "";
      this._checked = false;
      return;
    }
    if (hass.connection !== this.connection || hass.user.id !== this.actor) {
      if (hass.connection === this.connection && this.connection) pending.delete(this.connection);
      this.reset();
      this.actor = hass.user.id;
      this.bind(hass.connection);
      this.restore();
    }
    const signature = this.stamp();
    if (signature !== this.signature) {
      this.signature = signature;
      if (this.running === "preview") this.reset();
      this._preview = undefined;
      this._approved = false;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.reset();
    this.bind(undefined);
  }
  private stationName(id: string) {
    return this.stations.find((s) => s.id === id)?.name ?? id;
  }
  private async perform(action: "preview" | "apply" | "receipt" | "recent") {
    const hass = this.hass;
    if (this._busy || !hass?.user?.is_admin || !this._online || hass.connection.connected === false)
      return;
    if ((action === "preview" || action === "apply") && this._unknown && !this._checked) return;
    const epoch = this.epoch,
      stamp = this.stamp(),
      preview = this._preview;
    if (action === "apply" && (!preview || !this._approved)) return;
    if (action === "receipt" && !this._unknown) return;
    const connection = hass.connection,
      actor = hass.user.id;
    const valid = () =>
      epoch === this.epoch &&
      this.isConnected &&
      this.hass?.user?.is_admin &&
      this.hass.connection === connection &&
      this.hass.user.id === actor;
    this._busy = true;
    this.running = action;
    this._error = "";
    const operation = action === "apply" ? preview!.operation_id : this._unknown;
    if (action === "apply") pending.set(connection, { operation, actor, checked: false });
    const controller = new AbortController();
    this.controller = controller;
    try {
      const message =
        action === "preview"
          ? {
              type: "hikvision_intercom/users/bulk_preview",
              request: {
                action: this._action,
                selection: this.current(),
                ...(["assign", "unassign"].includes(this._action)
                  ? { station_id: this._target }
                  : {}),
                ...(this._action === "profile"
                  ? { profile: { [this._target]: this._profileValue } }
                  : {}),
                ...(["group_add", "group_remove"].includes(this._action)
                  ? { group_ids: [this._target] }
                  : {}),
              },
            }
          : action === "recent"
            ? { type: "hikvision_intercom/users/bulk_receipts" }
            : {
                type: `hikvision_intercom/users/bulk_${action}`,
                operation_id: operation,
              };
      const result = await boundedRequest(
        () => hass.callWS<Preview | Receipt | Receipt[]>(message),
        action === "apply" ? 60000 : 30000,
        controller.signal,
      );
      if (!valid()) return;
      if (action === "preview") {
        if (stamp !== this.stamp()) return;
        this._preview = result as Preview;
        this._approved = false;
        this._receipt = undefined;
      } else if (action === "recent") this._recent = result as Receipt[];
      else {
        this._receipt = result as Receipt;
        this.forget(operation);
        this._preview = undefined;
        this._approved = false;
        this.dispatchEvent(new CustomEvent("access-changed", { bubbles: true, composed: true }));
      }
    } catch (error) {
      if (valid()) {
        const code = (error as { code?: string })?.code;
        this._error = this.t(code ?? "failed");
        if (action === "apply") {
          if (
            [
              "bulk_review_expired",
              "bulk_review_stale",
              "manager_closed",
              "unauthorized",
              "storage_write_failed",
              "storage_stopping",
            ].includes(code ?? "")
          )
            this.forget(operation);
          else this.restore();
          this._preview = undefined;
          this._approved = false;
        } else if (action === "receipt" && code === "operation_not_found") {
          const item = pending.get(connection);
          if (item?.operation === operation) item.checked = true;
          this.restore();
          this._error = this.t("bulk_receipt_missing");
        }
      }
    } finally {
      if (epoch === this.epoch) {
        this._busy = false;
        this.running = "";
        this.controller = undefined;
      }
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<details .open=${this.current().length > 0 || !!this._unknown || !!this._receipt}>
      <summary>${this.t("bulk_title")}: ${this.current().length}</summary>
      <section>
        <p>
          <strong>${this.t("bulk_title")}: ${this.current().length}</strong> ·
          ${this.t("bulk_hint")}
        </p>
        <div class="toolbar">
          <label
            >${this.t("bulk_action")}<select
              aria-label=${this.t("bulk_action")}
              .value=${this._action}
              ?disabled=${this._busy || !this._online}
              @change=${(e: Event) => {
                this._action = (e.target as HTMLSelectElement).value;
                this._target = "";
                this._preview = undefined;
                this._approved = false;
              }}
            >
              ${["enable", "disable", "assign", "unassign", "delete", "remove_pin", "remove_cards", "sync", "profile", "group_add", "group_remove", "reset_overrides"].map((a) => html`<option value=${a} ?selected=${a === this._action}>${this.t("bulk_" + a)}</option>`)}
            </select></label
          >
          ${
            ["assign", "unassign"].includes(this._action)
              ? html`<label
                  >${this.t("station")}<select
                    aria-label=${this.t("station")}
                    .value=${this._target}
                    ?disabled=${this._busy || !this._online}
                    @change=${(e: Event) => {
                      this._target = (e.target as HTMLSelectElement).value;
                      this._preview = undefined;
                      this._approved = false;
                    }}
                  >
                    <option value="">—</option>
                    ${this.stations.map((s) => html`<option value=${s.id} ?selected=${s.id === this._target} ?disabled=${this._action === "assign" && !s.lock_enabled}>${s.name}</option>`)}
                  </select></label
                >`
              : nothing
          }
          ${
            ["profile", "group_add", "group_remove"].includes(this._action)
              ? html`<label>
                  ${this.t(this._action === "profile" ? "profile_fields" : "profile_groups")}
                  <select
                    aria-label=${this.t("bulk_profile_target")}
                    .value=${this._target}
                    ?disabled=${this._busy || !this._online}
                    @change=${(e: Event) => {
                      this._target = (e.target as HTMLSelectElement).value;
                    }}
                  >
                    <option value="">—</option>
                    ${(this._action === "profile" ? (this.policy?.fields ?? []) : (this.policy?.groups ?? [])).filter((d) => d.enabled || this._action === "group_remove").map((d) => html`<option value=${d.id} ?selected=${this._target === d.id}>${d.label}</option>`)}
                  </select></label
                >`
              : nothing
          }
          ${
            this._action === "profile"
              ? html`<label
                  >${this.t("bulk_profile_value")}<input
                    aria-label=${this.t("bulk_profile_value")}
                    maxlength="100"
                    .value=${this._profileValue}
                    ?disabled=${this._busy || !this._online}
                    @input=${(e: Event) => {
                      this._profileValue = (e.target as HTMLInputElement).value;
                    }}
                /></label>`
              : nothing
          }
          <button
            ?disabled=${this._busy || !this._online || (!!this._unknown && !this._checked) || !this.current().length || this.current().length > 200 || (["assign", "unassign", "profile", "group_add", "group_remove"].includes(this._action) && !this._target)}
            @click=${() => this.perform("preview")}
          >
            ${this.t("bulk_preview")}
          </button>
          <button ?disabled=${this._busy || !this._online} @click=${() => this.perform("recent")}>
            ${this.t("bulk_recent")}
          </button>
        </div>
        ${this._busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
        ${this._unknown ? html`<p class="notice">${this.t("bulk_unknown")} <button ?disabled=${this._busy || !this._online} @click=${() => this.perform("receipt")}>${this.t("bulk_receipt")}</button><bdi>${this._unknown}</bdi></p>` : nothing}
        ${
          this._preview
            ? html`<section class="preview" aria-label=${this.t("bulk_preview")}>
                <h3>${this.t("bulk_" + this._preview.action)}</h3>
                <p>
                  ${this.t("bulk_changed")}: ${this._preview.changed} / ${this._preview.selected}
                </p>
                <div class="items">
                  ${this._preview.rows.map(
                    (row) =>
                      html`<p>
                        <strong>${row.display_name}</strong> · <bdi>${row.employee_no}</bdi
                        ><br />${row.changed ? row.changed_fields.map((f) => this.t("audit_field_" + f)).join(", ") : this.t("bulk_no_change")}<br />${row.stations.map((s) => this.stationName(s)).join(", ")}
                        ${Object.entries(row.profile_changes ?? {}).map(([id, v]) => html`<br />${this.policy?.fields.find((f) => f.id === id)?.label ?? id}: ${v.before || "—"} → ${v.after || "—"}`)}
                        ${["group_add", "group_remove", "reset_overrides"].includes(this._preview!.action) ? html`<br />${this.t("profile_groups")}: ${(row.groups_before ?? []).map((id) => this.policy?.groups.find((g) => g.id === id)?.label ?? id).join(", ") || "—"} → ${(row.groups_after ?? []).map((id) => this.policy?.groups.find((g) => g.id === id)?.label ?? id).join(", ") || "—"}<br />${this.t("assignments")}: ${(row.permissions_before ?? []).map((id) => this.stationName(id)).join(", ") || "—"} → ${(row.permissions_after ?? []).map((id) => this.stationName(id)).join(", ") || "—"}<br />${this.t("bulk_reset_overrides")}: ${row.overrides_before ?? 0} → ${row.overrides_after ?? 0}` : nothing}
                      </p>`,
                  )}
                </div>
                <h4>${this.t("bulk_capacity")}</h4>
                <p class="sub">${this.t("bulk_capacity_hint")}</p>
                ${this._preview.capacity.map((c) => html`<p><strong>${this.stationName(c.station_id)}</strong>: ${this.t("users")} ${c.users_now ?? "?"} → ${c.users_projected ?? "?"} / ${c.max_users ?? "?"}; ${this.t("cards")} ${c.cards_now ?? "?"} → ${c.cards_projected ?? "?"} / ${c.max_cards ?? "?"}<br />${c.checked_at ? formatTime(c.checked_at, this.hass?.language, this.stations.find((s) => s.id === c.station_id)?.clock?.zone ?? UTC_ZONE) : this.t("not_verified")}${c.capacity_warning ? html`<strong class="error">${this.t("bulk_capacity_warning")}</strong>` : nothing}</p>`)}
                <label class="confirm"
                  ><input
                    type="checkbox"
                    .checked=${this._approved}
                    ?disabled=${this._busy || !this._online}
                    @change=${(e: Event) => {
                      this._approved = (e.target as HTMLInputElement).checked;
                    }}
                  />${this.t("bulk_approve")}</label
                >
                <button
                  class="primary"
                  ?disabled=${this._busy || !this._online || !this._approved}
                  @click=${() => this.perform("apply")}
                >
                  ${this.t("bulk_apply")}
                </button>
              </section>`
            : nothing
        }
        ${this._receipt ? html`<p class="notice" role="status">${this.t("bulk_saved")} · ${this._receipt.changed}<br /><bdi>${this._receipt.operation_id}</bdi></p>` : nothing}
        ${
          this._recent
            ? html`<details open>
                <summary>${this.t("bulk_recent")}</summary>
                ${this._recent.map((r) => html`<p>${this.t(r.action.replace("/", "_"))} · ${r.changed} · ${formatTime(r.saved_at, this.hass?.language, UTC_ZONE)}<br /><bdi>${r.operation_id}</bdi></p>`)}
              </details>`
            : nothing
        }
      </section>
    </details>`;
  }
}
customElements.define("hikvision-bulk-users", BulkUsers);
