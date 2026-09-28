import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { downloadText } from "./download";
import type { Hass, Station } from "./types";
import { translate } from "./i18n";
import "./fleet-approval";

type Values = Record<string, unknown>;
interface Saved {
  actor: string;
  values: Values;
}
interface Center {
  capabilities?: string[];
  revision: number;
  stations: Record<string, Saved>;
  templates: Record<string, Saved>;
  views: Record<string, Saved>;
  reports: Record<string, Saved>;
  catalog: Record<string, string>;
  journal: Values[];
  observations: Values[];
  receipts: Values[];
  report_runs: Values[];
  webhook: { enabled: boolean; url: string; kinds: string[] };
  event_usage: {
    records: number;
    bytes: number;
    days: number;
    count_limit: number;
    byte_limit: number | null;
    count_horizon_days: number | null;
  };
}
type Tab =
  | "messages"
  | "fleet"
  | "configuration"
  | "health"
  | "events"
  | "reports"
  | "audio"
  | "external"
  | "security"
  | "migration";
const tabs: Tab[] = [
  "messages",
  "fleet",
  "configuration",
  "health",
  "events",
  "reports",
  "audio",
  "external",
  "security",
  "migration",
];
const labels: Record<Tab, [string, string]> = {
  messages: ["Message variants", "תבניות הודעה"],
  fleet: ["Station catalog", "קטלוג תחנות"],
  configuration: ["Fleet configuration", "הגדרות צי"],
  health: ["Health and remedies", "בריאות ותיקון"],
  events: ["Retention and archive", "שמירה וארכיון"],
  reports: ["Saved reports", "דוחות שמורים"],
  audio: ["Audio output", "פלט שמע"],
  external: ["External connections", "חיבורים חיצוניים"],
  security: ["Integrity and security", "שלמות ואבטחה"],
  migration: ["Configuration transfer", "העברת תצורה"],
};
const defaultWindow = {
  enabled: false,
  days: [0, 1, 2, 3, 4, 5, 6],
  start: "08:00",
  end: "18:00",
  timezone: "Asia/Jerusalem",
};
const defaultStation = {
  zone: "",
  owner: "",
  tags: [],
  thresholds: { offline: 600, sync_stalled: 900, event_gap: 600 },
  window: defaultWindow,
};

export class PlatformCenter extends LitElement {
  static properties = {
    hass: { attribute: false },
    stations: { attribute: false },
    data: { state: true },
    tab: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    selected: { state: true },
    editing: { state: true },
    draft: { state: true },
    review: { state: true },
    confirmed: { state: true },
    result: { state: true },
    mapping: { state: true },
    content: { state: true },
    selectedIds: { state: true },
    key: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
        background: transparent;
      }
      nav,
      .row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      nav {
        margin-bottom: 12px;
      }
      nav button[aria-current="page"] {
        background: var(--primary-color);
        color: var(--text-primary-color, white);
      }
      article {
        border: 1px solid var(--divider-color);
        background: var(--surface);
        border-radius: 12px;
        padding: 16px;
        margin-block: 12px;
      }
      h2,
      h3,
      p {
        margin-block: 0 10px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 12px;
      }
      label {
        display: grid;
        gap: 5px;
        margin-block: 8px;
      }
      label.check {
        display: flex;
        align-items: center;
      }
      input,
      select,
      textarea {
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        background: var(--surface);
        color: var(--ink);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 9px;
        font: inherit;
      }
      input[type="checkbox"] {
        width: 20px;
        height: 20px;
      }
      textarea {
        min-height: 140px;
        resize: vertical;
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
        text-align: start;
        padding: 8px;
        border-bottom: 1px solid var(--divider-color);
        vertical-align: top;
      }
      .error {
        color: var(--error-color);
      }
      .sub {
        white-space: normal;
      }
      code {
        overflow-wrap: anywhere;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .summary {
        font-size: 18px;
      }
      button {
        min-height: 40px;
      }
      button,
      input,
      select,
      textarea {
        max-width: 100%;
      }
      .checklist {
        display: grid;
        gap: 6px;
      }
      @media print {
        nav,
        button,
        input,
        select,
        textarea,
        .no-print {
          display: none;
        }
        :host {
          color: black;
          background: white;
        }
        article {
          break-inside: avoid;
        }
      }
    `,
  ];
  hass?: Hass;
  stations: Station[] = [];
  private data?: Center;
  private tab: Tab = "messages";
  private busy = false;
  private error = "";
  private notice = "";
  private selected = "";
  private editing = "";
  private draft: Values = {};
  private review: Values | null = null;
  private confirmed = false;
  private result: Values | null = null;
  private mapping: Record<string, string> = {};
  private content = "";
  private selectedIds: string[] = [];
  private key = "";
  private epoch = 0;
  private actor?: string;
  private authorized = false;
  private requests = new ScopedRequests(() => this.hass);
  private copy(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  private value(key: string, fallback: unknown = "") {
    return this.draft[key] ?? fallback;
  }
  private set(key: string, value: unknown) {
    this.draft = { ...this.draft, [key]: value };
    this.review = null;
    this.confirmed = false;
  }
  protected updated(_changes: PropertyValues) {
    if (this.actor !== this.hass?.user?.id || this.authorized !== !!this.hass?.user?.is_admin) {
      this.epoch++;
      this.requests.cancel();
      this.data = undefined;
      this.key = "";
      this.result = this.review = null;
      this.draft = {};
      this.content = "";
      this.mapping = {};
      this.selectedIds = [];
      this.editing = this.selected = this.error = this.notice = "";
      this.busy = false;
      this.actor = this.hass?.user?.id;
      this.authorized = !!this.hass?.user?.is_admin;
      if (this.hass?.user?.is_admin && this.isConnected) void this.action(() => this.load());
    }
  }
  disconnectedCallback() {
    this.epoch++;
    this.requests.cancel();
    this.key = "";
    super.disconnectedCallback();
  }
  private async api<T>(command: string, values: Values = {}): Promise<T> {
    return this.requests.run<T>(
      { type: "hikvision_intercom/platform/" + command, api_contract: 1, ...values },
      command.startsWith("config_") ? 600000 : 60000,
    );
  }
  private async load() {
    const data = await this.api<Center>("get");
    this.data = data;
  }
  private async action(task: () => Promise<unknown>) {
    if (this.busy || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = this.notice = "";
    try {
      await task();
    } catch (err) {
      if (epoch === this.epoch) {
        const code = (err as { code?: string }).code ?? "action_failed";
        this.error = translate(this.hass?.language ?? "en", code);
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private switch(tab: Tab) {
    this.tab = tab;
    this.editing = "";
    this.draft = {};
    this.review = this.result = null;
    this.confirmed = false;
    this.key = "";
    this.error = this.notice = "";
  }
  private field(key: string, en: string, he: string, type = "text", fallback: unknown = "") {
    return html`<label
      >${this.copy(en, he)}<input
        type=${type}
        .value=${String(this.value(key, fallback))}
        ?disabled=${this.busy}
        @input=${(e: Event) => this.set(key, type === "number" ? Number((e.target as HTMLInputElement).value) : (e.target as HTMLInputElement).value)}
    /></label>`;
  }
  private options(
    key: string,
    en: string,
    he: string,
    choices: [string, string, string][],
    fallback = "",
  ) {
    const selected = String(this.value(key, fallback));
    return html`<label
      >${this.copy(en, he)}<select
        aria-label=${this.copy(en, he)}
        .value=${selected}
        ?disabled=${this.busy}
        @change=${(e: Event) => this.set(key, (e.target as HTMLSelectElement).value)}
      >
        ${choices.map(([id, enLabel, heLabel]) => html`<option value=${id} ?selected=${id === selected}>${this.copy(enLabel, heLabel)}</option>`)}
      </select></label
    >`;
  }
  private stationPicker() {
    return html`<label
      >${this.copy("Station", "תחנה")}<select
        .value=${this.selected}
        ?disabled=${this.busy}
        @change=${(e: Event) => {
          this.selected = (e.target as HTMLSelectElement).value;
          this.draft = structuredClone(
            this.data?.stations[this.selected]?.values ?? defaultStation,
          );
          this.review = this.result = null;
        }}
      >
        <option value="">${this.copy("Choose a station", "בחר תחנה")}</option>
        ${Object.entries(this.data?.catalog ?? {}).map(([id, name]) => html`<option value=${id} ?selected=${id === this.selected}>${name}</option>`)}
      </select></label
    >`;
  }
  private async save(collection: string, id: string, values: Values) {
    await this.api("save", { collection, record_id: id, revision: this.data!.revision, values });
    await this.load();
    this.notice = this.copy("Saved on the server.", "נשמר בשרת.");
    this.editing = "";
  }
  private async deleteRecord(collection: string, id: string) {
    await this.api("delete", { collection, record_id: id, revision: this.data!.revision });
    await this.load();
    this.notice = this.copy("Removed.", "נמחק.");
  }
  private confirmation() {
    return html`<label class="check"
      ><input
        type="checkbox"
        .checked=${this.confirmed}
        ?disabled=${this.busy}
        @change=${(e: Event) => (this.confirmed = (e.target as HTMLInputElement).checked)}
      />${this.copy("I reviewed and approve these changes", "בדקתי ואני מאשר את השינויים האלה")}</label
    >`;
  }
  private messageTab() {
    const template = {
      label: "",
      language: "he",
      category: "any",
      credential: "any",
      body: "שלום {{name}},\n\n{{organization}}\n\n{{credential_section}}\n\n{{doors_section}}\n\n{{access_window_section}}\n\n{{security_notice}}",
    };
    return html`<article>
      <h2>${this.copy("Message variants", "תבניות לפי סוג אדם ואמצעי גישה")}</h2>
      <p class="sub">
        ${this.copy("The most specific matching template is selected for the preview. Existing templates remain the fallback. Sending always requires review.", "התבנית המדויקת ביותר נבחרת לתצוגה המקדימה. התבניות הקיימות נשארות ברירת המחדל. השליחה דורשת תמיד סקירה ואישור.")}
      </p>
      <button
        ?disabled=${this.busy}
        @click=${() => {
          this.editing = "new";
          this.draft = template;
        }}
      >
        ${this.copy("Add variant", "הוסף תבנית")}
      </button>
      ${Object.entries(this.data!.templates).map(
        ([id, row]) =>
          html`<article>
            <h3>${row.values.label}</h3>
            <p>${row.values.language} · ${row.values.category} · ${row.values.credential}</p>
            <div class="row">
              <button
                ?disabled=${this.busy}
                @click=${() => {
                  this.editing = id;
                  this.draft = structuredClone(row.values);
                }}
              >
                ${this.copy("Edit", "עריכה")}</button
              ><button
                ?disabled=${this.busy}
                @click=${() => void this.action(() => this.deleteRecord("templates", id))}
              >
                ${this.copy("Delete variant", "מחיקת תבנית")}
              </button>
            </div>
          </article>`,
      )}
      ${
        this.editing
          ? html`<div class="grid">
                ${this.field("label", "Template name", "שם התבנית")}${this.options(
                  "language",
                  "Language",
                  "שפה",
                  [
                    ["he", "Hebrew", "עברית"],
                    ["en", "English", "אנגלית"],
                  ],
                  "he",
                )}${this.options(
                  "category",
                  "Person category",
                  "סוג אדם",
                  [
                    ["any", "Any", "כל הסוגים"],
                    ["staff", "Staff", "עובד"],
                    ["visitor", "Visitor", "אורח"],
                    ["contractor", "Contractor", "קבלן"],
                  ],
                  "any",
                )}${this.options(
                  "credential",
                  "Access credential",
                  "אמצעי גישה",
                  [
                    ["any", "Any", "כל האמצעים"],
                    ["pin", "Personal PIN", "קוד אישי"],
                    ["card", "Card only", "כרטיס בלבד"],
                    ["none", "No credential", "ללא אמצעי"],
                  ],
                  "any",
                )}
              </div>
              <label
                >${this.copy("Template text", "נוסח התבנית")}<textarea
                  .value=${String(this.value("body"))}
                  ?disabled=${this.busy}
                  @input=${(e: Event) => this.set("body", (e.target as HTMLTextAreaElement).value)}
                ></textarea>
              </label>
              <p>
                <code
                  >{{name}} {{organization}} {{credential_section}} {{doors_section}}
                  {{access_window_section}} {{security_notice}}</code
                >
              </p>
              <button
                ?disabled=${this.busy}
                @click=${() => void this.action(() => this.save("templates", this.editing === "new" ? "" : this.editing, this.draft))}
              >
                ${this.copy("Save variant", "שמור תבנית")}
              </button>`
          : nothing
      }
    </article>`;
  }
  private fleetTab() {
    const thresholds = this.value("thresholds", defaultStation.thresholds) as Record<
      string,
      number
    >;
    const window = this.value("window", defaultWindow) as typeof defaultWindow;
    return html`<article>
        <h2>${this.copy("Station ownership and maintenance", "אזור, אחראי ותחזוקת התחנה")}</h2>
        ${this.stationPicker()}${
          this.selected
            ? html`<div class="grid">
                  ${this.field("zone", "Zone", "אזור")}${this.field("owner", "Business owner", "אחראי עסקי")}<label
                    >${this.copy("Tags, comma separated", "תגיות, מופרדות בפסיקים")}<input
                      .value=${(this.value("tags", []) as string[]).join(", ")}
                      ?disabled=${this.busy}
                      @input=${(e: Event) =>
                        this.set(
                          "tags",
                          (e.target as HTMLInputElement).value
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean),
                        )}
                  /></label>
                </div>
                <h3>${this.copy("Alert thresholds in minutes", "ספי התראה בדקות")}</h3>
                <div class="grid">
                  ${(["offline", "sync_stalled", "event_gap"] as const).map((kind, i) => html`<label>${this.copy(["Offline", "Stalled synchronization", "Event stream gap"][i], ["ניתוק", "סנכרון תקוע", "פער בזרם האירועים"][i])}<input type="number" min="1" max="1440" .value=${String(thresholds[kind] / 60)} ?disabled=${this.busy} @input=${(e: Event) => this.set("thresholds", { ...thresholds, [kind]: Number((e.target as HTMLInputElement).value) * 60 })} /></label>`)}
                </div>
                <h3>${this.copy("Fleet configuration window", "חלון להחלת הגדרות צי")}</h3>
                <p class="sub">
                  ${this.copy("This window controls reviewed fleet configuration changes. Credential revocation and normal synchronization remain immediate.", "החלון מגביל החלת הגדרות צי לאחר סקירה. ביטול הרשאה וסנכרון רגיל נשארים מיידיים.")}
                </p>
                <label class="check"
                  ><input
                    type="checkbox"
                    .checked=${window.enabled}
                    ?disabled=${this.busy}
                    @change=${(e: Event) => this.set("window", { ...window, enabled: (e.target as HTMLInputElement).checked })}
                  />${this.copy("Restrict configuration window", "הגבל את חלון ההחלה")}</label
                >
                <div class="grid">
                  ${(["start", "end", "timezone"] as const).map((k) => html`<label>${this.copy(k, k === "start" ? "משעה" : k === "end" ? "עד שעה" : "אזור זמן")}<input type=${k === "timezone" ? "text" : "time"} .value=${window[k]} ?disabled=${this.busy} @input=${(e: Event) => this.set("window", { ...window, [k]: (e.target as HTMLInputElement).value })} /></label>`)}
                </div>
                <div class="row">
                  ${[0, 1, 2, 3, 4, 5, 6].map((day) => html`<label class="check"><input type="checkbox" .checked=${window.days.includes(day)} ?disabled=${this.busy} @change=${(e: Event) => this.set("window", { ...window, days: (e.target as HTMLInputElement).checked ? [...window.days, day] : window.days.filter((d) => d !== day) })} />${this.copy(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day], ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"][day])}</label>`)}
                </div>
                <button
                  ?disabled=${this.busy}
                  @click=${() => void this.action(() => this.save("stations", this.selected, this.draft))}
                >
                  ${this.copy("Save station preferences", "שמור הגדרות תחנה")}
                </button>`
            : nothing
        }
      </article>
      <article>
        <h3>${this.copy("Adding or replacing a station", "הוספת תחנה או החלפת ציוד")}</h3>
        <ol>
          <li>
            ${this.copy("Add the station using the integration's existing setup wizard; it validates address and serial number.", "הוסף תחנה באשף ההתקנה הקיים; הוא מאמת כתובת ומספר סידורי.")}
          </li>
          <li>
            ${this.copy("Confirm physical relay mapping deliberately, then import or reassign people using the existing reviewed access workflows.", "אמת במכוון את מיפוי הממסרים, ואז העבר הרשאות במסלולי הגיבוי והסנכרון המבוקרים הקיימים.")}
          </li>
          <li>
            ${this.copy("Use configuration transfer to map station preferences to the new entry. This does not transfer credential ownership or silently reuse the old identity.", "העבר את הגדרות התפעול לתחנה החדשה באמצעות מיפוי מפורש. זה אינו מעביר בעלות על כרטיסים ואינו משתמש בזהות הישנה ללא אימות.")}
          </li>
        </ol>
      </article>`;
  }
  private configurationTab() {
    const selected = this.selectedIds;
    return html`${this.data?.capabilities?.includes("fleet_configuration_approval") ? html`<wiskey-fleet-approval .hass=${this.hass}></wiskey-fleet-approval>` : nothing}
      <article>
        <h2>${this.copy("Compare and apply door settings", "השוואה והחלת הגדרות דלת")}</h2>
        <p class="sub">
          ${this.copy("Choose up to 12 stations. Only advertised writable fields are allowed. Each station is read, reviewed, written and verified separately.", "בחר עד 12 תחנות. רק שדות שהתחנה מפרסמת כתמיכה ניתנים לשינוי. כל תחנה נקראת, נסקרת, נכתבת ומאומתת בנפרד.")}
        </p>
        <div class="grid">
          ${Object.entries(this.data!.catalog).map(
            ([id, name]) =>
              html`<label class="check"
                ><input
                  type="checkbox"
                  .checked=${selected.includes(id)}
                  ?disabled=${this.busy || (!selected.includes(id) && selected.length >= 12)}
                  @change=${(e: Event) => {
                    this.selectedIds = (e.target as HTMLInputElement).checked
                      ? [...selected, id]
                      : selected.filter((v) => v !== id);
                    this.review = this.result = null;
                  }}
                />${name}</label
              >`,
          )}
        </div>
        ${this.options(
          "door",
          "API door",
          "דלת API",
          [
            ["1", "1", "1"],
            ["2", "2", "2"],
          ],
          "1",
        )}<button
          ?disabled=${this.busy || !selected.length}
          @click=${() =>
            void this.action(async () => {
              this.result = await this.api("config_read", {
                station_ids: selected,
                door: Number(this.value("door", 1)),
              });
            })}
        >
          ${this.copy("Read and compare", "קרא והשווה")}
        </button>
        <div class="grid">
          ${this.field("doorName", "New door name (optional)", "שם דלת חדש (רשות)")}${this.field("openDuration", "Opening duration in seconds (optional)", "משך פתיחה בשניות (רשות)", "number")}
        </div>
        <button
          ?disabled=${this.busy || !selected.length}
          @click=${() =>
            void this.action(async () => {
              const changes: Values = {};
              for (const k of ["doorName", "openDuration"])
                if (this.draft[k] !== undefined && this.draft[k] !== "") changes[k] = this.draft[k];
              this.review = await this.api("config_preview", {
                station_ids: selected,
                door: Number(this.value("door", 1)),
                changes,
              });
              this.confirmed = false;
              this.result = null;
            })}
        >
          ${this.copy("Preview changes", "סקור שינויים")}</button
        >${this.showRows(this.result ?? this.review)}${
          this.review?.review_id
            ? html`${this.confirmation()}<button
                  ?disabled=${this.busy || !this.confirmed}
                  @click=${() =>
                    void this.action(async () => {
                      const result = await this.api<Values>("config_apply", {
                        review_id: this.review!.review_id,
                        confirmed: true,
                      });
                      this.review = null;
                      this.result = result;
                      await this.load();
                    })}
                >
                  ${this.copy("Apply reviewed changes", "החל שינויים שנסקרו")}
                </button>`
            : nothing
        }
      </article>
      <article>
        <h3>${this.copy("Observed capacity", "קיבולת נצפית")}</h3>
        <p class="sub">
          ${this.copy("Counts are shown only after station inventory was observed. Unknown is never treated as free capacity.", "מספרים מוצגים רק לאחר קריאת מלאי מהתחנה. מידע חסר אינו נחשב לקיבולת פנויה.")}
        </p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>${this.copy("Station", "תחנה")}</th>
                <th>${this.copy("People", "אנשים")}</th>
                <th>${this.copy("Cards", "כרטיסים")}</th>
              </tr>
            </thead>
            <tbody>
              ${this.stations.map((station) => {
                const s = station as Station & {
                  user_count?: number;
                  card_count?: number;
                  capabilities?: { max_users?: number; max_cards?: number };
                };
                return html`<tr>
                  <td>${s.name}</td>
                  <td>${s.user_count ?? "—"} / ${s.capabilities?.max_users ?? "—"}</td>
                  <td>${s.card_count ?? "—"} / ${s.capabilities?.max_cards ?? "—"}</td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>
      </article>`;
  }
  private showRows(result: Values | null) {
    const rows = (result?.rows ?? result?.receipts ?? []) as Values[];
    return rows.length
      ? html`<div class="scroll">
          <table>
            <thead>
              <tr>
                <th>${this.copy("Station", "תחנה")}</th>
                <th>${this.copy("Read / before", "קריאה / לפני")}</th>
                <th>${this.copy("After / result", "אחרי / תוצאה")}</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(
                (row) =>
                  html`<tr>
                    <td>
                      ${row.name ?? this.data?.catalog[String(row.station_id)] ?? row.station_id}
                    </td>
                    <td>${JSON.stringify(row.configuration ?? row.before ?? {})}</td>
                    <td>
                      ${row.error || row.code || (row.state === "verified" ? this.copy("Verified", "אומת") : row.state === "failed" ? this.copy("Failed", "נכשל") : JSON.stringify(row.after ?? {}))}
                    </td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>`
      : nothing;
  }
  private healthTab() {
    return html`<article>
      <h2>${this.copy("Remedies and media observations", "הנחיות תיקון ותצפיות מדיה")}</h2>
      <p>
        ${this.copy("Station thresholds are edited in Station catalog. Observations contain metadata only and do not record video, microphone audio or voices.", "ספי ההתראה נערכים בקטלוג התחנות. התצפיות כוללות נתונים טכניים בלבד ואינן מקליטות וידאו, מיקרופון או קולות.")}
      </p>
      ${[
        [
          "device_conflict",
          "Compare employee/card ownership before changing records. Never delete an unknown record to silence a conflict.",
          "בדוק בעלות על מספר עובד וכרטיס לפני שינוי. אל תמחק רשומה לא מוכרת כדי להסתיר התנגשות.",
        ],
        [
          "notSupport",
          "Refresh capabilities and use only the supported management route.",
          "רענן יכולות והשתמש רק במסלול הניהול הנתמך.",
        ],
        [
          "clock_drift",
          "Read the station clock and apply the configured NTP profile; then check its readback.",
          "קרא את שעון התחנה והחל את פרופיל NTP שהוגדר; בדוק את הקריאה החוזרת.",
        ],
        [
          "event_gap",
          "Check connectivity and event recovery status; a gap warning is not proof that access failed.",
          "בדוק תקשורת ומצב שחזור אירועים; התראת פער אינה הוכחה שכניסה נכשלה.",
        ],
      ].map(
        ([code, en, he]) =>
          html`<details>
            <summary>${code}</summary>
            <p>${this.copy(en, he)}</p>
          </details>`,
      )}
      <h3>${this.copy("Recent media observations", "תצפיות מדיה אחרונות")}</h3>
      ${this.data!.observations.slice(-40)
        .reverse()
        .map(
          (row) =>
            html`<p>
              ${this.data!.catalog[String(row.station_id)] ?? row.station_id} · ${row.at} ·
              ${row.source} · ${row.state}
            </p>`,
        )}
      <p class="sub">
        ${this.copy("A software observation is not a physical speaker acceptance test.", "תצפית תוכנה אינה בדיקת קבלה של הרמקול הפיזי.")}
      </p>
    </article>`;
  }
  private eventsTab() {
    const usage = this.data!.event_usage;
    return html`<article>
        <h2>${this.copy("Event retention", "שמירת אירועים")}</h2>
        <p class="summary">
          ${usage.records} ${this.copy("records", "רשומות")} · ${(usage.bytes / 1048576).toFixed(2)}
          MB · ${usage.days} ${this.copy("days", "ימים")}
        </p>
        <p>
          ${this.copy("Estimated count horizon:", "אופק משוער לפי מגבלת כמות:")}
          ${usage.count_horizon_days ?? "—"}
          ${this.copy("days. Based on retained arrival days, not a guarantee.", "ימים. מבוסס על ימי קליטה שנשמרו, ואינו הבטחה.")}
        </p>
        <div class="grid">
          ${this.field("days", "Retention days (1–365)", "ימי שמירה (1–365)", "number", usage.days)}${this.field("count", "Record limit (100–20000)", "מגבלת רשומות (100–20000)", "number", usage.count_limit)}${this.field("bytes", "Byte limit (262144–25165824)", "מגבלת בתים (262144–25165824)", "number", usage.byte_limit ?? 16777216)}
        </div>
        <button
          ?disabled=${this.busy}
          @click=${() =>
            void this.action(async () => {
              this.review = await this.api("retention_preview", {
                values: {
                  days: Number(this.value("days", usage.days)),
                  count: Number(this.value("count", usage.count_limit)),
                  bytes: Number(this.value("bytes", usage.byte_limit ?? 16777216)),
                },
              });
              this.confirmed = false;
            })}
        >
          ${this.copy("Preview retention impact", "סקור השפעה על האירועים")}</button
        >${
          this.review
            ? html`<p role="status">
                  ${this.copy("Records removed:", "רשומות שיימחקו:")} ${this.review.removed} ·
                  ${this.copy("Records retained:", "רשומות שיישמרו:")} ${this.review.after}
                </p>
                ${this.confirmation()}<button
                  ?disabled=${this.busy || !this.confirmed}
                  @click=${() =>
                    void this.action(async () => {
                      await this.api("retention_apply", {
                        review_id: this.review!.review_id,
                        confirmed: true,
                      });
                      this.review = null;
                      await this.load();
                      this.notice = this.copy("Retention applied.", "מדיניות השמירה הוחלה.");
                    })}
                >
                  ${this.copy("Apply retention policy", "החל מדיניות שמירה")}
                </button>`
            : nothing
        }
      </article>
      <article>
        <h3>${this.copy("Signed monthly archive", "ארכיון חודשי חתום")}</h3>
        <p>
          ${this.copy("Download retained events from the selected UTC calendar month. The archive cannot prove completeness or restore the full server. Keep its public key separately to verify the issuer.", "הורדת האירועים שנשמרו בחודש הנבחר לפי UTC. הארכיון אינו מוכיח שלמות ואינו משחזר שרת מלא. שמור את המפתח הציבורי בנפרד לאימות המקור.")}
        </p>
        ${this.field("month", "Calendar month", "חודש", "month", new Date().toISOString().slice(0, 7))}<button
          ?disabled=${this.busy}
          @click=${() =>
            void this.action(async () => {
              const month = String(this.value("month", new Date().toISOString().slice(0, 7)));
              const archive = await this.api("archive", { month });
              downloadText(
                JSON.stringify(archive, null, 2),
                "smplwise-events-" + month + ".signed.json",
                "application/json",
              );
            })}
        >
          ${this.copy("Download signed archive", "הורד ארכיון חתום")}
        </button>
      </article>`;
  }
  private reportsTab() {
    const collection = String(this.value("collection", "views"));
    return html`<article>
        <h2>
          ${this.copy("Saved filters and scheduled reports", "מסננים שמורים ודוחות מתוזמנים")}
        </h2>
        <p>
          ${this.copy("Saved on the server for your account, available across browsers. Scheduled reports create local summaries and never send messages.", "נשמרים בשרת לחשבון שלך וזמינים בדפדפנים אחרים. דוחות מתוזמנים יוצרים סיכום מקומי ואינם שולחים הודעות.")}
        </p>
        <button
          ?disabled=${this.busy}
          @click=${() => {
            this.editing = "new";
            this.draft = {
              collection: "views",
              label: "",
              filters: {},
              enabled: false,
              hour: 8,
              timezone: "Asia/Jerusalem",
              days: [0, 1, 2, 3, 4],
            };
          }}
        >
          ${this.copy("Add saved report", "הוסף דוח שמור")}</button
        >${(["views", "reports"] as const).flatMap((source) =>
          Object.entries(this.data![source]).map(
            ([id, row]) =>
              html`<article>
                <h3>${row.values.label}</h3>
                <p>
                  ${source === "reports" ? this.copy("Scheduled", "מתוזמן") : this.copy("Saved filter", "מסנן שמור")}
                </p>
                <div class="row">
                  <button
                    ?disabled=${this.busy}
                    @click=${() =>
                      void this.action(async () => {
                        this.result = await this.api("report", {
                          collection: source,
                          record_id: id,
                        });
                        await this.load();
                      })}
                  >
                    ${this.copy("Run report", "הפק דוח")}</button
                  ><button
                    ?disabled=${this.busy}
                    @click=${() => {
                      this.editing = id;
                      this.draft = { ...structuredClone(row.values), collection: source };
                    }}
                  >
                    ${this.copy("Edit", "עריכה")}</button
                  ><button
                    ?disabled=${this.busy}
                    @click=${() => void this.action(() => this.deleteRecord(source, id))}
                  >
                    ${this.copy("Delete report", "מחק דוח")}
                  </button>
                </div>
              </article>`,
          ),
        )}${
          this.editing
            ? html`${this.field("label", "Report name", "שם הדוח")}${this.options(
                  "collection",
                  "Report type",
                  "סוג דוח",
                  [
                    ["views", "Saved filter", "מסנן שמור"],
                    ["reports", "Scheduled summary", "סיכום מתוזמן"],
                  ],
                  "views",
                )}
                <div class="grid">
                  ${["person", "station_id", "result", "authentication", "start", "end"].map(
                    (k, i) =>
                      html`<label
                        >${this.copy(["Person or employee ID", "Station ID (optional)", "Result: granted / denied / unknown", "Method: pin / card / unknown", "From (ISO with timezone)", "Until (ISO with timezone)"][i], ["שם או מזהה עובד", "מזהה תחנה (רשות)", "תוצאה: granted / denied / unknown", "אמצעי: pin / card / unknown", "מתאריך (ISO עם אזור זמן)", "עד תאריך (ISO עם אזור זמן)"][i])}<input
                          .value=${String((this.value("filters", {}) as Values)[k] ?? "")}
                          ?disabled=${this.busy}
                          @input=${(e: Event) => {
                            const filters = { ...(this.value("filters", {}) as Values) };
                            const v = (e.target as HTMLInputElement).value;
                            if (v) filters[k] = v;
                            else delete filters[k];
                            this.set("filters", filters);
                          }}
                      /></label>`,
                  )}
                </div>
                ${
                  collection === "reports"
                    ? html`<label class="check"
                          ><input
                            type="checkbox"
                            .checked=${!!this.value("enabled", false)}
                            ?disabled=${this.busy}
                            @change=${(e: Event) => this.set("enabled", (e.target as HTMLInputElement).checked)}
                          />${this.copy("Enable scheduled summaries", "הפעל סיכומים מתוזמנים")}</label
                        >
                        <div class="grid">
                          ${this.field("hour", "Hour (0–23)", "שעה (0–23)", "number", 8)}${this.field("timezone", "Timezone", "אזור זמן", "text", "Asia/Jerusalem")}
                        </div>
                        <p>
                          ${this.copy("Monday–Friday; once on each selected day at the chosen local hour.", "שני עד שישי; פעם ביום בשעה המקומית שנבחרה.")}
                        </p>`
                    : nothing
                }<button
                  ?disabled=${this.busy}
                  @click=${() =>
                    void this.action(async () => {
                      const values: Values = {
                        label: this.value("label"),
                        filters: this.value("filters", {}),
                      };
                      if (collection === "reports")
                        Object.assign(values, {
                          enabled: this.value("enabled", false),
                          hour: this.value("hour", 8),
                          timezone: this.value("timezone", "Asia/Jerusalem"),
                          days: this.value("days", [0, 1, 2, 3, 4]),
                        });
                      await this.save(
                        collection,
                        this.editing === "new" ? "" : this.editing,
                        values,
                      );
                    })}
                >
                  ${this.copy("Save report", "שמור דוח")}
                </button>`
            : nothing
        }
      </article>
      ${
        this.result
          ? html`<article class="report">
              <h3>${this.copy("Report result", "תוצאת הדוח")}</h3>
              <p>${JSON.stringify(this.result.totals)}</p>
              <div class="row">
                <button
                  @click=${() => downloadText(String(this.result!.csv), "smplwise-report.csv", "text/csv;charset=utf-8")}
                >
                  ${this.copy("Download CSV", "הורד CSV")}</button
                ><button @click=${() => window.print()}>${this.copy("Print", "הדפס")}</button>
              </div>
              <div class="scroll">
                <table>
                  <caption>
                    ${this.copy("Retained event records", "אירועים שנשמרו")}
                  </caption>
                  <thead>
                    <tr>
                      ${[this.copy("Time", "זמן"), this.copy("Station", "תחנה"), this.copy("Person", "אדם"), this.copy("Result", "תוצאה")].map((label) => html`<th scope="col">${label}</th>`)}
                    </tr>
                  </thead>
                  <tbody>
                    ${((this.result.print_records ?? []) as Values[]).map(
                      (row) =>
                        html`<tr>
                          <td><bdi>${row.display_timestamp}</bdi></td>
                          <td>${row.station}</td>
                          <td>${row.person_name ?? row.employee_no ?? "—"}</td>
                          <td>${row.result}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
            </article>`
          : nothing
      }
      <article>
        <h3>${this.copy("Recent scheduled summaries", "סיכומים מתוזמנים אחרונים")}</h3>
        ${this.data!.report_runs.slice(-20)
          .reverse()
          .map(
            (row) =>
              html`<p>
                ${row.at} ·
                ${this.data!.reports[String(row.report_id)]?.values.label ?? row.report_id} ·
                ${row.total} · ${row.code}
              </p>`,
          )}
      </article>`;
  }
  private audioTab() {
    return html`<article>
      <h2>${this.copy("Remembered speaker", "רמקול שנשמר")}</h2>
      <p>
        ${this.copy("Choose a speaker in the camera's audio settings. The selection is remembered on this browser for your account and restored when listening is opened. If the device is unavailable, system output remains available.", "בחר רמקול בהגדרות השמע של המצלמה. הבחירה נשמרת בדפדפן לחשבון שלך ומשוחזרת כשפותחים האזנה. אם ההתקן אינו זמין, פלט המערכת נשאר זמין.")}
      </p>
      <p>
        ${this.copy("On mobile browsers that do not expose speaker selection, the operating system controls output. No microphone permission is requested to restore a speaker.", "בדפדפנים בנייד שאינם תומכים בבחירת רמקול, מערכת ההפעלה בוחרת את הפלט. שחזור רמקול אינו מבקש הרשאה למיקרופון.")}
      </p>
    </article>`;
  }
  private externalTab() {
    const value = this.value("webhook", this.data!.webhook) as Center["webhook"];
    return html`<article>
      <h2>${this.copy("Signed outgoing notifications", "התראות יוצאות חתומות")}</h2>
      <p>
        ${this.copy("Disabled by default. Only station/result metadata is sent, with no names, phone numbers, PINs or cards. HTTPS only; one attempt, no automatic retry after uncertain delivery.", "כבוי כברירת מחדל. נשלחים רק נתוני תחנה ותוצאה, ללא שמות, טלפונים, קודים או כרטיסים. HTTPS בלבד; ניסיון אחד, ללא ניסיון חוזר אוטומטי לאחר שליחה לא ודאית.")}
      </p>
      <label
        >${this.copy("HTTPS endpoint", "כתובת HTTPS")}<input
          type="url"
          .value=${value.url}
          ?disabled=${this.busy}
          @input=${(e: Event) => this.set("webhook", { ...value, url: (e.target as HTMLInputElement).value })} /></label
      ><label class="check"
        ><input
          type="checkbox"
          .checked=${value.enabled}
          ?disabled=${this.busy}
          @change=${(e: Event) => this.set("webhook", { ...value, enabled: (e.target as HTMLInputElement).checked })}
        />${this.copy("Enable configured endpoint", "הפעל את היעד שהוגדר")}</label
      >${["access_event", "security_denied", "configuration_result"].map((kind, i) => html`<label class="check"><input type="checkbox" .checked=${value.kinds.includes(kind)} ?disabled=${this.busy} @change=${(e: Event) => this.set("webhook", { ...value, kinds: (e.target as HTMLInputElement).checked ? [...value.kinds, kind] : value.kinds.filter((k) => k !== kind) })} />${this.copy(["Access events", "Rejected requests", "Configuration results"][i], ["אירועי גישה", "בקשות שנחסמו", "תוצאות החלת הגדרות"][i])}</label>`)}${this.confirmation()}<button
        ?disabled=${this.busy || !this.confirmed}
        @click=${() =>
          void this.action(async () => {
            await this.api("webhook_save", {
              revision: this.data!.revision,
              values: value,
              confirmed: true,
            });
            await this.load();
            this.confirmed = false;
            this.notice = this.copy("Connection settings saved.", "הגדרות החיבור נשמרו.");
          })}
      >
        ${this.copy("Save connection settings", "שמור הגדרות חיבור")}
      </button>
      <p class="sub">
        ${this.copy("Reveal the signing key only to configure your trusted receiver. Never paste it in messages or support reports.", "הצג את מפתח החתימה רק להגדרת המקבל המורשה שלך. אין להדביק אותו בהודעות או בדוחות תמיכה.")}
      </p>
      <button
        ?disabled=${this.busy || !this.confirmed}
        @click=${() =>
          void this.action(async () => {
            const result = await this.api<{ key: string }>("webhook_key", { confirmed: true });
            this.key = result.key;
          })}
      >
        ${this.copy("Reveal signing key", "הצג מפתח חתימה")}</button
      >${this.key ? html`<code>${this.key}</code><button @click=${() => (this.key = "")}>${this.copy("Hide key", "הסתר מפתח")}</button>` : nothing}
    </article>`;
  }
  private securityTab() {
    return html`<article>
        <h2>${this.copy("Integrity check", "בדיקת שלמות")}</h2>
        <p>
          ${this.copy("Read-only availability and validation checks. Invalid storage is not replaced with empty defaults; recover a known backup before restarting.", "בדיקת זמינות ואימות בלבד. אחסון פגום אינו מוחלף בערכים ריקים; יש לשחזר גיבוי מוכר לפני הפעלה מחדש.")}
        </p>
        <button
          ?disabled=${this.busy}
          @click=${() => void this.action(async () => (this.result = await this.api("integrity")))}
        >
          ${this.copy("Run integrity check", "בצע בדיקת שלמות")}</button
        >${((this.result?.checks ?? []) as Values[]).map((row) => html`<p>${row.component} · ${row.state} · ${row.remedy}</p>`)}
      </article>
      <article>
        <h3>${this.copy("Rejected requests", "בקשות שנחסמו")}</h3>
        <p class="sub">
          ${this.copy("Command and rejection code only. Request bodies, PINs, passwords and signing keys are never recorded here.", "שם פקודה וסיבת חסימה בלבד. תוכן הבקשה, PIN, סיסמאות ומפתחות אינם נשמרים כאן.")}
        </p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>${this.copy("Time", "זמן")}</th>
                <th>${this.copy("Account", "חשבון")}</th>
                <th>${this.copy("Command", "פקודה")}</th>
                <th>${this.copy("Reason", "סיבה")}</th>
              </tr>
            </thead>
            <tbody>
              ${this.data!.journal.slice(-100)
                .reverse()
                .map(
                  (row) =>
                    html`<tr>
                      <td>${row.at}</td>
                      <td>${row.actor}</td>
                      <td>${row.command}</td>
                      <td>${row.code}</td>
                    </tr>`,
                )}
            </tbody>
          </table>
        </div>
      </article>`;
  }
  private migrationTab() {
    let sources: Record<string, { name: string }> = {};
    try {
      sources = JSON.parse(this.content).stations ?? {};
    } catch {
      /* Invalid files are rejected by the server. */
    }
    return html`<article>
        <h2>${this.copy("Transfer operations preferences", "העברת הגדרות תפעול")}</h2>
        <p>
          ${this.copy("Includes station metadata, thresholds, maintenance windows and message variants. Does not include people, access rights, credentials, keys or webhook destinations. Use encrypted backup for people.", "כולל פרטי תחנה, ספים, חלונות תחזוקה ותבניות הודעה. אינו כולל אנשים, הרשאות גישה, סודות, מפתחות או יעדי webhook. להעברת אנשים השתמש בגיבוי המוצפן.")}
        </p>
        <button
          ?disabled=${this.busy}
          @click=${() => void this.action(async () => downloadText(JSON.stringify(await this.api("export"), null, 2), "smplwise-operations.json", "application/json"))}
        >
          ${this.copy("Export preferences", "ייצא הגדרות")}</button
        ><label
          >${this.copy("Preferences file", "קובץ הגדרות")}<input
            type="file"
            accept=".json,application/json"
            ?disabled=${this.busy}
            @change=${async (e: Event) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (!file) return;
              if (file.size > 60000) {
                this.error = this.copy("File exceeds 60 KB.", "הקובץ גדול מ־60 KB.");
                return;
              }
              const epoch = this.epoch;
              const content = await file.text();
              if (epoch !== this.epoch || !this.isConnected || !this.authorized) return;
              this.content = content;
              this.mapping = {};
              this.review = null;
            }} /></label
        >${Object.entries(sources).map(
          ([id, row]) =>
            html`<label
              >${row.name} → ${this.copy("Target station", "תחנת יעד")}<select
                .value=${this.mapping[id] ?? ""}
                ?disabled=${this.busy}
                @change=${(e: Event) => {
                  this.mapping = { ...this.mapping, [id]: (e.target as HTMLSelectElement).value };
                  this.review = null;
                }}
              >
                <option value="">${this.copy("Choose explicitly", "בחר במפורש")}</option>
                ${Object.entries(this.data!.catalog).map(([target, name]) => html`<option value=${target}>${name}</option>`)}
              </select></label
            >`,
        )}<button
          ?disabled=${this.busy || !this.content}
          @click=${() =>
            void this.action(async () => {
              this.review = await this.api("import_preview", {
                content: this.content,
                mapping: this.mapping,
              });
              this.confirmed = false;
            })}
        >
          ${this.copy("Review mapped import", "סקור ייבוא עם מיפוי")}</button
        >${
          this.review
            ? html`<p>
                  ${this.copy("Message variant library will be replaced; mapped station preferences will be updated.", "ספריית תבניות ההודעה תוחלף; הגדרות התחנות שמופו יעודכנו.")}
                </p>
                ${((this.review.stations ?? []) as Values[]).map((row) => html`<p>${row.name} → ${this.data!.catalog[String(row.target)]} · ${row.replaces ? this.copy("replaces preferences", "מחליף הגדרות") : this.copy("new preferences", "הגדרות חדשות")}</p>`)}${this.confirmation()}<button
                  ?disabled=${this.busy || !this.confirmed}
                  @click=${() =>
                    void this.action(async () => {
                      await this.api("import_apply", {
                        review_id: this.review!.review_id,
                        confirmed: true,
                      });
                      this.review = null;
                      await this.load();
                      this.notice = this.copy(
                        "Preferences imported. No device writes.",
                        "ההגדרות יובאו. לא בוצעה כתיבה לציוד.",
                      );
                    })}
                >
                  ${this.copy("Apply mapped import", "החל ייבוא שמופה")}
                </button>`
            : nothing
        }
      </article>
      <article>
        <h3>${this.copy("Demonstration and setup checklist", "הדגמה ורשימת קבלה להתקנה")}</h3>
        <button
          ?disabled=${this.busy}
          @click=${() => void this.action(async () => (this.result = await this.api("demo")))}
        >
          ${this.copy("Open safe demonstration", "פתח הדגמה בטוחה")}</button
        >${
          this.result?.demo
            ? html`<p>
                  ${this.copy("Synthetic data only; zero device writes.", "נתונים סינתטיים בלבד; ללא כתיבה לציוד.")}
                </p>
                ${((this.result.stations ?? []) as Values[]).map((row) => html`<p>${row.name} · ${row.online ? this.copy("online", "מחובר") : this.copy("offline", "מנותק")}</p>`)}
                <div class="checklist">
                  ${[this.copy("Station identity and address verified", "זהות וכתובת התחנה אומתו"), this.copy("Physical relay mapping verified", "מיפוי הממסרים הפיזיים אומת"), this.copy("Test person grant and revocation checked", "נבדקו מתן הרשאה וביטולה למשתמש בדיקה"), this.copy("Physical audio playback checked", "נבדקה השמעת שמע פיזית"), this.copy("Backup and restore checked on a copy", "נבדקו גיבוי ושחזור על עותק")].map((label) => html`<label class="check"><input type="checkbox" />${label}</label>`)}
                </div>
                <p class="sub">
                  ${this.copy("These checklist marks are local notes, not device verification records. Record field results in the existing acceptance screen.", "הסימונים הם הערות מקומיות, ואינם רשומות אימות ציוד. תעד תוצאות שטח במסך הקבלה הקיים.")}
                </p>`
            : nothing
        }
      </article>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const panels: Record<Tab, () => unknown> = {
      messages: () => this.messageTab(),
      fleet: () => this.fleetTab(),
      configuration: () => this.configurationTab(),
      health: () => this.healthTab(),
      events: () => this.eventsTab(),
      reports: () => this.reportsTab(),
      audio: () => this.audioTab(),
      external: () => this.externalTab(),
      security: () => this.securityTab(),
      migration: () => this.migrationTab(),
    };
    return html`<div dir=${this.hass.language?.startsWith("he") ? "rtl" : "ltr"}>
      <nav aria-label=${this.copy("Operations sections", "נושאי תפעול")}>
        ${tabs.map((tab) => html`<button ?disabled=${this.busy} aria-current=${this.tab === tab ? "page" : nothing} @click=${() => this.switch(tab)}>${this.copy(...labels[tab])}</button>`)}
      </nav>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}${this.notice ? html`<p role="status">${this.notice}</p>` : nothing}${
        this.data
          ? panels[this.tab]()
          : html`<p>${this.copy("Loading operations settings…", "טוען הגדרות תפעול…")}</p>
              <button ?disabled=${this.busy} @click=${() => void this.action(() => this.load())}>
                ${this.copy("Retry", "נסה שוב")}
              </button>`
      }
    </div>`;
  }
}
customElements.define("wiskey-platform-center", PlatformCenter);
