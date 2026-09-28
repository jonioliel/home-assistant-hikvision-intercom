import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass, Person, Station, UserTimingDraft } from "./types";

interface Operator {
  id: string;
  name: string;
}
interface VisitSnapshot {
  display_name: string;
  employee_no: string;
  access_category: string;
  responsible_person: string;
  access_purpose: string;
  valid_from: string | null;
  valid_until: string | null;
  pin_configured: boolean;
  enabled_cards: number;
  doors: Record<string, number[]>;
  timing_schedule: UserTimingDraft | null;
}
interface VisitRequest {
  id: string;
  user_id: string;
  user_revision: number;
  revision: number;
  approver_id: string;
  requested_by: string;
  requested_at: string;
  status: string;
  decided_by: string;
  decided_at: string | null;
  snapshot: VisitSnapshot;
  stale: boolean;
  user_deleted: boolean;
}
interface VisitPage {
  revision: number;
  items: VisitRequest[];
  total: number;
  offset: number;
  next_offset: number | null;
}
const visitStyles = css`
  :host {
    display: block;
    height: auto;
    min-height: 0;
    overflow: visible;
    background: transparent;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .heading {
    justify-content: space-between;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
    gap: 12px;
  }
  article,
  .review,
  .approval {
    border: 1px solid var(--divider-color, #dce5e6);
    border-radius: 12px;
    padding: 14px;
    background: var(--surface, var(--card-background-color, white));
    min-width: 0;
  }
  .review {
    margin-block: 12px;
    border-color: var(--accent, #3b8175);
  }
  h2,
  h3,
  p {
    margin: 0 0 10px;
  }
  .actions {
    justify-content: end;
    margin-block-start: 12px;
  }
  .sub {
    color: var(--muted, var(--secondary-text-color));
    font-size: 13px;
  }
  select {
    max-width: 100%;
    min-width: 0;
  }
  label {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-block: 8px;
  }
  .error,
  p,
  li {
    overflow-wrap: anywhere;
  }
  .tag {
    border-radius: 20px;
    padding: 4px 9px;
    background: var(--soft, #e8f0ee);
    font-size: 13px;
  }
  .danger {
    color: var(--error-color, #c83f48);
  }
  ul {
    padding-inline-start: 20px;
    margin-block: 8px;
  }
`;

class VisitContext extends LitElement {
  static properties = {
    hass: { attribute: false },
    canManage: { attribute: false },
    error: { state: true },
    busy: { state: true },
  };
  static styles = [styles, visitStyles];
  hass?: Hass;
  canManage = false;
  protected busy = false;
  protected error = "";
  protected operators: Operator[] = [];
  protected epoch = 0;
  protected requests = new ScopedRequests(() => this.hass);
  private actor?: string;
  private connection?: Hass["connection"];
  protected t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(changes: PropertyValues) {
    if (
      this.hass &&
      (this.actor !== this.hass.user?.id || this.connection !== this.hass.connection)
    ) {
      this.reset();
      this.actor = this.hass.user?.id;
      this.connection = this.hass.connection;
      void this.load();
    } else if (changes.has("canManage") && !this.canManage) this.reset();
  }
  protected reset() {
    this.epoch++;
    this.requests.cancel();
    this.busy = false;
    this.error = "";
    this.operators = [];
  }
  protected async load(): Promise<void> {}
  protected rpc<T>(command: string, data: Record<string, unknown> = {}) {
    return this.requests.run<T>({ type: `hikvision_intercom/${command}`, ...data });
  }
  disconnectedCallback() {
    this.reset();
    super.disconnectedCallback();
  }
}

/** Only selection is emitted. Creating a request remains the parent form's explicit save. */
class VisitApprover extends VisitContext {
  static properties = {
    ...VisitContext.properties,
    required: { attribute: false },
    selected: { attribute: false },
    operators: { state: true },
  };
  required = false;
  selected = "";
  protected async load() {
    const epoch = this.epoch;
    this.busy = true;
    try {
      const result = await this.rpc<{ operators: Operator[] }>("visits/operators");
      if (epoch === this.epoch && this.isConnected)
        this.operators = result.operators.filter((item) => item.id !== this.hass?.user?.id);
    } catch (error) {
      if (epoch === this.epoch) this.error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private change(required: boolean, selected: string) {
    this.required = required;
    this.selected = selected;
    this.dispatchEvent(
      new CustomEvent("approval-change", {
        detail: { required, approverId: selected },
        bubbles: true,
        composed: true,
      }),
    );
  }
  render() {
    return html`<section class="approval">
      <label
        ><input
          type="checkbox"
          .checked=${this.required}
          ?disabled=${this.busy || !this.canManage}
          @change=${(e: Event) => this.change((e.target as HTMLInputElement).checked, this.selected)}
        />${this.t("visit_require_approval")}</label
      >
      ${
        this.required
          ? html`<p class="sub">${this.t("visit_approval_hint")}</p>
              <label
                >${this.t("visit_approver")}<select
                  .value=${this.selected}
                  required
                  ?disabled=${this.busy || !this.canManage}
                  @change=${(e: Event) => this.change(true, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">${this.t("visit_choose_approver")}</option>
                  ${this.operators.map((item) => html`<option value=${item.id}>${item.name || item.id}</option>`)}
                </select></label
              >${!this.busy && !this.operators.length ? html`<p class="error" role="alert">${this.t("visit_no_approver")}</p>` : nothing}`
          : nothing
      }
      ${
        this.error
          ? html`<p class="error" role="alert">${this.error}</p>
              <button type="button" @click=${() => void this.load()}>${this.t("refresh")}</button>`
          : nothing
      }
    </section>`;
  }
}
customElements.define("wiskey-visit-approver", VisitApprover);

export class VisitRequestsPanel extends VisitContext {
  static properties = {
    ...VisitContext.properties,
    stations: { attribute: false },
    page: { state: true },
    filter: { state: true },
    review: { state: true },
    uncertain: { state: true },
    notice: { state: true },
    resubmitUser: { state: true },
    approver: { state: true },
    operators: { state: true },
  };
  stations: Station[] = [];
  private page?: VisitPage;
  private filter = "pending";
  private review?: { row: VisitRequest; decision: string };
  private resubmitUser?: Person;
  private approver = "";
  private uncertain = false;
  private notice = "";
  protected reset() {
    super.reset();
    this.page = undefined;
    this.review = undefined;
    this.resubmitUser = undefined;
    this.approver = "";
    this.uncertain = false;
    this.notice = "";
  }
  protected async load(offset = this.page?.offset ?? 0) {
    if (this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      const [page, operators] = await Promise.all([
        this.rpc<VisitPage>("visits/list", { offset, limit: 100 }),
        this.rpc<{ operators: Operator[] }>("visits/operators"),
      ]);
      if (epoch !== this.epoch || !this.isConnected) return;
      this.page = page;
      this.operators = operators.operators;
      this.review = undefined;
      this.resubmitUser = undefined;
      this.uncertain = false;
      this.error = "";
    } catch (error) {
      if (epoch === this.epoch) this.error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private name(id: string) {
    return (
      this.operators.find((item) => item.id === id)?.name ||
      (id === this.hass?.user?.id ? this.t("visit_you") : this.t("visit_operator_unavailable"))
    );
  }
  private date(raw: string | null) {
    return raw ? new Date(raw).toLocaleString(this.hass?.language ?? "en") : "—";
  }
  private snapshot(value: VisitSnapshot) {
    const schedule = value.timing_schedule;
    return html`<p><strong>${value.display_name}</strong> · ${value.employee_no}</p>
      <p>
        ${this.t("responsible_person")}:
        ${value.responsible_person}${value.access_purpose ? html` · ${value.access_purpose}` : nothing}
      </p>
      <p>${this.date(value.valid_from)} — ${this.date(value.valid_until)}</p>
      <p>
        ${value.pin_configured ? this.t("pin") : this.t("visit_no_pin")} · ${this.t("cards")}:
        ${value.enabled_cards}
      </p>
      <ul>
        ${Object.entries(value.doors).map(([id, locks]) => html`<li>${this.stations.find((station) => station.id === id)?.name ?? this.t("visit_missing_station")} · ${this.t("guest_doors")}: ${locks.join(", ")}</li>`)}
      </ul>
      ${schedule ? html`<p>${(schedule.mode === "weekly" ? schedule.days.map((day) => this.t("day_" + day)) : schedule.dates).join(", ")} · ${schedule.periods.map((period) => period.start + "–" + period.end).join(", ")} · ${schedule.timezone}</p>` : nothing}`;
  }
  private current(row: VisitRequest) {
    return this.page?.items.find((item) => item.user_id === row.user_id)?.id === row.id;
  }
  private async prepareResubmit(row: VisitRequest) {
    if (!this.canManage || this.busy || this.uncertain) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      const user = await this.rpc<Person>("users/get", { user_id: row.user_id });
      if (epoch !== this.epoch || !this.isConnected || !this.canManage) return;
      if (user.active) throw { code: "visit_inactive_required" };
      this.resubmitUser = user;
      this.approver = "";
      this.review = undefined;
    } catch (error) {
      if (epoch === this.epoch) this.error = this.t((error as { code?: string }).code ?? "failed");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private async submitDecision() {
    if (!this.canManage || this.busy || this.uncertain || (!this.review && !this.resubmitUser))
      return;
    const epoch = this.epoch,
      review = this.review,
      user = this.resubmitUser;
    if (user && !this.approver) {
      this.error = this.t("visit_choose_approver");
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      if (review)
        await this.rpc("visits/decide", {
          request_id: review.row.id,
          revision: review.row.revision,
          decision: review.decision,
        });
      else if (user)
        await this.rpc("visits/request", {
          user_id: user.id,
          revision: user.revision,
          approver_id: this.approver,
        });
      if (epoch !== this.epoch || !this.isConnected || !this.canManage) return;
      this.notice = this.t(
        review?.decision === "approve"
          ? "visit_approved_sync"
          : review
            ? "visit_decision_saved"
            : "visit_request_saved",
      );
      this.dispatchEvent(new CustomEvent("visit-changed", { bubbles: true, composed: true }));
      this.review = undefined;
      this.resubmitUser = undefined;
      this.busy = false;
      await this.load();
    } catch (error) {
      if (epoch === this.epoch) {
        const code = (error as { code?: string }).code ?? "failed";
        this.error = this.t(code);
        this.uncertain = ["connection_lost", "revision_conflict", "visit_request_stale"].includes(
          code,
        );
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  render() {
    const rows =
      this.page?.items.filter((row) => this.filter === "all" || row.status === this.filter) ?? [];
    const actor = this.hass?.user?.id;
    const blocked = this.busy || this.uncertain || !this.canManage;
    return html`<div class="row heading">
        <h2>${this.t("visit_requests")}</h2>
        <button type="button" ?disabled=${this.busy} @click=${() => void this.load()}>
          ${this.t("refresh")}
        </button>
      </div>
      <p class="sub">${this.t("visit_queue_hint")}</p>
      <label
        >${this.t("status")}<select
          .value=${this.filter}
          @change=${(e: Event) => {
        this.filter = (e.target as HTMLSelectElement).value;
      }}
        >
          ${["pending", "approved", "rejected", "cancelled", "superseded", "all"].map((status) => html`<option value=${status}>${this.t("visit_status_" + status)}</option>`)}
        </select></label
      >
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.uncertain ? html`<p class="notice">${this.t("visit_refresh_before_retry")}</p>` : nothing}${this.notice ? html`<p role="status">${this.notice}</p>` : nothing}
      ${
        this.review
          ? html`<section class="review" role="region" aria-label=${this.t("visit_review")}>
              <h3>${this.t("visit_review")}</h3>
              ${this.snapshot(this.review.row.snapshot)}
              <p>${this.t("visit_approver")}: ${this.name(this.review.row.approver_id)}</p>
              <p>${this.t("visit_confirm_" + this.review.decision)}</p>
              <div class="row actions">
                <button
                  type="button"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.review = undefined;
                  }}
                >
                  ${this.t("cancel")}</button
                ><button
                  type="button"
                  class="primary"
                  ?disabled=${blocked}
                  @click=${() => void this.submitDecision()}
                >
                  ${this.t("visit_confirm_decision")}
                </button>
              </div>
            </section>`
          : nothing
      }
      ${
        this.resubmitUser
          ? html`<section class="review" role="region" aria-label=${this.t("visit_resubmit")}>
              <h3>${this.t("visit_resubmit")}</h3>
              ${this.snapshot({
                display_name: this.resubmitUser.display_name,
                employee_no: this.resubmitUser.employee_no,
                access_category: this.resubmitUser.access_category ?? "visitor",
                responsible_person: this.resubmitUser.responsible_person ?? "",
                access_purpose: this.resubmitUser.access_purpose ?? "",
                valid_from: this.resubmitUser.valid_from,
                valid_until: this.resubmitUser.valid_until,
                pin_configured: this.resubmitUser.pin_configured,
                enabled_cards: this.resubmitUser.cards.filter((card) => card.enabled).length,
                doors: Object.fromEntries(
                  Object.entries(this.resubmitUser.assignments)
                    .filter(([, item]) => item.enabled)
                    .map(([id, item]) => [id, item.allowed_locks]),
                ),
                timing_schedule: this.resubmitUser.access_timing_policy?.schedule ?? null,
              })}<label
                >${this.t("visit_approver")}<select
                  .value=${this.approver}
                  @change=${(e: Event) => {
                    this.approver = (e.target as HTMLSelectElement).value;
                  }}
                >
                  <option value="">${this.t("visit_choose_approver")}</option>
                  ${this.operators.filter((item) => item.id !== actor).map((item) => html`<option value=${item.id}>${item.name || item.id}</option>`)}
                </select></label
              >
              <div class="row actions">
                <button
                  type="button"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.resubmitUser = undefined;
                  }}
                >
                  ${this.t("cancel")}</button
                ><button
                  type="button"
                  class="primary"
                  ?disabled=${blocked || !this.approver}
                  @click=${() => void this.submitDecision()}
                >
                  ${this.t("visit_send_request")}
                </button>
              </div>
            </section>`
          : nothing
      }
      ${this.page && !rows.length ? html`<p>${this.t("visit_empty")}</p>` : nothing}
      <div class="cards">
        ${rows.map(
        (row) =>
          html`<article>
            <div class="row heading">
              <h3>${row.snapshot.display_name}</h3>
              <span class="tag">${this.t("visit_status_" + row.status)}</span>
            </div>
            ${this.snapshot(row.snapshot)}
            <p class="sub">
              ${this.t("visit_approver")}: ${this.name(row.approver_id)} ·
              ${this.date(row.requested_at)}
            </p>
            ${row.decided_at ? html`<p class="sub">${this.t("visit_decided_by")}: ${this.name(row.decided_by)} · ${this.date(row.decided_at)}</p>` : nothing}${row.stale ? html`<p class="notice">${this.t("visit_request_stale")}</p>` : nothing}${row.user_deleted ? html`<p class="notice">${this.t("user_not_found")}</p>` : nothing}
            ${
          this.canManage && row.status === "pending"
            ? html`<div class="row actions">
                ${
                  actor === row.approver_id
                    ? html`<button
                          type="button"
                          ?disabled=${blocked || row.stale || row.user_deleted}
                          @click=${() => {
                            this.review = { row, decision: "approve" };
                            this.resubmitUser = undefined;
                          }}
                        >
                          ${this.t("visit_approve")}</button
                        ><button
                          type="button"
                          class="danger"
                          ?disabled=${blocked}
                          @click=${() => {
                            this.review = { row, decision: "reject" };
                            this.resubmitUser = undefined;
                          }}
                        >
                          ${this.t("visit_reject")}
                        </button>`
                    : nothing
                }${
                  actor === row.requested_by || actor === row.approver_id
                    ? html`<button
                        type="button"
                        ?disabled=${blocked}
                        @click=${() => {
                          this.review = { row, decision: "cancel" };
                          this.resubmitUser = undefined;
                        }}
                      >
                        ${this.t("visit_cancel_request")}
                      </button>`
                    : nothing
                }
              </div>`
            : nothing
        }
            ${this.canManage && this.current(row) && !row.user_deleted && (row.stale || ["cancelled", "rejected"].includes(row.status)) ? html`<button type="button" ?disabled=${blocked} @click=${() => void this.prepareResubmit(row)}>${this.t("visit_resubmit")}</button>` : nothing}
          </article>`,
      )}
      </div>
      ${this.page ? html`<div class="row actions"><span class="sub">${this.page.offset + 1}–${this.page.offset + this.page.items.length} / ${this.page.total}</span><button type="button" ?disabled=${this.busy || !this.page.offset} @click=${() => void this.load(Math.max(0, this.page!.offset - 100))}>${this.t("previous")}</button><button type="button" ?disabled=${this.busy || this.page.next_offset === null} @click=${() => void this.load(this.page!.next_offset!)}>${this.t("next")}</button></div>` : nothing}`;
  }
}
customElements.define("wiskey-visit-requests", VisitRequestsPanel);
