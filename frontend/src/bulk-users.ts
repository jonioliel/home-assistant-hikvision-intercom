import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { formatTime, UTC_ZONE } from "./time";
import type { Hass, Person, Station } from "./types";
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
  };
  hass?: Hass;
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
  private epoch = 0;
  private signature = "";
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private current() {
    return this.users
      .filter((u) => this.selected.includes(u.id))
      .map((u) => ({ user_id: u.id, revision: u.revision }));
  }
  private stamp() {
    return JSON.stringify([this.current(), this._action, this._target]);
  }
  protected updated(changed: PropertyValues) {
    if (changed.has("hass") && !this.hass?.user?.is_admin) {
      this.epoch++;
      this._preview = undefined;
      this._receipt = undefined;
      this._recent = undefined;
      this._unknown = "";
      this._error = "";
      this._busy = false;
    }
    const signature = this.stamp();
    if (signature !== this.signature) {
      this.signature = signature;
      this._preview = undefined;
      this._approved = false;
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.epoch++;
  }
  private stationName(id: string) {
    return this.stations.find((s) => s.id === id)?.name ?? id;
  }
  private async perform(action: "preview" | "apply" | "receipt" | "recent") {
    if (this._busy || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch,
      stamp = this.stamp(),
      preview = this._preview;
    if (action === "apply" && (!preview || !this._approved)) return;
    this._busy = true;
    this._error = "";
    const operation = action === "apply" ? preview!.operation_id : this._unknown;
    try {
      let result: Preview | Receipt | Receipt[];
      if (action === "preview") {
        result = await this.hass.callWS<Preview>({
          type: "hikvision_intercom/users/bulk_preview",
          request: {
            action: this._action,
            selection: this.current(),
            ...(["assign", "unassign"].includes(this._action) ? { station_id: this._target } : {}),
          },
        });
      } else if (action === "recent")
        result = await this.hass.callWS<Receipt[]>({
          type: "hikvision_intercom/users/bulk_receipts",
        });
      else
        result = await this.hass.callWS<Receipt>({
          type: `hikvision_intercom/users/bulk_${action}`,
          operation_id: operation,
        });
      if (epoch !== this.epoch || !this.isConnected || !this.hass?.user?.is_admin) return;
      if (action === "preview") {
        if (stamp !== this.stamp()) return;
        this._preview = result as Preview;
        this._approved = false;
        this._receipt = undefined;
        this._unknown = "";
      } else if (action === "recent") this._recent = result as Receipt[];
      else {
        this._receipt = result as Receipt;
        this._unknown = "";
        this._preview = undefined;
        this._approved = false;
        this.dispatchEvent(new CustomEvent("access-changed", { bubbles: true, composed: true }));
      }
    } catch (error) {
      if (epoch === this.epoch && this.isConnected && this.hass?.user?.is_admin) {
        const code = (error as { code?: string }).code;
        this._error = this.t(code ?? "failed");
        if (action === "apply") {
          this._unknown = operation;
          this._preview = undefined;
          this._approved = false;
        }
      }
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<section>
      <p>
        <strong>${this.t("bulk_title")}: ${this.current().length}</strong> · ${this.t("bulk_hint")}
      </p>
      <div class="toolbar">
        <label
          >${this.t("bulk_action")}<select
            aria-label=${this.t("bulk_action")}
            .value=${this._action}
            ?disabled=${this._busy}
            @change=${(e: Event) => {
              this._action = (e.target as HTMLSelectElement).value;
              this._preview = undefined;
              this._approved = false;
            }}
          >
            ${["enable", "disable", "assign", "unassign", "delete", "remove_pin", "remove_cards", "sync"].map((a) => html`<option value=${a}>${this.t("bulk_" + a)}</option>`)}
          </select></label
        >
        ${
          ["assign", "unassign"].includes(this._action)
            ? html`<label
                >${this.t("station")}<select
                  aria-label=${this.t("station")}
                  .value=${this._target}
                  ?disabled=${this._busy}
                  @change=${(e: Event) => {
                    this._target = (e.target as HTMLSelectElement).value;
                    this._preview = undefined;
                    this._approved = false;
                  }}
                >
                  <option value="">—</option>
                  ${this.stations.map((s) => html`<option value=${s.id} ?disabled=${this._action === "assign" && !s.lock_enabled}>${s.name}</option>`)}
                </select></label
              >`
            : nothing
        }
        <button
          ?disabled=${this._busy || !this.current().length || this.current().length > 200 || (["assign", "unassign"].includes(this._action) && !this._target)}
          @click=${() => this.perform("preview")}
        >
          ${this.t("bulk_preview")}
        </button>
        <button ?disabled=${this._busy} @click=${() => this.perform("recent")}>
          ${this.t("bulk_recent")}
        </button>
      </div>
      ${this._busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}
      ${this._unknown ? html`<p class="notice">${this.t("bulk_unknown")} <button ?disabled=${this._busy} @click=${() => this.perform("receipt")}>${this.t("bulk_receipt")}</button><bdi>${this._unknown}</bdi></p>` : nothing}
      ${
        this._preview
          ? html`<section class="preview" aria-label=${this.t("bulk_preview")}>
              <h3>${this.t("bulk_" + this._preview.action)}</h3>
              <p>${this.t("bulk_changed")}: ${this._preview.changed} / ${this._preview.selected}</p>
              <div class="items">
                ${this._preview.rows.map((row) => html`<p><strong>${row.display_name}</strong> · <bdi>${row.employee_no}</bdi><br />${row.changed ? row.changed_fields.map((f) => this.t(f)).join(", ") : this.t("bulk_no_change")}<br />${row.stations.map((s) => this.stationName(s)).join(", ")}</p>`)}
              </div>
              <h4>${this.t("bulk_capacity")}</h4>
              <p class="sub">${this.t("bulk_capacity_hint")}</p>
              ${this._preview.capacity.map((c) => html`<p><strong>${this.stationName(c.station_id)}</strong>: ${this.t("users")} ${c.users_now ?? "?"} → ${c.users_projected ?? "?"} / ${c.max_users ?? "?"}; ${this.t("cards")} ${c.cards_now ?? "?"} → ${c.cards_projected ?? "?"} / ${c.max_cards ?? "?"}<br />${c.checked_at ? formatTime(c.checked_at, this.hass?.language, this.stations.find((s) => s.id === c.station_id)?.clock?.zone ?? UTC_ZONE) : this.t("not_verified")}${c.capacity_warning ? html`<strong class="error">${this.t("bulk_capacity_warning")}</strong>` : nothing}</p>`)}
              <label class="confirm"
                ><input
                  type="checkbox"
                  .checked=${this._approved}
                  ?disabled=${this._busy}
                  @change=${(e: Event) => {
                    this._approved = (e.target as HTMLInputElement).checked;
                  }}
                />${this.t("bulk_approve")}</label
              >
              <button
                class="primary"
                ?disabled=${this._busy || !this._approved}
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
    </section>`;
  }
}
customElements.define("hikvision-bulk-users", BulkUsers);
