import { LitElement, html, nothing } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import type { Hass } from "./types";

interface Pending {
  review_id: string;
  own_request: boolean;
  state: string;
  station_count: number;
  remaining_seconds: number;
}
interface Plan extends Pending {
  fingerprint: string;
  rows: {
    name: string;
    door: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[];
}

export class FleetApproval extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    rows: { state: true },
    plan: { state: true },
    busy: { state: true },
    error: { state: true },
  };
  hass?: Hass;
  private rows: Pending[] = [];
  private plan?: Plan;
  private busy = false;
  private error = "";
  private actor = "";
  private timer?: ReturnType<typeof setTimeout>;
  private requests = new ScopedRequests(() => this.hass);
  private text(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.timer);
    this.requests.cancel();
    this.rows = [];
    this.plan = undefined;
  }
  protected updated(changed: Map<string, unknown>) {
    if (!changed.has("hass")) return;
    const actor = this.hass?.user?.id ?? "";
    if (
      actor !== this.actor ||
      !this.hass?.user?.is_admin ||
      this.hass.connection.connected === false
    ) {
      this.actor = actor;
      this.requests.cancel();
      this.rows = [];
      this.plan = undefined;
      this.error = "";
      this.busy = false;
      void this.load();
    }
  }
  private async api<T>(command: string, values = {}) {
    return this.requests.run<T>(
      { type: "hikvision_intercom/platform/config_" + command, ...values },
      20000,
    );
  }
  private async load() {
    if (
      !this.isConnected ||
      this.busy ||
      !this.hass?.user?.is_admin ||
      this.hass.connection.connected === false
    )
      return;
    this.busy = true;
    try {
      this.rows = (await this.api<{ records: Pending[] }>("pending")).records;
    } catch {
      /* Optional endpoint; existing configuration remains usable. */
    } finally {
      this.busy = false;
      clearTimeout(this.timer);
      if (this.isConnected) this.timer = setTimeout(() => void this.load(), 5000);
    }
  }
  private async inspect(row: Pending) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.plan = undefined;
    try {
      this.plan = await this.api<Plan>("review", { review_id: row.review_id });
    } catch {
      this.error = this.text(
        "Review expired or changed. Prepare a fresh preview.",
        "הסקירה פגה או השתנתה. יש להכין תצוגה מקדימה חדשה.",
      );
    } finally {
      this.busy = false;
    }
  }
  private async decide(approve: boolean) {
    const plan = this.plan;
    if (this.busy || !plan || plan.own_request || plan.state !== "pending") return;
    this.busy = true;
    this.error = "";
    try {
      await this.api("decide", {
        review_id: plan.review_id,
        fingerprint: plan.fingerprint,
        approve,
        confirmed: true,
      });
      this.plan = undefined;
    } catch {
      this.error = this.text(
        "Consent could not be verified. Read a fresh review before another attempt.",
        "לא ניתן לאמת את האישור. יש לקרוא סקירה חדשה לפני ניסיון נוסף.",
      );
      this.plan = undefined;
    } finally {
      this.busy = false;
      void this.load();
    }
  }
  private values(values: Record<string, unknown>) {
    return html`<dl>
      ${Object.entries(values).map(
        ([key, value]) =>
          html`<div>
            <dt>
              ${key === "openDuration" ? this.text("Opening duration (seconds)", "משך פתיחה בשניות") : key === "doorName" ? this.text("Door name", "שם הדלת") : key}
            </dt>
            <dd style="margin:0;overflow-wrap:anywhere">${String(value)}</dd>
          </div>`,
      )}
    </dl>`;
  }
  render() {
    if (!this.hass?.user?.is_admin || !this.rows.length) return nothing;
    return html`<section class="fleet-approval">
      <h3>${this.text("Second approval for fleet changes", "אישור נוסף לשינויי צי")}</h3>
      <p>
        ${this.text("Previews expire after five minutes and on restart. Approval does not write settings: the requester applies the reviewed plan explicitly.", "סקירות פגות לאחר חמש דקות ובאתחול. האישור אינו כותב הגדרות: המקים מחיל במפורש את התוכנית שנסקרה.")}
      </p>
      ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}
      ${this.rows.map(
        (row) =>
          html`<article class="card">
            <p>
              ${row.station_count} ${this.text("stations", "תחנות")} ·
              ${row.own_request ? this.text("Your preview", "הסקירה שלך") : this.text("Another operator's preview", "סקירת מפעיל נוסף")}
              ·
              ${this.text(row.state === "approved" ? "Approved" : row.state === "rejected" ? "Rejected" : "Awaiting review", row.state === "approved" ? "מאושר" : row.state === "rejected" ? "נדחה" : "ממתין לסקירה")}
            </p>
            <button ?disabled=${this.busy} @click=${() => this.inspect(row)}>
              ${this.text("Review fleet changes", "סקירת שינויי צי")}
            </button>
          </article>`,
      )}
      ${
        this.plan
          ? html`<article class="card fleet-consent-plan">
              <h4>${this.text("Changes proposed", "השינויים המוצעים")}</h4>
              ${this.plan.rows.map(
                (row) =>
                  html`<section class="card">
                    <strong>${row.name} · ${this.text("Door", "דלת")} ${row.door}</strong>
                    <div class="grid">
                      <section>
                        <b>${this.text("Before", "לפני")}</b>${this.values(row.before)}
                      </section>
                      <section>
                        <b>${this.text("After", "אחרי")}</b>${this.values(row.after)}
                      </section>
                    </div>
                  </section>`,
              )}
              <div class="actions">
                ${!this.plan.own_request && this.plan.state === "pending" ? html`<button ?disabled=${this.busy} @click=${() => this.decide(true)}>${this.text("Approve fleet changes", "אישור שינויי הצי")}</button><button ?disabled=${this.busy} @click=${() => this.decide(false)}>${this.text("Reject fleet changes", "דחיית שינויי הצי")}</button>` : nothing}<button
                  ?disabled=${this.busy}
                  @click=${() => (this.plan = undefined)}
                >
                  ${this.text("Close review", "סגירת סקירה")}
                </button>
              </div>
            </article>`
          : nothing
      }
    </section>`;
  }
}
customElements.define("wiskey-fleet-approval", FleetApproval);
