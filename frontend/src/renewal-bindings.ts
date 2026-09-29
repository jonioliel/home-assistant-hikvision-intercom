import { LitElement, css, html, nothing } from "lit";
import type { Hass } from "./types";
import { ScopedRequests } from "./request";
interface BindingData {
  revision: number;
  bindings: Record<string, { user_id: string; name: string; available: boolean }>;
  directory: { id: string; name: string; active: boolean }[];
}
interface PersonChoice {
  id: string;
  display_name: string;
  employee_no: string;
}
interface PeoplePage {
  records: PersonChoice[];
  next_offset: number | null;
  previous_offset: number | null;
  snapshot: string;
  total: number;
  stale: boolean;
}
export class WiskeyRenewalBindings extends LitElement {
  static properties = {
    hass: { attribute: false },
    _data: { state: true },
    _people: { state: true },
    _account: { state: true },
    _person: { state: true },
    _query: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _saved: { state: true },
  };
  static styles = css`
    :host {
      display: block;
      margin-top: 24px;
      color: var(--ink, inherit);
    }
    section {
      border: 1px solid var(--line, #d6dfe1);
      padding: 18px;
      border-radius: 12px;
      background: var(--surface, var(--card-background-color, #fff));
    }
    h2 {
      margin-top: 0;
      font-size: 19px;
    }
    p {
      line-height: 1.6;
    }
    .hint {
      color: var(--muted, var(--secondary-text-color, #63747b));
    }
    .row {
      display: flex;
      gap: 10px;
      align-items: end;
      flex-wrap: wrap;
    }
    label {
      display: block;
      flex: 1;
      min-width: 180px;
      margin: 8px 0;
    }
    input,
    select {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 6px;
      padding: 10px;
      font: inherit;
      border: 1px solid var(--line, #d6dfe1);
      border-radius: 8px;
      background: var(--surface, var(--card-background-color, #fff));
      color: inherit;
    }
    button {
      font: inherit;
      border: 1px solid var(--line, #d6dfe1);
      border-radius: 8px;
      padding: 10px 14px;
      cursor: pointer;
      background: var(--surface, var(--card-background-color, #fff));
      color: inherit;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .error {
      color: var(--error-color, #ac2835);
    }
    a {
      color: var(--accent, #377e72);
    }
    :focus-visible {
      outline: 3px solid var(--accent, #377e72);
      outline-offset: 3px;
    }
  `;
  hass?: Hass;
  private _data?: BindingData;
  private _people?: PeoplePage;
  private _account = "";
  private _person = "";
  private _query = "";
  private _busy = false;
  private _error = "";
  private _saved = false;
  private epoch = 0;
  private actor = "";
  private connection?: Hass["connection"];
  private scope = new ScopedRequests(() => this.hass);
  private lost = () => {
    this.clear();
    this._error = this.text(
      "Connection lost. Refresh before editing.",
      "החיבור אבד. רענן לפני עריכה.",
    );
  };
  connectedCallback() {
    super.connectedCallback();
    if (this.hass) this.attach();
  }
  disconnectedCallback() {
    this.connection?.removeEventListener?.("disconnected", this.lost);
    this.clear();
    super.disconnectedCallback();
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has("hass") && !this.hass?.user?.is_admin) {
      this.clear();
      return;
    }
    if (
      changed.has("hass") &&
      (this.actor !== this.hass?.user?.id || this.connection !== this.hass?.connection)
    )
      this.attach();
  }
  private clear() {
    this.epoch++;
    this.scope.cancel();
    this._data = undefined;
    this._people = undefined;
    this._account = "";
    this._person = "";
    this._query = "";
    this._busy = false;
    this._saved = false;
  }
  private attach() {
    this.connection?.removeEventListener?.("disconnected", this.lost);
    this.clear();
    this.actor = this.hass?.user?.id || "";
    this.connection = this.hass?.connection;
    this.connection?.addEventListener?.("disconnected", this.lost);
    void this.load();
  }
  private text(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  private async request<T>(command: string, data: Record<string, unknown> = {}) {
    return this.scope.run<T>({ type: `hikvision_intercom/${command}`, api_contract: 1, ...data });
  }
  private error(error: unknown) {
    const code = (error as { code?: string }).code;
    this._error =
      code === "revision_conflict"
        ? this.text("Mappings changed. Refresh before saving.", "השיוכים השתנו. רענן לפני שמירה.")
        : code === "renewal_identity_in_use"
          ? this.text(
              "This person is linked to another account. Remove that mapping first.",
              "האדם כבר משויך לחשבון אחר. הסר קודם את השיוך הקיים.",
            )
          : this.text(
              "The operation was not confirmed. Refresh to verify the saved mapping.",
              "הפעולה לא אושרה. רענן לאימות השיוך שנשמר.",
            );
  }
  private async load() {
    if (this._busy || !this.hass?.user?.is_admin) return;
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    try {
      const data = await this.request<BindingData>("renewal/bindings");
      if (epoch === this.epoch) {
        this._data = data;
        this._person = "";
      }
    } catch (error) {
      if (epoch === this.epoch) this.error(error);
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private async search(offset = 0) {
    if (this._busy) return;
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    try {
      const page = await this.request<PeoplePage>("users/query", {
        query: this._query,
        filters: {},
        offset,
        limit: 50,
        snapshot: offset ? this._people?.snapshot || "" : "",
      });
      if (epoch === this.epoch) {
        this._people = page;
        this._person = "";
        if (page.stale)
          this._error = this.text(
            "The directory changed. Review the refreshed results.",
            "רשימת האנשים השתנתה. בדוק את התוצאות המעודכנות.",
          );
      }
    } catch (error) {
      if (epoch === this.epoch) this.error(error);
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  private async save(remove = false) {
    if (this._busy || !this._data || !this._account || (!remove && !this._person)) return;
    const account = this._data.directory.find((a) => a.id === this._account),
      person = this._people?.records.find((p) => p.id === this._person);
    const description = remove
      ? this.text(
          `Remove the mapping for ${account?.name || this._account}? Pending personal requests will be cancelled.`,
          `להסיר את השיוך של ${account?.name || this._account}? בקשות אישיות ממתינות יבוטלו.`,
        )
      : this.text(
          `Link ${account?.name} to ${person?.display_name}? Replacing a mapping cancels its pending requests. This grants no operator permissions.`,
          `לשייך את ${account?.name} אל ${person?.display_name}? החלפת שיוך מבטלת בקשות ממתינות. השיוך אינו מעניק הרשאות ניהול.`,
        );
    if (!window.confirm(description)) return;
    const epoch = this.epoch;
    this._busy = true;
    this._error = "";
    this._saved = false;
    try {
      const data = await this.request<BindingData>("renewal/binding_update", {
        account_id: this._account,
        user_id: remove ? "" : this._person,
        revision: this._data.revision,
        confirmed: true,
      });
      if (epoch === this.epoch) {
        this._data = data;
        this._person = "";
        this._saved = true;
      }
    } catch (error) {
      if (epoch === this.epoch) {
        this.error(error);
        this._data = undefined;
      }
    } finally {
      if (epoch === this.epoch) this._busy = false;
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const current = this._data?.bindings[this._account];
    return html`<section dir=${this.hass.language?.startsWith("he") ? "rtl" : "ltr"}>
      <div class="row">
        <h2>${this.text("Personal renewal accounts", "חשבונות לחידוש הרשאה אישי")}</h2>
        <button ?disabled=${this._busy} @click=${() => this.load()}>
          ${this.text("Refresh", "רענון")}
        </button>
      </div>
      <p class="hint">
        ${this.text("Link one verified personal account to one access record. The person can request a finite extension; a different administrator must approve it. Operator permissions remain separate.", "שייך חשבון אישי מאומת לרשומת אדם אחת. האדם יוכל לבקש הארכת תוקף מוגבל; מנהל אחר נדרש לאשר אותה. הרשאות הניהול מוגדרות בנפרד.")}
      </p>
      <p>
        <a href="/wiskey-renewal"
          >${this.text("Open personal renewal page", "פתיחת מסך החידוש האישי")}</a
        >
      </p>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}${this._saved ? html`<p role="status">${this.text("Mapping saved.", "השיוך נשמר.")}</p>` : nothing}${
        this._data
          ? html`<label
                >${this.text("Personal account", "חשבון אישי")}<select
                  aria-label=${this.text("Personal account", "חשבון אישי")}
                  .value=${this._account}
                  ?disabled=${this._busy}
                  @change=${(e: Event) => {
                    this._account = (e.target as HTMLSelectElement).value;
                    this._person = "";
                    this._saved = false;
                  }}
                >
                  <option value="">${this.text("Choose an account", "בחר חשבון")}</option>
                  ${this._data.directory.map((a) => html`<option value=${a.id}>${a.name || a.id}${!a.active ? this.text(" (inactive)", " (לא פעיל)") : ""}</option>`)}${Object.keys(
                    this._data.bindings,
                  )
                    .filter((id) => !this._data!.directory.some((a) => a.id === id))
                    .map(
                      (id) =>
                        html`<option value=${id}>
                          ${this.text("Removed account", "חשבון שהוסר")} · ${id}
                        </option>`,
                    )}
                </select></label
              >${
                current
                  ? html`<p>
                        ${this.text("Current mapping:", "שיוך נוכחי:")}
                        <strong>${current.name}</strong
                        >${!current.available ? this.text(" (record unavailable)", " (הרשומה אינה זמינה)") : ""}
                      </p>
                      <button ?disabled=${this._busy} @click=${() => this.save(true)}>
                        ${this.text("Remove mapping", "הסר שיוך")}
                      </button>`
                  : nothing
              }
              ${
                this._account && this._data.directory.find((a) => a.id === this._account)?.active
                  ? html`<div class="row">
                        <label
                          >${this.text("Find an access record", "חיפוש אדם לשיוך")}<input
                            .value=${this._query}
                            ?disabled=${this._busy}
                            @input=${(e: Event) => {
                              this._query = (e.target as HTMLInputElement).value;
                              this._people = undefined;
                              this._person = "";
                            }}
                            @keydown=${(e: KeyboardEvent) => {
                              if (e.key === "Enter") void this.search();
                            }} /></label
                        ><button ?disabled=${this._busy} @click=${() => this.search()}>
                          ${this.text("Search", "חיפוש")}
                        </button>
                      </div>
                      ${
                        this._people
                          ? html`<label
                                >${this.text("Access record", "רשומת אדם")}<select
                                  aria-label=${this.text("Access record", "רשומת אדם")}
                                  .value=${this._person}
                                  ?disabled=${this._busy}
                                  @change=${(e: Event) => (this._person = (e.target as HTMLSelectElement).value)}
                                >
                                  <option value="">
                                    ${this.text("Choose a person", "בחר אדם")}
                                  </option>
                                  ${this._people.records.map((p) => html`<option value=${p.id}>${p.display_name} · ${p.employee_no}</option>`)}
                                </select></label
                              >
                              <div class="row">
                                <button
                                  ?disabled=${this._busy || this._people.previous_offset === null}
                                  @click=${() => this.search(this._people!.previous_offset!)}
                                >
                                  ${this.text("Previous", "הקודם")}</button
                                ><span>${this._people.total} ${this.text("results", "תוצאות")}</span
                                ><button
                                  ?disabled=${this._busy || this._people.next_offset === null}
                                  @click=${() => this.search(this._people!.next_offset!)}
                                >
                                  ${this.text("Next", "הבא")}</button
                                ><button
                                  ?disabled=${this._busy || !this._person}
                                  @click=${() => this.save()}
                                >
                                  ${this.text("Save mapping", "שמור שיוך")}
                                </button>
                              </div>`
                          : nothing
                      }`
                  : nothing
              }`
          : html`<p>${this.text("Refresh to load mappings.", "רענן לטעינת השיוכים.")}</p>`
      }
    </section>`;
  }
}
customElements.define("wiskey-renewal-bindings", WiskeyRenewalBindings);
