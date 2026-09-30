import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { ScopedRequests } from "./request";
import { formatTime, UTC_ZONE, type DisplayZone } from "./time";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";

type Kind = "all" | "people" | "events" | "actions";
type Row = Record<string, any>;
interface Section {
  available: boolean;
  total: number | null;
  records: Row[];
  next_offset: number | null;
  previous_offset: number | null;
}
interface Result {
  query: string;
  kind: Kind;
  offset: number;
  snapshot: string;
  stale: boolean;
  sections: Record<Exclude<Kind, "all">, Section>;
  coverage: {
    event_retention_days: number | null;
    action_retention_days: number | null;
    event_storage_failed: boolean | null;
  };
}

export class UnifiedSearch extends LitElement {
  static properties = {
    hass: { attribute: false },
    context: { type: String },
    canView: { type: Boolean },
    canOpenPerson: { type: Boolean },
    canOpenEvents: { type: Boolean },
    canOpenActions: { type: Boolean },
    stations: { attribute: false },
    zone: { attribute: false },
    data: { state: true },
    busy: { state: true },
    error: { state: true },
    text: { state: true },
    kind: { state: true },
  };
  static styles = css`
    :host {
      color: var(--primary-text-color, #233a37);
      font: inherit;
    }
    * {
      box-sizing: border-box;
    }
    dialog {
      color: inherit;
      background: var(--surface, var(--card-background-color, #fff));
      border: 1px solid var(--line, var(--divider-color, #dbe4e1));
      border-radius: 18px;
      padding: 0;
      width: min(920px, calc(100vw - 24px));
      max-height: calc(100dvh - 32px);
    }
    dialog::backdrop {
      background: #08181988;
      backdrop-filter: blur(3px);
    }
    header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--line, var(--divider-color, #dbe4e1));
    }
    h2 {
      margin: 0;
      font-size: 1.2rem;
      flex: 1;
    }
    main {
      padding: 16px 20px;
      overflow: auto;
      max-height: calc(100dvh - 108px);
    }
    form,
    .tabs,
    .pager {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    input {
      flex: 1;
      min-width: 140px;
      width: 100%;
    }
    button,
    input {
      font: inherit;
      color: inherit;
      border: 1px solid var(--line, var(--divider-color, #dbe4e1));
      background: var(--surface, var(--card-background-color, #fff));
      border-radius: 9px;
      padding: 9px 12px;
      min-height: 42px;
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
      opacity: 0.5;
    }
    .primary,
    [aria-pressed="true"] {
      background: var(--accent, var(--primary-color, #397e72));
      color: var(--on-accent, #fff);
      border-color: transparent;
    }
    .tabs {
      margin: 14px 0;
    }
    .tabs button {
      font-size: 0.9rem;
    }
    .hint {
      color: var(--secondary-text-color, #667977);
      font-size: 0.86rem;
      line-height: 1.5;
      margin: 10px 0;
    }
    section {
      margin: 14px 0;
    }
    h3 {
      margin: 8px 0;
      font-size: 1rem;
    }
    article {
      padding: 10px 12px;
      border: 1px solid var(--line, var(--divider-color, #dbe4e1));
      border-radius: 10px;
      margin: 7px 0;
      overflow-wrap: anywhere;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .name {
      flex: 1;
      min-width: 100px;
      font-weight: 600;
    }
    .sub {
      color: var(--secondary-text-color, #667977);
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .phone {
      white-space: nowrap;
    }
    details {
      margin-top: 7px;
    }
    summary {
      cursor: pointer;
      font-size: 0.9rem;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 5px 14px;
      margin: 10px 0;
      font-size: 0.9rem;
    }
    dd {
      margin: 0;
    }
    .error {
      color: var(--error-color, #b64b46);
    }
    .pager {
      justify-content: flex-end;
    }
    :focus-visible {
      outline: 3px solid var(--accent, var(--primary-color, #397e72));
      outline-offset: 2px;
    }
    @media (max-width: 500px) {
      header,
      main {
        padding: 12px;
      }
      .tabs button {
        padding: 8px;
      }
      dl {
        grid-template-columns: 1fr;
      }
      dd {
        margin-bottom: 5px;
      }
    }
  `;
  hass?: Hass;
  context = "";
  canView = false;
  canOpenPerson = false;
  canOpenEvents = false;
  canOpenActions = false;
  stations: Station[] = [];
  zone: DisplayZone = UTC_ZONE;
  private data?: Result;
  private busy = false;
  private error = "";
  private text = "";
  private kind: Kind = "all";
  private epoch = 0;
  private sequence = 0;
  private actor = "";
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(
    () => this.hass,
    () => this.canView,
  );
  private disconnect = () => {
    this.reset();
    this.error = this.label(
      "Connection lost. Reconnect and search again.",
      "החיבור אבד. התחבר וחפש שוב.",
    );
  };
  private label(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  private kindTitle(kind: Kind) {
    return {
      all: this.label("All", "הכול"),
      people: this.label("People", "אנשים"),
      events: this.label("Access events", "אירועי גישה"),
      actions: this.label("Action history", "יומן פעולות"),
    }[kind];
  }
  connectedCallback() {
    super.connectedCallback();
  }
  disconnectedCallback() {
    this.connection?.removeEventListener?.("disconnected", this.disconnect);
    this.reset();
    super.disconnectedCallback();
  }
  private reset() {
    this.epoch++;
    this.sequence++;
    this.requests.cancel();
    this.data = undefined;
    this.text = "";
    this.kind = "all";
    this.busy = false;
    this.error = "";
  }
  protected updated(changed: PropertyValues) {
    if (
      changed.has("context") ||
      changed.has("canView") ||
      this.actor !== this.hass?.user?.id ||
      this.connection !== this.hass?.connection
    ) {
      this.connection?.removeEventListener?.("disconnected", this.disconnect);
      this.reset();
      this.actor = this.hass?.user?.id ?? "";
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.disconnect);
    }
    const dialog = this.renderRoot.querySelector("dialog");
    if (dialog && !dialog.open) {
      dialog.showModal();
      this.renderRoot.querySelector<HTMLInputElement>("input")?.focus();
    }
  }
  private close() {
    this.reset();
    this.renderRoot.querySelector("dialog")?.close();
    this.dispatchEvent(new CustomEvent("search-close", { bubbles: true, composed: true }));
  }
  private async search(offset = 0, snapshot = "") {
    if (!this.canView || !this.text.trim()) return;
    this.requests.cancel();
    const epoch = this.epoch,
      sequence = ++this.sequence;
    this.busy = true;
    this.error = "";
    this.data = undefined;
    try {
      const data = await this.requests.run<Result>({
        type: "hikvision_intercom/search/query",
        api_contract: 1,
        query: this.text,
        kind: this.kind,
        offset,
        limit: 25,
        snapshot,
      });
      if (this.isConnected && epoch === this.epoch && sequence === this.sequence) this.data = data;
    } catch (error) {
      if (epoch === this.epoch && sequence === this.sequence) {
        this.data = undefined;
        this.error = translate(
          this.hass?.language ?? "en",
          (error as { code?: string }).code || "action_failed",
        );
      }
    } finally {
      if (epoch === this.epoch && sequence === this.sequence) this.busy = false;
    }
  }
  private select(kind: Kind) {
    this.kind = kind;
    void this.search();
  }
  private time(row: Row) {
    const zone = row.station_id
      ? (this.stations.find((s) => s.id === row.station_id)?.clock?.zone ?? this.zone)
      : this.zone;
    return formatTime(row.timestamp ?? row.time, this.hass?.language, zone);
  }
  private code(value: string) {
    return translate(this.hass?.language ?? "en", value);
  }
  private openPerson(id: string) {
    if (!this.canOpenPerson) return;
    this.dispatchEvent(new CustomEvent("open-user", { detail: id, bubbles: true, composed: true }));
  }
  private journal(kind: "events" | "actions") {
    this.dispatchEvent(
      new CustomEvent("open-journal", { detail: kind, bubbles: true, composed: true }),
    );
    this.close();
  }
  private row(kind: Exclude<Kind, "all">, row: Row) {
    if (kind === "people")
      return html`<article>
        <div class="row">
          <span class="name">${row.name}</span
          ><bdi>${row.employee_no}</bdi
          >${row.phone ? html`<bdi class="phone">${row.phone}</bdi>` : nothing}${this.canOpenPerson ? html`<button @click=${() => this.openPerson(row.id)}>${this.label("View person", "פרטי אדם")}</button>` : nothing}
        </div>
        <div class="sub">
          ${row.archived ? this.label("Archived", "בארכיון") : row.active ? this.label("Active", "פעיל") : this.label("Inactive", "לא פעיל")}
        </div>
      </article>`;
    if (kind === "events")
      return html`<article>
        <div class="row">
          <span class="name">${row.person_name || this.label("Unidentified", "לא מזוהה")}</span
          ><span>${row.station_name || this.label("Removed station", "תחנה שהוסרה")}</span
          ><bdi class="sub">${this.time(row)}</bdi>
        </div>
        <div class="sub">
          ${this.code(row.event_type)} · ${this.code(row.result)} · ${this.code(row.authentication)}
        </div>
        <details>
          <summary>${this.label("Event evidence", "ראיות האירוע")}</summary>
          <dl>
            <dt>${this.label("Observed employee ID", "מזהה עובד באירוע")}</dt>
            <dd><bdi>${row.employee_no || "—"}</bdi></dd>
            <dt>${this.label("Door", "דלת")}</dt>
            <dd>${row.door ?? "—"}</dd>
            <dt>${this.label("Source", "מקור")}</dt>
            <dd>
              ${row.source === "query" ? this.label("Station history", "היסטוריית התחנה") : row.source === "call_status" ? this.label("Call status polling", "בדיקת מצב שיחה") : this.label("Event stream", "זרם אירועים")}
            </dd>
            <dt>${this.label("Time evidence", "מקור הזמן")}</dt>
            <dd>
              ${row.time_source === "device" ? this.label("Device timestamp", "זמן הציוד") : this.label("Receipt timestamp", "זמן הקבלה")}
            </dd>
            ${
              row.card
                ? html`<dt>${this.label("Card suffix", "סיומת כרטיס")}</dt>
                    <dd><bdi>${row.card}</bdi></dd>`
                : nothing
            }
          </dl>
        </details>
      </article>`;
    return html`<article>
      <div class="row">
        <span class="name">${row.name_after || row.name_before || "—"}</span
        ><span
          >${this.code(row.action.startsWith("bulk/") ? row.action.replace("/", "_") : "audit_source_" + row.action.replaceAll("/", "_"))}</span
        ><bdi class="sub">${this.time(row)}</bdi>
      </div>
      <details>
        <summary>${this.label("Change evidence", "תיעוד השינוי")}</summary>
        <dl>
          <dt>${this.label("Operator", "מפעיל")}</dt>
          <dd>${row.actor_name || this.label("Unavailable operator", "מפעיל לא זמין")}</dd>
          <dt>${this.label("Previous name", "שם קודם")}</dt>
          <dd>${row.name_before || "—"}</dd>
          <dt>${this.label("Name after change", "שם לאחר שינוי")}</dt>
          <dd>${row.name_after || "—"}</dd>
          <dt>${this.label("Changed fields", "שדות ששונו")}</dt>
          <dd>${row.fields.map((f: string) => this.code("audit_field_" + f)).join(", ")}</dd>
          <dt>${this.label("Stations", "תחנות")}</dt>
          <dd>${row.stations.filter(Boolean).join(", ") || "—"}</dd>
        </dl>
      </details>
    </article>`;
  }
  render() {
    if (!this.canView) return nothing;
    const kinds = ["people", "events", "actions"] as const;
    return html`<dialog
      aria-labelledby="search-title"
      dir=${this.hass?.language?.startsWith("he") ? "rtl" : "ltr"}
      @cancel=${(event: Event) => {
        event.preventDefault();
        this.close();
      }}
    >
      <header>
        <h2 id="search-title">${this.label("Search across the system", "חיפוש במערכת")}</h2>
        <button aria-label=${this.label("Close search", "סגור חיפוש")} @click=${() => this.close()}>
          ✕
        </button>
      </header>
      <main>
        <form
          @submit=${(event: Event) => {
            event.preventDefault();
            void this.search();
          }}
        >
          <input
            type="search"
            maxlength="160"
            aria-label=${this.label("Search people and activity", "חיפוש אנשים ופעילות")}
            placeholder=${this.label("Name, employee ID, phone, station or action", "שם, מזהה עובד, טלפון, תחנה או פעולה")}
            .value=${this.text}
            @input=${(event: Event) => {
              this.text = (event.target as HTMLInputElement).value;
              this.data = undefined;
              this.sequence++;
              this.requests.cancel();
              this.busy = false;
            }}
          /><button class="primary" ?disabled=${this.busy || !this.text.trim()} type="submit">
            ${this.label("Search", "חיפוש")}
          </button>
        </form>
        <p class="hint">
          ${this.label("Search covers only visible people and retained activity. It does not prove complete station history.", "החיפוש כולל רק אנשים גלויים ופעילות שנשמרה. הוא אינו מעיד על היסטוריה מלאה של התחנות.")}
        </p>
        <div class="tabs" aria-label=${this.label("Search sources", "מקורות החיפוש")}>
          <button aria-pressed=${this.kind === "all"} @click=${() => this.select("all")}>
            ${this.kindTitle("all")}</button
          >${kinds.map((kind) => html`<button ?disabled=${this.data?.sections[kind].available === false || this.busy} aria-pressed=${this.kind === kind} @click=${() => this.select(kind)}>${this.kindTitle(kind)}${this.data?.sections[kind].total != null ? " · " + this.data.sections[kind].total : ""}</button>`)}
        </div>
        ${this.busy ? html`<p role="status">${this.label("Searching…", "מחפש…")}</p>` : nothing}${this.error ? html`<p role="alert" class="error">${this.error}</p>` : nothing}${this.data?.stale ? html`<p role="status" class="hint">${this.label("Visible records changed. Showing the first page again.", "הרשומות הגלויות השתנו. מוצג שוב העמוד הראשון.")}</p>` : nothing}${this.data?.coverage.event_storage_failed ? html`<p role="alert" class="error">${this.label("Event storage has a problem. Results may be incomplete.", "קיימת בעיה בשמירת האירועים. ייתכן שהתוצאות חלקיות.")}</p>` : nothing}${
          this.data
            ? kinds
                .filter((kind) => this.kind === "all" || this.kind === kind)
                .map((kind) => {
                  const section = this.data!.sections[kind];
                  return html`<section aria-label=${this.kindTitle(kind)}>
                    <h3>
                      ${this.kindTitle(kind)}${section.total != null ? " · " + section.total : ""}
                    </h3>
                    ${!section.available ? html`<p class="hint">${this.label("This source is outside your viewing permissions.", "מקור זה אינו כלול בהרשאות הצפייה שלך.")}</p>` : section.records.length ? section.records.map((row) => this.row(kind, row)) : html`<p class="hint">${this.label("No matching records.", "לא נמצאו רשומות תואמות.")}</p>`}${this.kind === "all" && section.next_offset != null ? html`<button @click=${() => this.select(kind)}>${this.label("Show all matches", "הצג את כל התוצאות")}</button>` : nothing}${kind === "events" && this.canOpenEvents ? html`<button @click=${() => this.journal("events")}>${this.label("Open event journal", "פתח יומן אירועים")}</button>` : kind === "actions" && this.canOpenActions ? html`<button @click=${() => this.journal("actions")}>${this.label("Open action history", "פתח יומן פעולות")}</button>` : nothing}${this.kind === kind ? html`<div class="pager"><button ?disabled=${section.previous_offset == null || this.busy} @click=${() => void this.search(section.previous_offset!, this.data!.snapshot)}>${this.label("Previous", "הקודם")}</button><span>${section.records.length ? this.data!.offset + 1 : 0}–${this.data!.offset + section.records.length} / ${section.total}</span><button ?disabled=${section.next_offset == null || this.busy} @click=${() => void this.search(section.next_offset!, this.data!.snapshot)}>${this.label("Next", "הבא")}</button></div>` : nothing}
                  </section>`;
                })
            : nothing
        }
      </main>
    </dialog>`;
  }
}
customElements.define("wiskey-unified-search", UnifiedSearch);
