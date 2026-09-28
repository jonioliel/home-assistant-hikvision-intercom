import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { translate } from "./i18n";
import { boundedRequest } from "./request";
import { formatTime, localInput, resolveLocalInput, UTC_ZONE, type DisplayZone } from "./time";
import type { Hass } from "./types";

export interface TemporaryAccessUser {
  id: string;
  revision: number;
  display_name: string;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  timing_policy_configured: boolean;
}

/** Renew only the outer validity, using the existing revision-checked user update. */
export class TemporaryValidity extends LitElement {
  static properties = {
    hass: { attribute: false },
    user: { attribute: false },
    zone: { attribute: false },
    canManage: { type: Boolean },
    _start: { state: true },
    _end: { state: true },
    _review: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _uncertain: { state: true },
  };
  static styles = css`
    dialog {
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      box-sizing: border-box;
      overflow: auto;
      padding: 22px;
      border: 1px solid var(--divider-color, #dce5e6);
      border-radius: 16px;
      background: var(--surface, var(--card-background-color, white));
      color: var(--ink, var(--primary-text-color, #142622));
    }
    dialog::backdrop {
      background: #14262280;
    }
    h3,
    p {
      margin: 0 0 12px;
    }
    .sub {
      color: var(--muted, var(--secondary-text-color));
    }
    .dates {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    input,
    button {
      font: inherit;
      color: inherit;
      background: var(--surface, var(--card-background-color, white));
      border: 1px solid var(--divider-color, #dce5e6);
      border-radius: 9px;
      min-height: 42px;
      box-sizing: border-box;
      padding: 8px 10px;
    }
    input {
      width: 100%;
      min-width: 0;
      direction: ltr;
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .primary {
      background: var(--primary-color, #286c58);
      color: var(--text-primary-color, white);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: end;
      gap: 8px;
      margin-top: 18px;
    }
    .period {
      border: 1px solid var(--divider-color, #dce5e6);
      border-radius: 10px;
      padding: 12px;
      margin: 10px 0;
    }
    .period strong,
    .period span {
      display: block;
    }
    .error {
      color: var(--error-color, #c83f48);
    }
    .notice {
      color: var(--warning-color, #9a6500);
    }
    @media (max-width: 540px) {
      .dates {
        grid-template-columns: 1fr;
      }
      dialog {
        padding: 16px;
      }
    }
  `;
  hass?: Hass;
  user?: TemporaryAccessUser;
  zone: DisplayZone = UTC_ZONE;
  canManage = false;
  private _start = "";
  private _end = "";
  private _review?: { valid_from: string; valid_until: string };
  private _busy = false;
  private _error = "";
  private _uncertain = false;
  private request?: AbortController;
  private actor?: string;
  private connection?: Hass["connection"];
  private zoneKey = "";
  private t = (key: string) => translate(this.hass?.language ?? "en", key);

  protected willUpdate(changed: PropertyValues) {
    const zoneKey = JSON.stringify(this.zone);
    if (changed.has("user") || (changed.has("zone") && this.zoneKey !== zoneKey)) {
      this.zoneKey = zoneKey;
      this.request?.abort();
      this.request = undefined;
      this._busy = false;
      this._start = localInput(this.user?.valid_from ?? null, this.zone);
      this._end = localInput(this.user?.valid_until ?? null, this.zone);
      this._review = undefined;
      this._error = "";
      this._uncertain = false;
    }
  }
  protected updated() {
    const actor = this.hass?.user?.id,
      connection = this.hass?.connection;
    if (
      (this.actor && (this.actor !== actor || this.connection !== connection)) ||
      !this.canManage
    ) {
      this.request?.abort();
      this._busy = false;
      this.close();
      return;
    }
    this.actor = actor;
    this.connection = connection;
    const dialog = this.shadowRoot?.querySelector("dialog");
    if (this.user && dialog && !dialog.open) dialog.showModal();
  }
  disconnectedCallback() {
    this.request?.abort();
    this.shadowRoot?.querySelector("dialog")?.close();
    super.disconnectedCallback();
  }
  private close() {
    if (this._busy && this.canManage) return;
    this.dispatchEvent(new CustomEvent("renewal-close", { bubbles: true, composed: true }));
  }
  private prepare() {
    if (!this.user || !this.canManage || this._busy || this._uncertain) return;
    this._error = "";
    try {
      const start = resolveLocalInput(this._start, this.zone, this.user.valid_from);
      const end = resolveLocalInput(this._end, this.zone, this.user.valid_until);
      if (!start || !end || Date.parse(end) <= Date.parse(start) || Date.parse(end) <= Date.now())
        throw new Error("invalid_validity");
      if (
        Date.parse(start) === Date.parse(this.user.valid_from ?? "") &&
        Date.parse(end) === Date.parse(this.user.valid_until ?? "")
      )
        throw new Error("temporary_validity_unchanged");
      this._review = { valid_from: start, valid_until: end };
    } catch (error) {
      this._error = this.t((error as Error).message || "invalid_validity");
    }
  }
  private async save() {
    const user = this.user,
      review = this._review,
      hass = this.hass;
    if (
      !user ||
      !review ||
      !hass ||
      !this.canManage ||
      this._busy ||
      this._uncertain ||
      hass.connection.connected === false
    )
      return;
    if (Date.parse(review.valid_until) <= Date.now()) {
      this._review = undefined;
      this._error = this.t("invalid_validity");
      return;
    }
    const actor = hass.user?.id,
      connection = hass.connection;
    const request = new AbortController();
    this.request = request;
    this._busy = true;
    this._error = "";
    const disconnected = () => request.abort();
    connection.addEventListener?.("disconnected", disconnected);
    const current = () =>
      this.isConnected &&
      this.request === request &&
      this.user === user &&
      this.canManage &&
      this.hass?.user?.id === actor &&
      this.hass?.connection === connection;
    try {
      await boundedRequest(
        () =>
          hass.callWS({
            type: "hikvision_intercom/users/update",
            api_contract: 1,
            user_id: user.id,
            revision: user.revision,
            data: { ...review },
            sync_now: true,
          }),
        60000,
        request.signal,
      );
      if (!current() || connection.connected === false) return;
      this.dispatchEvent(
        new CustomEvent("access-renewed", { detail: user.id, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (!current()) return;
      const code = (error as { code?: string })?.code ?? "failed";
      this._uncertain = code === "connection_lost";
      this._error = this.t(this._uncertain ? "panel_operation_unconfirmed" : code);
      this._review = undefined;
    } finally {
      connection.removeEventListener?.("disconnected", disconnected);
      if (this.request === request) {
        this.request = undefined;
        this._busy = false;
      }
    }
  }
  private period(title: string, start: string | null, end: string | null) {
    return html`<div class="period">
      <strong>${this.t(title)}</strong
      ><span>${this.t("valid_from")}: ${formatTime(start, this.hass?.language, this.zone)}</span
      ><span>${this.t("valid_until")}: ${formatTime(end, this.hass?.language, this.zone)}</span>
    </div>`;
  }
  render() {
    const user = this.user;
    if (!user) return nothing;
    return html`<dialog
      dir=${this.hass?.language === "he" ? "rtl" : "ltr"}
      aria-labelledby="renew-title"
      @cancel=${(event: Event) => {
        event.preventDefault();
        this.close();
      }}
    >
      <h3 id="renew-title">${this.t("temporary_renew")} · ${user.display_name}</h3>
      <p class="sub">${this.t("temporary_renew_scope")}</p>
      ${!user.active ? html`<p class="notice">${this.t("temporary_inactive_preserved")}</p>` : nothing}
      ${user.timing_policy_configured ? html`<p class="notice">${this.t("temporary_schedule_preserved")}</p>` : nothing}
      ${this.period("temporary_previous_period", user.valid_from, user.valid_until)}
      ${
        this._review
          ? html`
              ${this.period("temporary_proposed_period", this._review.valid_from, this._review.valid_until)}
              <p class="sub">${this.t("guest_sync_hint")}</p>
            `
          : html`<div class="dates">
                <label
                  >${this.t("valid_from")}<input
                    type="datetime-local"
                    .value=${this._start}
                    ?disabled=${this._busy || this._uncertain}
                    @input=${(event: Event) => {
                      this._start = (event.target as HTMLInputElement).value;
                    }}
                /></label>
                <label
                  >${this.t("valid_until")}<input
                    type="datetime-local"
                    .value=${this._end}
                    ?disabled=${this._busy || this._uncertain}
                    @input=${(event: Event) => {
                      this._end = (event.target as HTMLInputElement).value;
                    }}
                /></label>
              </div>
              <p class="sub">${this.zone.name} · ${this.t("validity_hint")}</p>`
      }
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      <div class="actions">
        <button ?disabled=${this._busy} @click=${() => this.close()}>${this.t("cancel")}</button>
        ${
          this._review
            ? html`<button
                  ?disabled=${this._busy}
                  @click=${() => {
                    this._review = undefined;
                  }}
                >
                  ${this.t("guest_back")}</button
                ><button
                  class="primary"
                  ?disabled=${this._busy || !this.canManage}
                  @click=${() => void this.save()}
                >
                  ${this.t(this._busy ? "loading" : "temporary_renew_confirm")}
                </button>`
            : html`<button
                class="primary"
                ?disabled=${this._busy || !this.canManage || this._uncertain}
                @click=${() => this.prepare()}
              >
                ${this.t("temporary_renew_preview")}
              </button>`
        }
      </div>
    </dialog>`;
  }
}
customElements.define("wiskey-temporary-validity", TemporaryValidity);
