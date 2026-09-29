import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import type { Hass } from "./types";

interface Review {
  affected_people: number;
  rows_complete: boolean;
  row_budget: number;
  known_bindings: number;
  unknown_owners: number | null;
  pending_cleanup: Record<string, number>;
  blockers: string[];
  groups: { label: string; enabled: boolean; before: string[]; after: string[] }[];
  stations: {
    id: string;
    name: string;
    identity_verified: boolean;
    error: string | null;
    mappings: { physical_index: number; api_id: number; name: string | null }[];
  }[];
  rows: {
    user_id: string;
    display_name: string;
    active: boolean;
    source_permission: string;
    locks: number[];
    before: string[];
    after: string[] | null;
    native_schedule: boolean;
  }[];
}

class StationLifecycleReview extends LitElement {
  static properties = {
    hass: { attribute: false },
    catalog: { attribute: false },
    source: { state: true },
    target: { state: true },
    busy: { state: true },
    review: { state: true },
    error: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      article {
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        padding: 16px;
        margin-block: 12px;
        background: var(--surface);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 12px;
      }
      label {
        display: grid;
        gap: 6px;
      }
      select {
        width: 100%;
        min-width: 0;
        padding: 9px;
        color: var(--ink);
        background: var(--surface);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        font: inherit;
      }
      button {
        margin-block: 12px;
        min-height: 40px;
      }
      .scroll {
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 8px;
        text-align: start;
        border-bottom: 1px solid var(--divider-color);
      }
      .metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-block: 12px;
      }
      .metrics span {
        padding: 8px;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
      }
      p {
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--error-color);
      }
    `,
  ];
  hass?: Hass;
  catalog: Record<string, string> = {};
  private source = "";
  private target = "";
  private busy = false;
  private review?: Review;
  private error = "";
  private epoch = 0;
  private session = "";
  private requests = new ScopedRequests(() => this.hass);
  private copy(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  private clear() {
    this.epoch++;
    this.requests.cancel();
    this.review = undefined;
    this.error = "";
    this.busy = false;
    this.source = this.target = "";
  }
  protected updated(changes: PropertyValues) {
    const session = `${this.hass?.user?.id ?? ""}:${!!this.hass?.user?.is_admin}:${this.hass?.connection.connected !== false}`;
    if (session !== this.session) {
      this.session = session;
      this.clear();
    }
    if (
      changes.has("catalog") &&
      ((this.source && !this.catalog[this.source]) || (this.target && !this.catalog[this.target]))
    )
      this.clear();
  }
  disconnectedCallback() {
    this.clear();
    super.disconnectedCallback();
  }
  private picker(target: boolean) {
    const selected = target ? this.target : this.source;
    const label = target
      ? this.copy("Replacement station", "תחנה חלופית")
      : this.copy("Source station", "תחנת מקור");
    return html`<label
      >${label}<select
        aria-label=${label}
        ?disabled=${this.busy}
        .value=${selected}
        @change=${(event: Event) => {
          const value = (event.target as HTMLSelectElement).value;
          if (target) this.target = value;
          else {
            this.source = value;
            if (this.target === value) this.target = "";
          }
          this.review = undefined;
          this.error = "";
        }}
      >
        <option value="">
          ${target ? this.copy("Review retirement without a replacement", "סקירת הוצאה משימוש ללא חלופה") : this.copy("Choose a station", "בחר תחנה")}
        </option>
        ${Object.entries(this.catalog)
          .filter(([id]) => !target || id !== this.source)
          .map(
            ([id, name]) => html`<option value=${id} ?selected=${id === selected}>${name}</option>`,
          )}
      </select></label
    >`;
  }
  private async inspect() {
    if (
      this.busy ||
      !this.source ||
      !this.hass?.user?.is_admin ||
      this.hass.connection.connected === false
    )
      return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = "";
    this.review = undefined;
    try {
      const review = await this.requests.run<Review>(
        {
          type: "hikvision_intercom/platform/lifecycle_review",
          api_contract: 1,
          source_id: this.source,
          target_id: this.target,
        },
        60000,
      );
      if (epoch === this.epoch && this.isConnected) this.review = review;
    } catch {
      if (epoch === this.epoch)
        this.error = this.copy(
          "The review changed or could not be read. Read it again before making a decision.",
          "הנתונים השתנו או שלא ניתן לקרוא את הסקירה. יש לקרוא שוב לפני קבלת החלטה.",
        );
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private names(ids: string[]) {
    return ids.map((id) => this.catalog[id] ?? id).join(", ") || "—";
  }
  private blocker(code: string) {
    const messages: Record<string, [string, string]> = {
      target_ownership_unverified: [
        "Replacement inventory has not been observed; ownership is unknown.",
        "טרם נצפה מלאי התחנה החלופית; הבעלות אינה ידועה.",
      ],
      target_contains_accounts: [
        "Accounts exist in the replacement inventory. Review their ownership first.",
        "קיימים חשבונות במלאי התחנה החלופית. יש לסקור קודם את בעלותם.",
      ],
      target_already_in_use: [
        "The replacement already has permissions or ownership. Resolve the overlap first.",
        "לתחנה החלופית קיימות הרשאות או בעלות. יש להסדיר את החפיפה תחילה.",
      ],
      target_lock_mapping_incomplete: [
        "The replacement is missing a required physically confirmed lock mapping.",
        "בתחנה החלופית חסר מיפוי מאומת פיזית של מנעול נדרש.",
      ],
      native_schedule_redeployment_required: [
        "Local user schedules need a separate deployment and readback on the replacement.",
        "לוחות משתמש מקומיים דורשים פריסה ואימות נפרדים בתחנה החלופית.",
      ],
      hold_programs_require_separate_review: [
        "Door opening programs need a separate stop/transfer review.",
        "תוכניות פתיחת דלת דורשות סקירה נפרדת לעצירה או להעברה.",
      ],
    };
    return messages[code] ? this.copy(...messages[code]) : code;
  }
  render() {
    if (!this.hass?.user?.is_admin || this.hass.connection.connected === false) return nothing;
    const review = this.review;
    return html`<article>
      <h2>${this.copy("Replacement and retirement impact", "השפעת החלפה והוצאה משימוש")}</h2>
      <p>
        ${this.copy(
          "Read-only review. It does not transfer permissions, revoke credentials or remove a station. An identity check is a network read.",
          "סקירה לקריאה בלבד. היא אינה מעבירה הרשאות, מבטלת אמצעי גישה או מסירה תחנה. אימות הזהות הוא קריאת רשת.",
        )}
      </p>
      <div class="grid">${this.picker(false)}${this.picker(true)}</div>
      <button ?disabled=${this.busy || !this.source} @click=${() => void this.inspect()}>
        ${this.busy ? this.copy("Reading…", "קורא…") : this.copy("Review impact", "סקור השפעה")}
      </button>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${
        review
          ? html`
              <p role="status">
                ${this.copy(
                  "Desired policy projection only. Connection removal is not proof that device credentials were deleted.",
                  "התחזית מתייחסת למדיניות הרצויה בלבד. הסרת חיבור אינה הוכחה למחיקת אמצעי גישה מהציוד.",
                )}
              </p>
              <div class="metrics">
                <span
                  >${this.copy("Affected people", "אנשים מושפעים")}: ${review.affected_people}</span
                >
                <span
                  >${this.copy("Known ownership", "בעלות מוכרת")}: ${review.known_bindings}</span
                >
                <span
                  >${this.copy("Unknown ownership in cached inventory", "בעלות לא מוכרת במלאי השמור")}:
                  ${review.unknown_owners ?? this.copy("Unknown", "לא ידוע")}</span
                >
                <span
                  >${this.copy("Pending cleanup", "ביטולים ממתינים")}:
                  ${Object.values(review.pending_cleanup).reduce((a, b) => a + b, 0)}</span
                >
              </div>
              ${review.stations.map(
                (station) =>
                  html`<p>
                    <strong>${station.name}</strong> ·
                    ${station.identity_verified ? this.copy("Identity verified", "זהות אומתה") : this.copy("Identity not verified", "זהות לא אומתה")}
                    ·
                    ${station.mappings.map((mapping) => `${this.copy("Physical lock", "מנעול פיזי")} ${mapping.physical_index} → API ${mapping.api_id}`).join("; ") || this.copy("No confirmed lock mapping", "אין מיפוי מנעול מאומת")}
                  </p>`,
              )}
              ${
                review.blockers.length
                  ? html`<ul>
                      ${review.blockers.map((code) => html`<li>${this.blocker(code)}</li>`)}
                    </ul>`
                  : nothing
              }
              <h3>${this.copy("Group policy projection", "תחזית מדיניות הקבוצות")}</h3>
              ${
                review.groups.length
                  ? html`<ul>
                      ${review.groups.map(
                        (group) =>
                          html`<li>
                            ${group.label} ·
                            ${group.enabled ? this.copy("Enabled", "פעילה") : this.copy("Disabled", "מושבתת")}
                            · ${this.names(group.before)} → ${this.names(group.after)}
                          </li>`,
                      )}
                    </ul>`
                  : html`<p>—</p>`
              }
              <h3>${this.copy("People and exceptions", "אנשים וחריגים")}</h3>
              <div class="scroll">
                <table aria-label=${this.copy("Lifecycle impact people", "אנשים בסקירת השפעה")}>
                  <thead>
                    <tr>
                      <th>${this.copy("Person", "אדם")}</th>
                      <th>${this.copy("Permission source", "מקור הרשאה")}</th>
                      <th>${this.copy("Current doors", "דלתות כעת")}</th>
                      <th>${this.copy("Projected doors", "דלתות בתחזית")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${review.rows.map(
                      (row) =>
                        html`<tr>
                          <td>
                            ${row.display_name}${!row.active ? html` · ${this.copy("Inactive", "לא פעיל")}` : nothing}
                          </td>
                          <td>
                            ${({ group: this.copy("Group", "קבוצה"), allow: this.copy("Personal grant", "אישור אישי"), deny: this.copy("Personal denial", "חסימה אישית") } as Record<string, string>)[row.source_permission] ?? "—"}
                          </td>
                          <td>${this.names(row.before)}</td>
                          <td>
                            ${row.after === null ? this.copy("Blocked by overlap", "חסום עקב חפיפה") : this.names(row.after)}
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              ${!review.rows_complete ? html`<p>${this.copy("Showing a bounded sample", "מוצגת דגימה מוגבלת")}: ${review.row_budget} / ${review.affected_people}</p>` : nothing}
            `
          : nothing
      }
    </article>`;
  }
}
customElements.define("wiskey-station-lifecycle-review", StationLifecycleReview);
