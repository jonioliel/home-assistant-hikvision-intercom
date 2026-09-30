import { LitElement, css, html, nothing } from "lit";
import { translate } from "./i18n";
import { boundedRequest } from "./request";
import type { Hass, Person, Station } from "./types";
import type { TemporaryAccessUser } from "./temporary-validity";

export type TemporaryAssignmentStates = Record<
  string,
  {
    sync_state: string;
    last_error: string | null;
    desired_revision: number;
    applied_revision: number | null;
  }
>;

export class TemporaryCancel extends LitElement {
  static properties = {
    hass: { attribute: false },
    user: { attribute: false },
    stations: { attribute: false },
    assignmentStates: { attribute: false },
    latestUser: { attribute: false },
    refreshing: { type: Boolean },
    canManage: { type: Boolean },
    _reason: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _saved: { state: true },
    _uncertain: { state: true },
  };
  static styles = css`
    dialog {
      color: var(--ink, var(--primary-text-color));
      background: var(--surface, var(--card-background-color, white));
      border: 1px solid var(--divider-color, #dce5e6);
      border-radius: 16px;
      padding: 24px;
      width: min(560px, calc(100vw - 48px));
      max-height: calc(100dvh - 48px);
      overflow-y: auto;
      box-sizing: border-box;
    }
    dialog::backdrop {
      background: #0819199c;
    }
    h3 {
      margin: 0 0 12px;
    }
    p {
      line-height: 1.5;
    }
    .sub {
      color: var(--muted, var(--secondary-text-color));
    }
    label {
      display: grid;
      gap: 8px;
    }
    button,
    select {
      font: inherit;
      color: inherit;
      background: var(--surface, var(--card-background-color, white));
      border: 1px solid var(--divider-color, #dce5e6);
      border-radius: 9px;
      min-height: 42px;
      padding: 8px 12px;
    }
    select {
      width: 100%;
      box-sizing: border-box;
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .danger {
      background: var(--error-color, #c83f48);
      color: white;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: end;
      gap: 8px;
      margin-top: 20px;
    }
    .error {
      color: var(--error-color, #c83f48);
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 0;
      border-bottom: 1px solid var(--divider-color, #dce5e6);
    }
    li small {
      width: 100%;
    }
    @media (max-width: 540px) {
      dialog {
        padding: 16px;
      }
    }
  `;
  hass?: Hass;
  user?: TemporaryAccessUser;
  stations: Pick<Station, "id" | "name">[] = [];
  assignmentStates?: TemporaryAssignmentStates;
  latestUser?: TemporaryAccessUser;
  refreshing = false;
  canManage = false;
  private _reason = "visit_cancelled";
  private _busy = false;
  private _error = "";
  private _saved = false;
  private _uncertain = false;
  private savedAssignments?: TemporaryAssignmentStates;
  private savedRevision = 0;
  private request?: AbortController;
  private actor?: string;
  private connection?: Hass["connection"];
  private t = (key: string) => translate(this.hass?.language ?? "en", key);

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
    this.dispatchEvent(new CustomEvent("cancellation-close", { bubbles: true, composed: true }));
  }
  private async save() {
    const user = this.user,
      hass = this.hass;
    if (
      !user?.active ||
      !hass ||
      !this.canManage ||
      this._busy ||
      this._saved ||
      this._uncertain ||
      hass.connection.connected === false
    )
      return;
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
      const result = await boundedRequest<Person>(
        () =>
          hass.callWS({
            type: "hikvision_intercom/users/temporary_cancel",
            api_contract: 1,
            user_id: user.id,
            revision: user.revision,
            reason_code: this._reason,
          }),
        60000,
        request.signal,
      );
      if (!current() || connection.connected === false) return;
      this._saved = true;
      this.savedRevision = result.revision;
      this.savedAssignments = Object.fromEntries(
        Object.entries(result.assignments).map(([id, assignment]) => [
          id,
          {
            sync_state: assignment.sync_state ?? "unknown",
            last_error: assignment.last_error ?? null,
            desired_revision: assignment.desired_revision ?? result.revision,
            applied_revision: assignment.applied_revision ?? null,
          },
        ]),
      );
      this.dispatchEvent(
        new CustomEvent("access-cancelled", { detail: user.id, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (!current()) return;
      const code = (error as { code?: string })?.code ?? "failed";
      this._uncertain = code === "connection_lost";
      this._error = this.t(this._uncertain ? "panel_operation_unconfirmed" : code);
    } finally {
      connection.removeEventListener?.("disconnected", disconnected);
      if (this.request === request) {
        this.request = undefined;
        this._busy = false;
      }
    }
  }
  private synchronization() {
    const currentStates = this.assignmentStates;
    const assignments =
      currentStates &&
      Object.values(currentStates).every(
        (assignment) => assignment.desired_revision >= this.savedRevision,
      )
        ? currentStates
        : (this.savedAssignments ?? {});
    return html`<h4>${this.t("temporary_cancel_station_status")}</h4>
      <button
        ?disabled=${this.refreshing}
        @click=${() => this.dispatchEvent(new CustomEvent("cancellation-refresh", { bubbles: true, composed: true }))}
      >
        ${this.t(this.refreshing ? "loading" : "temporary_cancel_refresh")}
      </button>
      <ul>
        ${Object.entries(assignments).map(([id, assignment]) => html`<li><strong>${this.stations.find((station) => station.id === id)?.name ?? this.t("temporary_unknown_station")}</strong><span>${this.t(assignment.sync_state)}</span>${assignment.last_error ? html`<small class="error">${this.t(assignment.last_error)}</small>` : nothing}</li>`)}
      </ul>
      <p class="sub">${this.t("temporary_cancel_sync_hint")}</p>`;
  }
  render() {
    const user = this.user;
    if (!user) return nothing;
    return html`<dialog
      dir=${this.hass?.language === "he" ? "rtl" : "ltr"}
      aria-labelledby="temporary-cancel-title"
      @cancel=${(event: Event) => {
        event.preventDefault();
        this.close();
      }}
    >
      <h3 id="temporary-cancel-title">${this.t("temporary_cancel")} · ${user.display_name}</h3>
      ${
        this._saved
          ? html`<p role="status">${this.t("temporary_cancel_saved")}</p>
              ${this.latestUser?.active && this.latestUser.revision > this.savedRevision ? html`<p class="error" role="alert">${this.t("temporary_cancel_reactivated")}</p>` : nothing}
              ${this.synchronization()}`
          : html`<p>${this.t("temporary_cancel_scope")}</p>
              <label
                >${this.t("temporary_cancel_reason")}<select
                  .value=${this._reason}
                  ?disabled=${this._busy || this._uncertain}
                  @change=${(event: Event) => {
                    this._reason = (event.target as HTMLSelectElement).value;
                  }}
                >
                  ${["visit_cancelled", "visit_completed", "access_no_longer_needed"].map((reason) => html`<option value=${reason}>${this.t("temporary_reason_" + reason)}</option>`)}
                </select></label
              >
              <p class="sub">${this.t("temporary_cancel_sync_hint")}</p>`
      }
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      <div class="actions">
        <button ?disabled=${this._busy} @click=${() => this.close()}>
          ${this.t(this._saved ? "close" : "cancel")}</button
        >${!this._saved ? html`<button class="danger" ?disabled=${this._busy || !this.canManage || this._uncertain} @click=${() => void this.save()}>${this.t(this._busy ? "loading" : "temporary_cancel_confirm")}</button>` : nothing}
      </div>
    </dialog>`;
  }
}
customElements.define("wiskey-temporary-cancel", TemporaryCancel);
