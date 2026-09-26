import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { downloadText } from "./download";
import { translate } from "./i18n";
import { boundedRequest } from "./request";
import { formatTime, UTC_ZONE, type DisplayZone } from "./time";
import type { Hass } from "./types";

interface LifecycleUser {
  id: string;
  display_name: string;
  employee_no: string;
  phone: string;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  pin_configured: boolean;
  card_count: number;
  enabled_card_count: number;
  assignment_count: number;
  group_ids: string[];
}
interface Expiration extends LifecycleUser {
  state: "expired" | "expiring";
  seconds_remaining: number;
}
interface DuplicateGroup {
  reason: "display_name" | "phone" | "card_last4" | "employee_no";
  match: string | null;
  users: LifecycleUser[];
}
interface LifecycleReport {
  format: string;
  generated_at: string;
  warning_days: number;
  summary: {
    total: number;
    active: number;
    scheduled: number;
    expired: number;
    expiring: number;
    without_credentials: number;
    duplicate_groups: number;
    duplicate_users: number;
  };
  expirations: Expiration[];
  duplicates: DuplicateGroup[];
  without_credentials: LifecycleUser[];
  truncated: Record<string, boolean>;
  privacy: string;
}

export class IdentityLifecycle extends LitElement {
  static styles = [
    css`
      :host {
        display: block;
        color: var(--ink, var(--primary-text-color));
      }
      .heading,
      .toolbar,
      .row,
      .person,
      .group-head {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .heading {
        justify-content: space-between;
        margin-bottom: 14px;
      }
      h2,
      h3,
      p {
        margin: 0;
      }
      .sub {
        color: var(--muted, var(--secondary-text-color));
      }
      .toolbar {
        background: var(--surface, var(--card-background-color));
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
        padding: 10px 12px;
        justify-content: space-between;
      }
      .toolbar label {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      select,
      button {
        min-height: 40px;
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 9px;
        background: var(--surface, var(--card-background-color));
        color: inherit;
        padding: 7px 11px;
        font: inherit;
      }
      button {
        cursor: pointer;
        font-weight: 700;
      }
      button:disabled {
        cursor: wait;
        opacity: 0.6;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(6, minmax(105px, 1fr));
        gap: 10px;
        margin: 14px 0;
      }
      .metric,
      article,
      .empty {
        background: var(--surface, var(--card-background-color));
        border: 1px solid var(--divider-color, #dce5e6);
        border-radius: 12px;
      }
      .metric {
        padding: 12px;
      }
      .metric strong {
        display: block;
        font-size: 1.45rem;
        line-height: 1.1;
      }
      .metric.warning strong {
        color: var(--warning-color, #9a6500);
      }
      .metric.danger strong {
        color: var(--error-color, #c83f48);
      }
      .columns {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
        gap: 14px;
        align-items: start;
      }
      section > h3 {
        margin: 6px 0 9px;
      }
      .list {
        display: grid;
        gap: 9px;
      }
      article {
        padding: 12px;
      }
      .person,
      .group-head {
        justify-content: space-between;
      }
      .identity {
        min-width: 0;
      }
      .identity strong,
      .identity small {
        display: block;
      }
      .identity strong {
        overflow-wrap: anywhere;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 9px;
        background: var(--secondary-background-color, #edf3f4);
        font-size: 0.86rem;
      }
      .badge.expired {
        color: var(--error-color, #c83f48);
        background: #ffecef;
      }
      .badge.expiring {
        color: #875a00;
        background: #fff4d6;
      }
      .members {
        display: grid;
        gap: 7px;
        margin-top: 10px;
      }
      .members .person {
        padding-top: 7px;
        border-top: 1px solid var(--divider-color, #e5e9ea);
      }
      .empty,
      .error {
        padding: 16px;
      }
      .error {
        color: var(--error-color, #c83f48);
      }
      .truncated {
        margin-top: 8px;
        color: var(--warning-color, #9a6500);
      }
      @media (max-width: 1050px) {
        .summary {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @media (max-width: 720px) {
        .columns {
          grid-template-columns: 1fr;
        }
        .summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .heading,
        .toolbar {
          align-items: stretch;
        }
        .toolbar > *,
        .toolbar .row {
          width: 100%;
        }
        .toolbar select,
        .toolbar button {
          flex: 1;
        }
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    zone: { attribute: false },
    _report: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _days: { state: true },
  };
  hass?: Hass;
  zone: DisplayZone = UTC_ZONE;
  private _report?: LifecycleReport;
  private _busy = false;
  private _error = "";
  private _days = 30;
  private request?: AbortController;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }
  disconnectedCallback() {
    this.request?.abort();
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    if (changed.has("hass") && changed.get("hass")) void this.load();
  }
  private async load() {
    if (!this.hass || this.hass.connection.connected === false || this._busy) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this._busy = true;
    try {
      const result = await boundedRequest<LifecycleReport>(
        () =>
          this.hass!.callWS({
            type: "smplwise_access_control/users/lifecycle",
            api_contract: 1,
            warning_days: this._days,
          }),
        30000,
        request.signal,
      );
      if (request !== this.request) return;
      this._report = result;
      this._error = "";
    } catch (error) {
      if (!request.signal.aborted)
        this._error = this.t((error as { code?: string })?.code ?? "lifecycle_load_failed");
    } finally {
      if (request === this.request) {
        this.request = undefined;
        this._busy = false;
      }
    }
  }
  private open(user: LifecycleUser) {
    this.dispatchEvent(
      new CustomEvent("open-user", { detail: user.id, bubbles: true, composed: true }),
    );
  }
  private exportReport() {
    if (!this._report) return;
    const stamp = this._report.generated_at.slice(0, 10);
    downloadText(
      JSON.stringify(this._report, null, 2),
      `wiskey-identity-lifecycle-${stamp}.json`,
      "application/json;charset=utf-8",
    );
  }
  private person(user: LifecycleUser, extra: unknown = nothing) {
    return html`<div class="person">
      <div class="identity">
        <strong>${user.display_name}</strong>
        <small class="sub"
          ><bdi>${user.employee_no}</bdi
          >${user.phone ? html` · <bdi dir="ltr">${user.phone}</bdi>` : nothing}</small
        >
      </div>
      ${extra}
      <button @click=${() => this.open(user)}>${this.t("lifecycle_open_user")}</button>
    </div>`;
  }
  private truncated(key: string) {
    return this._report?.truncated[key]
      ? html`<p class="truncated">${this.t("lifecycle_truncated")}</p>`
      : nothing;
  }
  render() {
    const report = this._report;
    return html`<div class="heading">
        <div>
          <h2>${this.t("identity_lifecycle")}</h2>
          <p class="sub">${this.t("lifecycle_intro")}</p>
        </div>
      </div>
      <div class="toolbar">
        <label
          >${this.t("lifecycle_warning_days")}
          <select
            .value=${String(this._days)}
            @change=${(event: Event) => {
              this._days = Number((event.target as HTMLSelectElement).value);
              void this.load();
            }}
          >
            ${[7, 30, 60, 90, 180].map((days) => html`<option value=${days}>${days}</option>`)}
          </select></label
        >
        <div class="row">
          <button @click=${() => void this.load()} ?disabled=${this._busy}>
            ${this.t("lifecycle_refresh")}
          </button>
          <button @click=${() => this.exportReport()} ?disabled=${!report}>
            ${this.t("lifecycle_export")}
          </button>
        </div>
      </div>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      ${
        !report
          ? html`<p class="empty">${this.t(this._busy ? "loading" : "lifecycle_none")}</p>`
          : html`
              <div class="summary">
                ${[
                  ["lifecycle_total", report.summary.total, ""],
                  ["lifecycle_active", report.summary.active, ""],
                  ["lifecycle_expiring", report.summary.expiring, "warning"],
                  ["lifecycle_expired", report.summary.expired, "danger"],
                  ["lifecycle_duplicate_users", report.summary.duplicate_users, "warning"],
                  ["lifecycle_without_credentials", report.summary.without_credentials, "warning"],
                ].map(
                  ([label, count, klass]) =>
                    html`<div class="metric ${klass}">
                      <strong>${count}</strong><span>${this.t(String(label))}</span>
                    </div>`,
                )}
              </div>
              <div class="columns">
                <section>
                  <h3>${this.t("lifecycle_expirations")}</h3>
                  <div class="list">
                    ${
                      report.expirations.length
                        ? report.expirations.map((item) =>
                            this.person(
                              item,
                              html`<span class="badge ${item.state}"
                                >${this.t("lifecycle_status_" + item.state)} ·
                                ${formatTime(item.valid_until, this.hass?.language, this.zone)}</span
                              >`,
                            ),
                          )
                        : html`<p class="empty">${this.t("lifecycle_none")}</p>`
                    }
                  </div>
                  ${this.truncated("expirations")}
                  <h3>${this.t("lifecycle_missing_credentials")}</h3>
                  <div class="list">
                    ${
                      report.without_credentials.length
                        ? report.without_credentials.map(
                            (item) => html`<article>${this.person(item)}</article>`,
                          )
                        : html`<p class="empty">${this.t("lifecycle_none")}</p>`
                    }
                  </div>
                  ${this.truncated("without_credentials")}
                </section>
                <section>
                  <h3>${this.t("lifecycle_duplicates")}</h3>
                  <div class="list">
                    ${
                      report.duplicates.length
                        ? report.duplicates.map(
                            (group) =>
                              html`<article>
                                <div class="group-head">
                                  <strong>${this.t("lifecycle_reason_" + group.reason)}</strong>
                                  ${group.match ? html`<span class="badge"><bdi>${group.match}</bdi></span>` : nothing}
                                </div>
                                <div class="members">
                                  ${group.users.map((item) => this.person(item))}
                                </div>
                              </article>`,
                          )
                        : html`<p class="empty">${this.t("lifecycle_none")}</p>`
                    }
                  </div>
                  ${this.truncated("duplicates")}
                </section>
              </div>
              <p class="sub">
                ${this.t("lifecycle_generated")}:
                ${formatTime(report.generated_at, this.hass?.language, this.zone)}
              </p>
            `
      }`;
  }
}

customElements.define("wiskey-identity-lifecycle", IdentityLifecycle);
