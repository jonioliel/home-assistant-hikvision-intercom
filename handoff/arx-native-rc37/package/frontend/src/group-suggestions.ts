import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { DataQuality } from "./data-quality";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass } from "./types";
interface Preview {
  user_id: string;
  person_revision: number;
  policy_revision: number;
  fingerprint: string;
  fields: { id: string; label: string; value: string }[];
  selected_fields: string[];
  can_apply_to_draft: boolean;
  suggestions: {
    group_id: string;
    label: string;
    matching_members: number;
    matching_people: number;
    doors: { station_name: string; before: number[]; after: number[]; blocked: boolean }[];
  }[];
}
const copy: Record<string, [string, string]> = {
  title: ["Group suggestions", "הצעות שיוך לקבוצות"],
  intro: [
    "Choose profile fields to find existing membership patterns. Suggestions are not policy or proof of admission.",
    "בחר שדות פרופיל להשוואת שיוכים קיימים. ההצעות אינן מדיניות ואינן הוכחת כניסה.",
  ],
  load: ["Review suggestions", "סקירת הצעות שיוך"],
  analyze: ["Find suggestions", "מצא הצעות"],
  empty: ["No matching groups in the visible scope.", "אין קבוצות תואמות בהיקף הצפייה."],
  unavailable: [
    "No eligible profile values are available. Unique, hidden, inactive and conditional values with unknown applicability are excluded.",
    "אין ערכי פרופיל מתאימים. שדות ייחודיים, מוסתרים, לא פעילים או שתחולתם אינה ידועה אינם משמשים להצעות.",
  ],
  save: [
    "Save current changes before reviewing suggestions.",
    "שמור את השינויים הנוכחיים לפני סקירת הצעות.",
  ],
  evidence: ["Visible matching members", "חברים תואמים בהיקף הצפייה"],
  blocked: ["Personal block preserved", "החסימה האישית נשמרת"],
  nochange: ["Existing door mapping preserved", "מיפוי הדלתות הקיים נשמר"],
  adds: ["Adds lock 1", "מוסיף מנעול 1"],
  confirm: ["I reviewed the groups and door changes", "סקרתי את הקבוצות ואת שינויי הדלתות"],
  apply: ["Add selected groups to draft", "הוסף קבוצות שנבחרו לעריכה"],
  applied: [
    "Groups added to the draft. Review and save using the existing access workflow.",
    "הקבוצות נוספו לעריכה. יש לסקור ולשמור במסלול ההרשאות הקיים.",
  ],
  stale: [
    "Source data changed. Review the refreshed suggestions again.",
    "נתוני המקור השתנו. יש לסקור שוב את ההצעות המעודכנות.",
  ],
  boundary: [
    "Personal blocks, credentials and schedules stay unchanged. This step does not save or synchronise access.",
    "חסימות אישיות, אמצעי גישה ולוחות זמנים נשמרים. שלב זה אינו שומר או מסנכרן הרשאה.",
  ],
};
export class GroupSuggestions extends LitElement {
  static properties = {
    hass: { attribute: false },
    context: { type: String },
    userId: { type: String },
    personRevision: { type: Number },
    policyRevision: { type: Number },
    canView: { type: Boolean },
    canManage: { type: Boolean },
    draftUnchanged: { type: Boolean },
    data: { state: true },
    busy: { state: true },
    error: { state: true },
    selectedFields: { state: true },
    selectedGroups: { state: true },
    confirmed: { state: true },
    applied: { state: true },
  };
  static styles = [
    DataQuality.styles,
    css`
      :host {
        display: block;
        margin-block: 12px;
      }
      section {
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 10px;
        padding: 12px;
        min-width: 0;
      }
      h3 {
        margin: 0 0 8px;
      }
      label {
        display: flex;
        gap: 8px;
        align-items: center;
        overflow-wrap: anywhere;
      }
      .fields,
      .items {
        display: grid;
        gap: 8px;
        margin-block: 10px;
      }
      article {
        border: 1px solid var(--line, var(--divider-color));
        border-radius: 8px;
        padding: 10px;
        display: grid;
        gap: 8px;
        min-width: 0;
      }
      .doors {
        display: grid;
        gap: 5px;
      }
      .doors div {
        overflow-wrap: anywhere;
      }
      button {
        white-space: normal;
      }
      input {
        flex: none;
      }
    `,
  ];
  hass?: Hass;
  context = "";
  userId = "";
  personRevision = 0;
  policyRevision = 0;
  canView = false;
  canManage = false;
  draftUnchanged = false;
  private data?: Preview;
  private busy = false;
  private error = "";
  private selectedFields: string[] = [];
  private selectedGroups: string[] = [];
  private confirmed = false;
  private applied = false;
  private key = "";
  private epoch = 0;
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(
    () => this.hass,
    () => this.canView && this.draftUnchanged,
  );
  private t = (key: string) =>
    copy[key]?.[this.hass?.language?.startsWith("he") ? 1 : 0] ??
    translate(this.hass?.language ?? "en", key);
  private reset() {
    this.epoch++;
    this.requests.cancel();
    this.data = undefined;
    this.busy = false;
    this.error = "";
    this.selectedFields = [];
    this.selectedGroups = [];
    this.confirmed = false;
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
      this.userId,
      this.personRevision,
      this.policyRevision,
      this.canView,
      this.canManage,
      this.draftUnchanged,
    ]);
    if (key !== this.key || this.connection !== this.hass?.connection) {
      this.reset();
      this.key = key;
      this.connection?.removeEventListener?.("disconnected", this.lost);
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.lost);
    }
  }
  private request(fields: string[]) {
    return this.requests.run<Preview>(
      {
        type: "hikvision_intercom/users/group_suggestions",
        user_id: this.userId,
        field_ids: fields,
      },
      15000,
    );
  }
  private async load(analyze = false) {
    if (this.busy || !this.canView || !this.draftUnchanged) return;
    const epoch = ++this.epoch;
    this.busy = true;
    this.error = "";
    this.selectedGroups = [];
    this.confirmed = false;
    this.applied = false;
    try {
      const data = await this.request(analyze ? [...this.selectedFields] : []);
      if (epoch !== this.epoch || !this.isConnected) return;
      if (
        data.person_revision !== this.personRevision ||
        data.policy_revision !== this.policyRevision
      ) {
        this.data = undefined;
        this.error = "revision_conflict";
        return;
      }
      this.data = data;
    } catch (e) {
      if (epoch === this.epoch) this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private async apply() {
    if (
      this.busy ||
      !this.data ||
      !this.canManage ||
      !this.confirmed ||
      !this.selectedGroups.length ||
      !this.draftUnchanged
    )
      return;
    const preview = this.data,
      groups = [...this.selectedGroups],
      epoch = ++this.epoch;
    this.busy = true;
    this.error = "";
    try {
      const fresh = await this.request(preview.selected_fields);
      if (epoch !== this.epoch || !this.isConnected || !this.canManage) return;
      if (
        fresh.fingerprint !== preview.fingerprint ||
        fresh.person_revision !== this.personRevision ||
        fresh.policy_revision !== this.policyRevision
      ) {
        this.data = fresh;
        this.error = "stale";
        this.selectedGroups = [];
        this.confirmed = false;
        return;
      }
      if (!fresh.can_apply_to_draft) return;
      this.applied = true;
      this.dispatchEvent(
        new CustomEvent("groups-suggested", {
          detail: {
            group_ids: groups,
            person_revision: fresh.person_revision,
            policy_revision: fresh.policy_revision,
          },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (e) {
      if (epoch === this.epoch) this.error = (e as { code?: string }).code ?? "action_failed";
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private fieldChoice(f: Preview["fields"][number]) {
    return html`<label
      ><input
        type="checkbox"
        .checked=${this.selectedFields.includes(f.id)}
        ?disabled=${this.busy || (!this.selectedFields.includes(f.id) && this.selectedFields.length >= 3)}
        @change=${(e: Event) => {
          this.selectedFields = (e.target as HTMLInputElement).checked
            ? [...this.selectedFields, f.id]
            : this.selectedFields.filter((x) => x !== f.id);
          this.data = { ...this.data!, suggestions: [], selected_fields: [] };
          this.selectedGroups = [];
          this.confirmed = false;
        }}
      />${f.label}: ${f.value}</label
    >`;
  }
  private groupChoice(g: Preview["suggestions"][number]) {
    return html`<article>
      <label
        ><input
          type="checkbox"
          .checked=${this.selectedGroups.includes(g.group_id)}
          ?disabled=${this.busy || !this.canManage || !this.data?.can_apply_to_draft}
          @change=${(e: Event) => {
            this.selectedGroups = (e.target as HTMLInputElement).checked
              ? [...this.selectedGroups, g.group_id]
              : this.selectedGroups.filter((x) => x !== g.group_id);
            this.confirmed = false;
          }}
        />${g.label}</label
      >
      <small>${this.t("evidence")}: ${g.matching_members} / ${g.matching_people}</small>
      <div class="doors">
        ${g.doors.map((d) => html`<div>${d.station_name} · ${this.t(d.blocked ? "blocked" : JSON.stringify(d.before) === JSON.stringify(d.after) ? "nochange" : "adds")}</div>`)}
      </div>
    </article>`;
  }
  private applyControls() {
    if (!this.data?.suggestions.length) return nothing;
    return html`<p class="sub">${this.t("boundary")}</p>
      <label
        ><input
          type="checkbox"
          .checked=${this.confirmed}
          ?disabled=${this.busy || !this.selectedGroups.length || !this.canManage}
          @change=${(e: Event) => (this.confirmed = (e.target as HTMLInputElement).checked)}
        />${this.t("confirm")}</label
      >
      <button
        type="button"
        ?disabled=${this.busy || !this.canManage || !this.confirmed || !this.selectedGroups.length || !this.data.can_apply_to_draft}
        @click=${() => void this.apply()}
      >
        ${this.t("apply")}
      </button>`;
  }
  private preview() {
    if (!this.data) return nothing;
    const fields = this.data.fields.length
      ? html`<button
          type="button"
          ?disabled=${this.busy || !this.selectedFields.length}
          @click=${() => void this.load(true)}
        >
          ${this.t("analyze")}
        </button>`
      : html`<p>${this.t("unavailable")}</p>`;
    return html`<div class="fields">${this.data.fields.map((f) => this.fieldChoice(f))}</div>
      ${fields}
      ${this.data.selected_fields.length && !this.data.suggestions.length ? html`<p>${this.t("empty")}</p>` : nothing}
      <div class="items">${this.data.suggestions.map((g) => this.groupChoice(g))}</div>
      ${this.applyControls()}`;
  }
  render() {
    if (!this.canView || !this.userId) return nothing;
    const entry = !this.draftUnchanged
      ? html`<p role="status">${this.t(this.applied ? "applied" : "save")}</p>`
      : html`<button type="button" ?disabled=${this.busy} @click=${() => void this.load()}>
          ${this.t("load")}
        </button>`;
    return html`<section aria-label=${this.t("title")} aria-busy=${this.busy}>
      <h3>${this.t("title")}</h3>
      <p class="sub">${this.t("intro")}</p>
      ${entry} ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
      ${this.preview()}
    </section>`;
  }
}
customElements.define("wiskey-group-suggestions", GroupSuggestions);
