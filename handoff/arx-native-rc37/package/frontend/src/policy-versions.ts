import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { DataQuality } from "./data-quality";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";
interface Version {
  revision: number;
  saved_at: string | null;
  actor: string;
  origin: string;
  field_changes: number;
  group_changes: number;
}
interface Page {
  records: Version[];
  total: number;
  next_offset: number | null;
  previous_offset: number | null;
  retained_from_revision: number;
  current_revision: number;
}
interface Comparison {
  before_revision: number;
  after_revision: number;
  summary: { fields: number; groups: number };
  rows: {
    kind: string;
    id: string;
    label: string;
    state: string;
    changes: { property: string; before: unknown; after: unknown }[];
  }[];
}
const copy: Record<string, [string, string]> = {
  title: ["Policy versions", "גרסאות מדיניות"],
  load: ["Load policy history", "טען היסטוריית מדיניות"],
  compare: ["Compare versions", "השווה גרסאות"],
  before: ["Before version", "גרסה קודמת"],
  after: ["After version", "גרסה להשוואה"],
  baseline: [
    "Starting snapshot; original save time unknown",
    "תמונת פתיחה; מועד השמירה המקורי אינו ידוע",
  ],
  coverage: [
    "The last 50 snapshots are retained. Earlier policy history is not reconstructed. This view cannot restore policy or change access.",
    "נשמרות 50 התמונות האחרונות. היסטוריה קודמת אינה משוחזרת. מסך זה אינו משחזר מדיניות או משנה הרשאה.",
  ],
  fields: ["Profile fields", "שדות פרופיל"],
  groups: ["Groups", "קבוצות"],
  changed: ["Changed", "השתנה"],
  added: ["Added", "נוסף"],
  removed: ["Removed", "הוסר"],
  none: [
    "No field or group changes between these versions.",
    "אין שינויי שדות או קבוצות בין הגרסאות.",
  ],
  label: ["Name", "שם"],
  enabled: ["Enabled", "פעיל"],
  type: ["Field type", "סוג שדה"],
  required: ["Required", "חובה"],
  unique: ["Unique value", "ערך ייחודי"],
  options: ["Available values", "ערכים לבחירה"],
  depends_on: ["Field condition", "תנאי שדה"],
  station_ids: ["Assigned stations", "תחנות מורשות"],
  true: ["Yes", "כן"],
  false: ["No", "לא"],
  empty: ["Not configured", "לא מוגדר"],
  policy_version_not_found: [
    "The version is no longer retained. Reload policy history.",
    "הגרסה כבר אינה שמורה. יש לטעון מחדש את ההיסטוריה.",
  ],
  newer: ["Newer versions", "גרסאות חדשות יותר"],
  older: ["Older versions", "גרסאות קודמות"],
  text: ["Text", "טקסט"],
  select: ["Selection", "בחירה"],
  number: ["Number", "מספר"],
  date: ["Date", "תאריך"],
};
export class PolicyVersions extends LitElement {
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    context: { type: String },
    canView: { type: Boolean },
    policyRevision: { type: Number },
    page: { state: true },
    result: { state: true },
    busy: { state: true },
    error: { state: true },
    beforeRevision: { state: true },
    afterRevision: { state: true },
  };
  static styles = [
    DataQuality.styles,
    css`
      :host {
        display: block;
        margin-block: 15px;
      }
      section {
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 10px;
        padding: 15px;
        min-width: 0;
      }
      .choices {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: end;
        margin-block: 12px;
      }
      label {
        display: grid;
        gap: 5px;
      }
      article {
        display: grid;
        gap: 8px;
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 8px;
        padding: 12px;
        min-width: 0;
      }
      .change {
        display: grid;
        grid-template-columns: minmax(80px, 1fr) repeat(2, minmax(0, 1fr));
        gap: 10px;
        overflow-wrap: anywhere;
      }
      .versions {
        display: grid;
        gap: 6px;
        margin-block: 12px;
      }
      .versions div {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      h3,
      h4 {
        margin: 0;
      }
      .pager {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-block: 10px;
      }
      @media (max-width: 600px) {
        .change {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .change strong {
          grid-column: 1/-1;
        }
      }
    `,
  ];
  hass?: Hass;
  stations: Station[] = [];
  context = "";
  canView = false;
  policyRevision = 0;
  private page?: Page;
  private result?: Comparison;
  private busy = false;
  private error = "";
  private beforeRevision = "";
  private afterRevision = "";
  private key = "";
  private epoch = 0;
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(
    () => this.hass,
    () => this.canView && !!this.hass?.user?.is_admin,
  );
  private t = (key: string) =>
    copy[key]?.[this.hass?.language?.startsWith("he") ? 1 : 0] ??
    translate(this.hass?.language ?? "en", key);
  private reset() {
    this.epoch++;
    this.requests.cancel();
    this.page = undefined;
    this.result = undefined;
    this.beforeRevision = this.afterRevision = this.error = "";
    this.busy = false;
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
    const key = JSON.stringify([
      this.hass?.user?.id,
      this.context,
      this.canView,
      this.policyRevision,
    ]);
    if (key !== this.key || this.connection !== this.hass?.connection) {
      this.reset();
      this.key = key;
      this.connection?.removeEventListener?.("disconnected", this.lost);
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.lost);
    }
  }
  private async load(offset = 0) {
    if (this.busy) return;
    const epoch = ++this.epoch;
    this.busy = true;
    this.result = undefined;
    this.error = "";
    try {
      const page = await this.requests.run<Page>(
        { type: "hikvision_intercom/profiles/versions", offset, limit: 10 },
        15000,
      );
      if (epoch !== this.epoch || !this.isConnected) return;
      this.page = page;
      this.afterRevision = String(page.records[0]?.revision ?? "");
      this.beforeRevision = String(page.records[1]?.revision ?? page.records[0]?.revision ?? "");
    } catch (e) {
      if (epoch === this.epoch) this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private async compare() {
    if (this.busy || !this.beforeRevision || !this.afterRevision) return;
    const epoch = ++this.epoch;
    this.busy = true;
    this.result = undefined;
    this.error = "";
    try {
      const result = await this.requests.run<Comparison>(
        {
          type: "hikvision_intercom/profiles/versions_compare",
          before_revision: Number(this.beforeRevision),
          after_revision: Number(this.afterRevision),
        },
        15000,
      );
      if (epoch === this.epoch && this.isConnected) this.result = result;
    } catch (e) {
      if (epoch === this.epoch) this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private format(prop: string, value: unknown) {
    if (value === null || value === undefined || value === "") return this.t("empty");
    if (typeof value === "boolean") return this.t(String(value));
    if (prop === "station_ids" && Array.isArray(value))
      return (
        value.map((id) => this.stations.find((s) => s.id === id)?.name ?? id).join(", ") ||
        this.t("empty")
      );
    if (Array.isArray(value)) return value.join(", ") || this.t("empty");
    if (prop === "depends_on" && typeof value === "object") {
      const condition = value as { field_id: string; field_label?: string; value: string };
      return `${condition.field_label ?? condition.field_id}: ${condition.value}`;
    }
    return prop === "type" ? this.t(String(value)) : String(value);
  }
  private choices(side: "before" | "after") {
    const selection = side === "before" ? "beforeRevision" : "afterRevision";
    return html`<label
      >${this.t(side)}<select
        .value=${this[selection]}
        ?disabled=${this.busy}
        @change=${(e: Event) => {
          this[selection] = (e.target as HTMLSelectElement).value;
          this.result = undefined;
          this.error = "";
        }}
      >
        ${this.page?.records.map((v) => html`<option value=${v.revision}>${v.revision}</option>`)}
      </select></label
    >`;
  }
  private changes() {
    if (!this.result) return nothing;
    return html`<p>
        ${this.t("fields")}: ${this.result.summary.fields} · ${this.t("groups")}:
        ${this.result.summary.groups}
      </p>
      ${this.result.rows.length ? nothing : html`<p>${this.t("none")}</p>`}${this.result.rows.map(
        (row) =>
          html`<article>
            <h4>${row.label} · ${this.t(row.kind)} · ${this.t(row.state)}</h4>
            ${row.changes.map(
              (c) =>
                html`<div class="change">
                  <strong>${this.t(c.property)}</strong
                  ><span
                    ><small>${this.t("before")} ${this.result!.before_revision}</small
                    ><br />${this.format(c.property, c.before)}</span
                  ><span
                    ><small>${this.t("after")} ${this.result!.after_revision}</small
                    ><br />${this.format(c.property, c.after)}</span
                  >
                </div>`,
            )}
          </article>`,
      )}`;
  }
  private history() {
    if (!this.page) return nothing;
    return html`<div class="versions">
        ${this.page.records.map((v) => html`<div><strong>${v.revision}</strong><span>${v.saved_at ? new Date(v.saved_at).toLocaleString(this.hass?.language) : this.t("baseline")}</span><span>${this.t("fields")}: ${v.field_changes} · ${this.t("groups")}: ${v.group_changes}</span></div>`)}
      </div>
      <div class="pager">
        <button
          type="button"
          ?disabled=${this.busy || this.page.previous_offset === null}
          @click=${() => void this.load(this.page!.previous_offset!)}
        >
          ${this.t("newer")}</button
        ><button
          type="button"
          ?disabled=${this.busy || this.page.next_offset === null}
          @click=${() => void this.load(this.page!.next_offset!)}
        >
          ${this.t("older")}
        </button>
      </div>
      <div class="choices">
        ${this.choices("before")}${this.choices("after")}<button
          type="button"
          ?disabled=${this.busy || !this.beforeRevision || !this.afterRevision}
          @click=${() => void this.compare()}
        >
          ${this.t("compare")}
        </button>
      </div>
      ${this.changes()}`;
  }
  render() {
    if (!this.canView || !this.hass?.user?.is_admin) return nothing;
    return html`<section aria-label=${this.t("title")} aria-busy=${this.busy}>
      <h3>${this.t("title")}</h3>
      <p class="sub">${this.t("coverage")}</p>
      <button type="button" ?disabled=${this.busy} @click=${() => void this.load()}>
        ${this.t("load")}</button
      >${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}${this.history()}
    </section>`;
  }
}
customElements.define("wiskey-policy-versions", PolicyVersions);
