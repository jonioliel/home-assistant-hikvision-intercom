import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import { DataQuality } from "./data-quality";
import type { Hass } from "./types";
type Kind = "person" | "group";
interface Choice {
  id: string;
  name: string;
  archived: boolean;
}
interface Page {
  records: Choice[];
  total: number;
  offset: number;
  next_offset: number | null;
  previous_offset: number | null;
}
interface Side {
  granted: boolean;
  source: string;
  groups: { id: string; name: string }[];
  sources_known: boolean;
}
interface Result {
  left: { name: string; active?: boolean; archived?: boolean; enabled?: boolean };
  right: Result["left"];
  summary: Record<string, number>;
  rows: { station_name: string; lock_id: number; relation: string; left: Side; right: Side }[];
}
const copy: Record<string, [string, string]> = {
  title: ["Compare people and groups", "השוואת אנשים וקבוצות"],
  intro: [
    "Compare assigned doors and permission sources. This view does not copy or change access.",
    "השוואת דלתות ומקורות הרשאה. הצפייה אינה מעתיקה או משנה גישה.",
  ],
  left: ["First selection", "בחירה ראשונה"],
  right: ["Second selection", "בחירה שנייה"],
  person: ["Person", "אדם"],
  group: ["Group", "קבוצה"],
  search: ["Find by name", "חיפוש לפי שם"],
  kind: ["Selection type", "סוג הבחירה"],
  selected: ["Selected item", "פריט נבחר"],
  all: ["All", "הכול"],
  filter: ["Door differences", "הבדלי דלתות"],
  door: ["Door", "דלת"],
  compare: ["Compare", "השווה"],
  shared: ["Shared", "משותפות"],
  left_only: ["First only", "רק בראשונה"],
  right_only: ["Second only", "רק בשנייה"],
  neither: ["Neither assigned", "ללא הרשאה"],
  granted: ["Assigned", "מורשה"],
  denied: ["Not assigned", "לא מורשה"],
  group_policy: ["Group policy", "מדיניות קבוצה"],
  inherited: ["Inherited station grant", "הרשאת תחנה מקבוצה"],
  personal_deny: ["Personal block", "חסימה אישית"],
  personal_allow: ["Personal addition", "תוספת אישית"],
  assignment: ["Explicit assignment", "שיוך מפורש"],
  none: ["No assignment", "ללא שיוך"],
  restricted: ["Source outside visible scope", "מקור מחוץ להיקף הצפייה"],
  boundary: [
    "Assigned doors are not a prediction of admission now. Active status, dates and schedules still apply; device state and physical admission are not verified here.",
    "שיוך דלתות אינו בדיקת כניסה ברגע זה. מצב המשתמש, התוקף ולוחות הזמנים עדיין חלים. מצב הציוד וכניסה בפועל אינם מאומתים כאן.",
  ],
  inactive: ["Inactive", "לא פעיל"],
  archived: ["Archived", "בארכיון"],
  empty: ["No door assignments in the visible scope.", "אין שיוכי דלתות בהיקף הצפייה."],
  comparison_not_found: [
    "Selection no longer available. Search and select again.",
    "הבחירה כבר אינה זמינה. יש לחפש ולבחור שוב.",
  ],
};
export class AccessComparison extends LitElement {
  static properties = {
    hass: { attribute: false },
    context: { type: String },
    canView: { type: Boolean },
    picks: { state: true },
    result: { state: true },
    busy: { state: true },
    error: { state: true },
    relation: { state: true },
  };
  static styles = [
    DataQuality.styles,
    css`
      .picks {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-block: 12px;
      }
      .picks section {
        background: var(--surface, var(--card-background-color));
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 10px;
        padding: 12px;
        min-width: 0;
        display: grid;
        gap: 8px;
      }
      label {
        display: grid;
        gap: 5px;
        min-width: 0;
      }
      input {
        font: inherit;
        background: var(--surface, var(--card-background-color));
        color: inherit;
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 8px;
        padding: 10px;
        box-sizing: border-box;
        width: 100%;
      }
      .doors article {
        display: grid;
        grid-template-columns: minmax(100px, 1fr) repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .doors .side {
        overflow-wrap: anywhere;
        min-width: 0;
      }
      h3,
      h4 {
        margin: 0;
      }
      .pager {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      @media (max-width: 650px) {
        .picks {
          grid-template-columns: 1fr;
        }
        .doors article {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .door {
          grid-column: 1/-1;
        }
      }
    `,
  ];
  hass?: Hass;
  context = "";
  canView = false;
  private picks: {
    kind: Kind;
    query: string;
    id: string;
    data?: Page;
    busy: boolean;
    epoch: number;
  }[] = [0, 1].map(() => ({ kind: "person", query: "", id: "", busy: false, epoch: 0 }));
  private result?: Result;
  private busy = false;
  private error = "";
  private relation = "all";
  private key = "";
  private epoch = 0;
  private comparisonEpoch = 0;
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(
    () => this.hass,
    () => this.canView,
  );
  private t = (key: string) =>
    copy[key]?.[this.hass?.language?.startsWith("he") ? 1 : 0] ??
    translate(this.hass?.language ?? "en", key);
  private reset() {
    this.epoch++;
    this.comparisonEpoch++;
    this.requests.cancel();
    this.picks = [0, 1].map(() => ({ kind: "person", query: "", id: "", busy: false, epoch: 0 }));
    this.result = undefined;
    this.busy = false;
    this.error = "";
    this.relation = "all";
  }
  private lost = () => {
    this.reset();
    this.error = "connection_lost";
  };
  disconnectedCallback() {
    super.disconnectedCallback();
    this.reset();
    this.connection?.removeEventListener?.("disconnected", this.lost);
  }
  protected updated(_changes: PropertyValues) {
    const key = JSON.stringify([this.hass?.user?.id, this.context, this.canView]);
    if (key !== this.key || this.connection !== this.hass?.connection) {
      this.reset();
      this.key = key;
      this.connection?.removeEventListener?.("disconnected", this.lost);
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.lost);
      if (this.canView) {
        void this.choices(0);
        void this.choices(1);
      }
    }
  }
  private async choices(index: number, offset = 0) {
    this.invalidate();
    const p = this.picks[index],
      epoch = ++p.epoch,
      viewEpoch = this.epoch;
    p.id = "";
    p.busy = true;
    p.data = undefined;
    this.result = undefined;
    this.requestUpdate();
    try {
      const data = await this.requests.run<Page>(
        {
          type: "hikvision_intercom/users/access_compare_options",
          kind: p.kind,
          query: p.query,
          offset,
          limit: 25,
        },
        15000,
      );
      if (viewEpoch === this.epoch && epoch === p.epoch && this.isConnected) p.data = data;
    } catch (e) {
      if (viewEpoch === this.epoch && epoch === p.epoch)
        this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (viewEpoch === this.epoch && epoch === p.epoch) {
        p.busy = false;
        this.requestUpdate();
      }
    }
  }
  private invalidate() {
    this.comparisonEpoch++;
    this.result = undefined;
    this.busy = false;
    this.error = "";
    this.relation = "all";
  }
  private async compare() {
    if (this.busy || this.picks.some((p) => !p.id || p.busy)) return;
    const epoch = ++this.comparisonEpoch;
    this.result = undefined;
    this.busy = true;
    this.error = "";
    try {
      const result = await this.requests.run<Result>(
        {
          type: "hikvision_intercom/users/access_compare",
          left_kind: this.picks[0].kind,
          left_id: this.picks[0].id,
          right_kind: this.picks[1].kind,
          right_id: this.picks[1].id,
        },
        15000,
      );
      if (epoch === this.comparisonEpoch && this.isConnected) this.result = result;
    } catch (e) {
      if (epoch === this.comparisonEpoch)
        this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (epoch === this.comparisonEpoch) this.busy = false;
    }
  }
  private side(s: Side) {
    return html`<div class="side">
      <strong>${this.t(s.granted ? "granted" : "denied")}</strong>
      <p>${this.t(s.source)}</p>
      ${s.groups.map((g) => html`<small>${g.name}</small>`)}${!s.sources_known && s.source !== "restricted" ? html`<small>${this.t("restricted")}</small>` : nothing}
    </div>`;
  }
  render() {
    if (!this.canView) return nothing;
    const r = this.result;
    return html`<div class="heading">
        <div>
          <h2>${this.t("title")}</h2>
          <p class="sub">${this.t("intro")}</p>
        </div>
      </div>
      <div class="picks">
        ${this.picks.map(
          (p, index) =>
            html`<section aria-label=${this.t(index ? "right" : "left")}>
              <h3>${this.t(index ? "right" : "left")}</h3>
              <label
                >${this.t("kind")}<select
                  aria-label=${this.t("kind")}
                  .value=${p.kind}
                  ?disabled=${p.busy || this.busy}
                  @change=${(e: Event) => {
                    p.kind = (e.target as HTMLSelectElement).value as Kind;
                    p.query = "";
                    this.invalidate();
                    void this.choices(index);
                  }}
                >
                  ${["person", "group"].map((k) => html`<option value=${k}>${this.t(k)}</option>`)}
                </select></label
              >
              <form
                @submit=${(e: Event) => {
                  e.preventDefault();
                  this.invalidate();
                  void this.choices(index);
                }}
              >
                <label
                  >${this.t("search")}<input
                    maxlength="128"
                    .value=${p.query}
                    @input=${(e: Event) => {
                      p.query = (e.target as HTMLInputElement).value;
                      this.invalidate();
                      p.epoch++;
                      p.busy = false;
                      p.data = undefined;
                      p.id = "";
                      this.requestUpdate();
                    }} /></label
                ><button type="submit" ?disabled=${p.busy || this.busy}>${this.t("search")}</button>
              </form>
              <label
                >${this.t("selected")}<select
                  aria-label=${this.t("selected")}
                  .value=${p.id}
                  ?disabled=${p.busy || this.busy}
                  @change=${(e: Event) => {
                    this.invalidate();
                    p.id = (e.target as HTMLSelectElement).value;
                    this.requestUpdate();
                  }}
                >
                  <option value="">—</option>
                  ${p.data?.records.map((c) => html`<option value=${c.id}>${c.name}${c.archived ? " · " + this.t("archived") : ""}</option>`)}
                </select></label
              >${p.busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${p.data ? html`<div class="pager"><button ?disabled=${p.busy || p.data.previous_offset === null} @click=${() => void this.choices(index, p.data?.previous_offset ?? 0)}>${this.t("previous")}</button><span>${p.data.total ? p.data.offset + 1 : 0}–${Math.min(p.data.offset + p.data.records.length, p.data.total)} / ${p.data.total}</span><button ?disabled=${p.busy || p.data.next_offset === null} @click=${() => void this.choices(index, p.data?.next_offset ?? 0)}>${this.t("next")}</button></div>` : nothing}
            </section>`,
        )}
      </div>
      <button
        ?disabled=${this.busy || this.picks.some((p) => p.busy || !p.id)}
        @click=${() => void this.compare()}
      >
        ${this.t("compare")}</button
      >${this.busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}${
        r
          ? html`<p class="sub">${this.t("boundary")}</p>
              <div class="summary">
                ${["shared", "left_only", "right_only", "neither"].map((k) => html`<div class="metric"><strong>${r.summary[k]}</strong>${this.t(k)}</div>`)}
              </div>
              <div class="heading">
                <h3>
                  ${r.left.name}${r.left.active === false || r.left.enabled === false ? " · " + this.t("inactive") : ""}${r.left.archived ? " · " + this.t("archived") : ""}
                </h3>
                <h3>
                  ${r.right.name}${r.right.active === false || r.right.enabled === false ? " · " + this.t("inactive") : ""}${r.right.archived ? " · " + this.t("archived") : ""}
                </h3>
              </div>
              <label
                >${this.t("filter")}<select
                  aria-label=${this.t("filter")}
                  .value=${this.relation}
                  @change=${(e: Event) => (this.relation = (e.target as HTMLSelectElement).value)}
                >
                  <option value="all">${this.t("all")}</option>
                  ${["shared", "left_only", "right_only", "neither"].map((k) => html`<option value=${k}>${this.t(k)}</option>`)}
                </select></label
              >
              <div class="list doors">
                ${r.rows
                  .filter((row) => this.relation === "all" || row.relation === this.relation)
                  .map(
                    (row) =>
                      html`<article>
                        <div class="door">
                          <h4>${row.station_name} · ${this.t("door")} ${row.lock_id}</h4>
                          <small>${this.t(row.relation)}</small>
                        </div>
                        ${this.side(row.left)}${this.side(row.right)}
                      </article>`,
                  )}
              </div>
              ${!r.rows.length ? html`<p>${this.t("empty")}</p>` : nothing}`
          : nothing
      }`;
  }
}
customElements.define("wiskey-access-comparison", AccessComparison);
