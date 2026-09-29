import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import type { Hass, Person, Station } from "./types";
interface Scenario {
  desired: { allowed: boolean; reason: string; timing_mode: string; draft_ignored: boolean };
  observed: {
    sync_state: string;
    last_sync_at: string | null;
    revision_matches: boolean;
    timing: {
      status: string;
      checked_at?: string;
      valid_from?: string;
      valid_until?: string;
      interval_contains_target?: boolean | null;
    };
  };
  station_status: string;
  physical_result: string;
}
const copy: Record<string, [string, string]> = {
  title: ["Check access scenario", "בדיקת תרחיש גישה"],
  station: ["Station", "תחנה"],
  lock: ["Door", "דלת"],
  at: ["Date and time with UTC offset", "תאריך ושעה כולל היסט UTC"],
  run: ["Check scenario", "בדוק תרחיש"],
  wait: ["Checking…", "בודק…"],
  desired: ["Central access policy", "מדיניות ההרשאה במערכת"],
  allowed: ["Expected to allow", "צפי להרשאה"],
  denied: ["Expected to deny", "צפי לדחייה"],
  observed: ["Last synchronization evidence", "מידע מהסנכרון האחרון"],
  historical: ["Historical time interval readback", "חלון זמנים שנקרא בעבר מהתחנה"],
  previous_policy: ["Readback belongs to a previous policy", "האימות שייך למדיניות קודמת"],
  unavailable: ["No verified time interval available", "אין חלון זמנים מאומת זמין"],
  synced: ["Synchronized", "מסונכרן"],
  pending: ["Synchronization not confirmed", "הסנכרון לא אושר"],
  no_assignment: ["No station permission", "אין הרשאה לתחנה"],
  lock_not_assigned: ["Door not assigned", "אין הרשאה לדלת"],
  inactive: ["Person inactive", "המשתמש לא פעיל"],
  archived: ["Person archived", "המשתמש בארכיון"],
  outside_validity: ["Outside validity dates", "מחוץ לתקופת התוקף"],
  outside_schedule: ["Outside allowed days or hours", "מחוץ לימי או שעות הכניסה"],
  draft: [
    "Draft schedule is ignored because it is not enforced",
    "טיוטת הזמנים אינה נאכפת ולכן אינה נכללת בחישוב",
  ],
  disclaimer: [
    "Read-only prediction. Historical synchronization does not verify the current device clock, credentials or admission at the physical door.",
    "תחזית לקריאה בלבד. סנכרון בעבר אינו מאמת את שעון התחנה כעת, את אמצעי הזיהוי או כניסה בפועל בדלת.",
  ],
  invalid: [
    "Could not check. Use an ISO date with offset, for example 2026-09-29T12:00:00+03:00, and choose a station.",
    "לא ניתן לבדוק. בחר תחנה והזן תאריך ISO עם היסט, לדוגמה 2026-09-29T12:00:00+03:00.",
  ],
  inside: ["Requested time is inside the recorded interval", "המועד שבחרת נמצא בחלון שנקרא"],
  outside: ["Requested time is outside the recorded interval", "המועד שבחרת מחוץ לחלון שנקרא"],
  noStations: ["No visible assigned stations", "אין תחנות מורשות להצגה"],
};
export class AccessScenario extends LitElement {
  static properties = {
    hass: { attribute: false },
    person: { attribute: false },
    stations: { attribute: false },
    station: { state: true },
    lock: { state: true },
    at: { state: true },
    result: { state: true },
    busy: { state: true },
    error: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        background: transparent;
        height: auto;
      }
      details {
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 10px;
        margin-block: 10px;
      }
      summary {
        cursor: pointer;
        font-weight: 600;
      }
      .inputs {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 90px;
        gap: 8px;
        margin-block: 10px;
      }
      .time {
        grid-column: 1/-1;
      }
      input,
      select {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      label {
        display: grid;
        gap: 4px;
      }
      article {
        margin-block: 8px;
        padding: 8px;
        background: var(--secondary-background-color);
        border-radius: 6px;
      }
      p {
        margin: 6px 0;
        overflow-wrap: anywhere;
        font-size: 13px;
      }
      h4 {
        margin: 0 0 6px;
      }
      bdi {
        overflow-wrap: anywhere;
      }
      .note {
        color: var(--secondary-text-color);
      }
      .error {
        color: var(--error-color);
      }
    `,
  ];
  hass?: Hass;
  person?: Person;
  stations: Station[] = [];
  private station = "";
  private lock = 1;
  private at = new Date().toISOString();
  private result?: Scenario;
  private busy = false;
  private error = false;
  private epoch = 0;
  private key = "";
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(() => this.hass);
  private t(k: string) {
    return copy[k]?.[this.hass?.language?.startsWith("he") ? 1 : 0] ?? k;
  }
  private clear() {
    this.epoch++;
    this.requests.cancel();
    this.result = undefined;
    this.busy = false;
    this.error = false;
  }
  disconnectedCallback() {
    this.clear();
    super.disconnectedCallback();
  }
  protected updated(_changed: PropertyValues) {
    const key = `${this.hass?.user?.id}:${this.person?.id}:${this.person?.revision}:${JSON.stringify(this.person?.assignments)}`;
    if (
      key !== this.key ||
      this.connection !== this.hass?.connection ||
      !this.hass?.user?.is_admin ||
      this.hass.connection.connected === false
    ) {
      this.key = key;
      this.connection = this.hass?.connection;
      this.clear();
    }
    const choices = this.choices();
    if (!choices.some((s) => s.id === this.station)) this.station = choices[0]?.id ?? "";
  }
  private choices() {
    return this.stations.filter((s) => this.person?.assignments[s.id]?.enabled);
  }
  private async check() {
    this.clear();
    const epoch = this.epoch;
    this.busy = true;
    try {
      const result = await this.requests.run<Scenario>({
        type: "hikvision_intercom/users/access_scenario",
        user_id: this.person?.id,
        station_id: this.station,
        lock_id: this.lock,
        at: this.at,
      });
      if (epoch === this.epoch) this.result = result;
    } catch {
      if (epoch === this.epoch) this.error = true;
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private output() {
    if (!this.result) return nothing;
    const r = this.result,
      t = r.observed.timing;
    return html`<div role="status">
      <article>
        <h4>${this.t("desired")}</h4>
        <p>
          <strong>${this.t(r.desired.allowed ? "allowed" : "denied")}</strong
          >${r.desired.allowed ? nothing : html` · ${this.t(r.desired.reason)}`}
        </p>
        ${r.desired.draft_ignored ? html`<p>${this.t("draft")}</p>` : nothing}
      </article>
      <article>
        <h4>${this.t("observed")}</h4>
        <p>
          ${this.t(r.observed.sync_state === "synced" && r.observed.revision_matches ? "synced" : "pending")}
          · <bdi>${r.observed.last_sync_at ?? "—"}</bdi>
        </p>
        <p>${this.t(t.status)}</p>
        ${
          t.checked_at
            ? html`<p><bdi>${t.checked_at}</bdi></p>
                <p><bdi>${t.valid_from ?? "—"} → ${t.valid_until ?? "—"}</bdi></p>`
            : nothing
        }${typeof t.interval_contains_target === "boolean" ? html`<p>${this.t(t.interval_contains_target ? "inside" : "outside")}</p>` : nothing}
      </article>
      <p class="note">${this.t("disclaimer")}</p>
    </div>`;
  }
  render() {
    if (
      !this.hass?.user?.is_admin ||
      !this.person ||
      this.person.redacted_fields?.includes("access")
    )
      return nothing;
    return html`<details>
      <summary>${this.t("title")}</summary>
      ${
        this.choices().length
          ? html`<div class="inputs">
                <label
                  >${this.t("station")}<select
                    aria-label=${this.t("station")}
                    .value=${this.station}
                    @change=${(e: Event) => {
                      this.clear();
                      this.station = (e.target as HTMLSelectElement).value;
                    }}
                  >
                    ${this.choices().map((s) => html`<option value=${s.id}>${s.name}</option>`)}
                  </select></label
                ><label
                  >${this.t("lock")}<select
                    aria-label=${this.t("lock")}
                    .value=${String(this.lock)}
                    @change=${(e: Event) => {
                      this.clear();
                      this.lock = Number((e.target as HTMLSelectElement).value);
                    }}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select></label
                ><label class="time"
                  >${this.t("at")}<input
                    dir="ltr"
                    maxlength="48"
                    .value=${this.at}
                    @input=${(e: Event) => {
                      this.clear();
                      this.at = (e.target as HTMLInputElement).value;
                    }}
                /></label>
              </div>
              <button
                ?disabled=${this.busy || !this.station || !this.at.trim()}
                @click=${() => this.check()}
              >
                ${this.t(this.busy ? "wait" : "run")}
              </button>`
          : html`<p>${this.t("noStations")}</p>`
      }${this.error ? html`<p class="error" role="alert">${this.t("invalid")}</p>` : nothing}${this.output()}
    </details>`;
  }
}
customElements.define("wiskey-access-scenario", AccessScenario);
