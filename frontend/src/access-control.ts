import { LitElement, html, nothing } from "lit";
import type { Hass } from "./types";

type Level = "none" | "view" | "manage";
type Area = "overview" | "users" | "events" | "stations" | "management";
interface Policy {
  enabled: boolean;
  areas: Record<Area, Level>;
}
interface DirectoryUser {
  id: string;
  name: string;
  active: boolean;
  admin: boolean;
  owner: boolean;
}
interface PermissionSettings {
  revision: number;
  users: Record<string, Policy>;
  directory: DirectoryUser[];
}
interface PermissionPreview {
  enabled: boolean;
  actions: Record<string, boolean>;
}
const areas: Area[] = ["overview", "users", "events", "stations", "management"];
const emptyPolicy = (): Policy => ({
  enabled: false,
  areas: { overview: "none", users: "none", events: "none", stations: "none", management: "none" },
});
const rolePresets: Record<string, Record<Area, Level>> = {
  reception: {
    overview: "manage",
    users: "view",
    events: "view",
    stations: "none",
    management: "none",
  },
  security: {
    overview: "manage",
    users: "view",
    events: "manage",
    stations: "view",
    management: "none",
  },
  personnel: {
    overview: "view",
    users: "manage",
    events: "view",
    stations: "none",
    management: "none",
  },
  maintenance: {
    overview: "view",
    users: "none",
    events: "view",
    stations: "manage",
    management: "none",
  },
  auditor: {
    overview: "view",
    users: "view",
    events: "view",
    stations: "view",
    management: "view",
  },
};

export class WiskeyAccessControl extends LitElement {
  static properties = {
    hass: { attribute: false },
    _settings: { state: true },
    _draft: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _saved: { state: true },
    _previews: { state: true },
    _previewBusy: { state: true },
  };
  hass?: Hass;
  private _settings?: PermissionSettings;
  private _draft: Record<string, Policy> = {};
  private _busy = false;
  private _error = "";
  private _saved = false;
  private _previews: Record<string, PermissionPreview> = {};
  private _previewBusy = "";
  private previewGeneration = 0;
  private mounted = false;

  connectedCallback() {
    super.connectedCallback();
    this.mounted = true;
    void this.load();
  }
  disconnectedCallback() {
    this.mounted = false;
    this.previewGeneration++;
    this._previewBusy = "";
    super.disconnectedCallback();
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has("hass") && this.hass?.user?.is_admin && !this._settings) void this.load();
  }
  private he() {
    return this.hass?.language?.startsWith("he") ?? false;
  }
  private text(en: string, he: string) {
    return this.he() ? he : en;
  }
  private async request<T>(command: string, data: Record<string, unknown> = {}): Promise<T> {
    if (!this.hass?.user?.is_admin) throw { code: "unauthorized" };
    return this.hass.callWS<T>({ type: `hikvision_intercom/${command}`, ...data });
  }
  private clone(users: Record<string, Policy>) {
    return structuredClone(users);
  }
  private async load() {
    if (!this.hass?.user?.is_admin || this._busy) return;
    this._busy = true;
    this._error = "";
    try {
      const settings = await this.request<PermissionSettings>("authorization/settings_get");
      if (!this.mounted) return;
      this._settings = settings;
      this._draft = this.clone(settings.users);
      this._previews = {};
      this.previewGeneration++;
      this._previewBusy = "";
      this._saved = false;
    } catch (error) {
      this._error = String((error as { code?: string })?.code ?? "failed");
    } finally {
      this._busy = false;
    }
  }
  private policy(id: string) {
    return this._draft[id] ?? emptyPolicy();
  }
  private changeEnabled(id: string, enabled: boolean) {
    this.invalidatePreview(id);
    const policy = structuredClone(this.policy(id));
    policy.enabled = enabled;
    if (enabled && Object.values(policy.areas).every((level) => level === "none"))
      policy.areas.overview = "view";
    this._draft = { ...this._draft, [id]: policy };
    this._saved = false;
  }
  private changeLevel(id: string, area: Area, level: Level) {
    this.invalidatePreview(id);
    const policy = structuredClone(this.policy(id));
    policy.areas[area] = level;
    policy.enabled = Object.values(policy.areas).some((value) => value !== "none");
    this._draft = { ...this._draft, [id]: policy };
    this._saved = false;
  }
  private applyPreset(id: string, preset: string) {
    const levels = rolePresets[preset];
    if (!levels) return;
    this.invalidatePreview(id);
    this._draft = { ...this._draft, [id]: { enabled: true, areas: { ...levels } } };
    this._saved = false;
  }
  private async save() {
    if (!this._settings || this._busy) return;
    this._busy = true;
    this._error = "";
    this._saved = false;
    try {
      const settings = await this.request<PermissionSettings>("authorization/settings_update", {
        revision: this._settings.revision,
        users: this._draft,
      });
      this._settings = settings;
      this._draft = this.clone(settings.users);
      this._previews = {};
      this.previewGeneration++;
      this._previewBusy = "";
      this._saved = true;
    } catch (error) {
      const code = String((error as { code?: string })?.code ?? "failed");
      this._error =
        code === "revision_conflict"
          ? this.text(
              "Permissions changed in another session. Reload and review before saving.",
              "ההרשאות השתנו בחלון אחר. יש לרענן ולבדוק לפני שמירה.",
            )
          : code;
    } finally {
      this._busy = false;
    }
  }
  private areaLabel(area: Area) {
    const labels: Record<Area, [string, string]> = {
      overview: ["Overview and door control", "סקירה ושליטה בדלתות"],
      users: ["Users", "משתמשים"],
      events: ["Events and reports", "אירועים ודוחות"],
      stations: ["Intercom stations", "תחנות אינטרקום"],
      management: ["Management tools", "כלי ניהול"],
    };
    return this.text(...labels[area]);
  }
  private levelLabel(level: Level) {
    const labels: Record<Level, [string, string]> = {
      none: ["No access", "ללא גישה"],
      view: ["View only", "צפייה בלבד"],
      manage: ["View and manage", "צפייה וניהול"],
    };
    return this.text(...labels[level]);
  }
  private invalidatePreview(id: string) {
    this.previewGeneration++;
    this._previewBusy = "";
    if (this._previews[id]) {
      const next = { ...this._previews };
      delete next[id];
      this._previews = next;
    }
  }
  private async preview(id: string) {
    if (this._busy || this._previewBusy) return;
    const generation = ++this.previewGeneration;
    this._previewBusy = id;
    this._error = "";
    try {
      const result = await this.request<PermissionPreview>("authorization/preview", {
        policy: this.policy(id),
      });
      if (this.mounted && this.hass?.user?.is_admin && generation === this.previewGeneration)
        this._previews = { ...this._previews, [id]: result };
    } catch {
      if (this.mounted && generation === this.previewGeneration)
        this._error = this.text(
          "Could not preview these permissions.",
          "לא ניתן להציג תצוגה מקדימה להרשאות אלו.",
        );
    } finally {
      if (generation === this.previewGeneration) this._previewBusy = "";
    }
  }
  private actionLabel(action: string) {
    const labels: Record<string, [string, string]> = {
      door_unlock: ["Open doors", "פתיחת דלתות"],
      station_view: ["View stations", "צפייה בתחנות"],
      station_settings: ["Change station settings", "שינוי הגדרות תחנות"],
      people_view: ["View people", "צפייה במשתמשים"],
      people_edit: ["Change people and access", "שינוי משתמשים והרשאות"],
      people_export: ["Export people", "ייצוא משתמשים"],
      whatsapp_send: ["Send WhatsApp messages", "שליחת הודעות WhatsApp"],
      events_view: ["View events", "צפייה באירועים"],
      events_export: ["Export events", "ייצוא אירועים"],
      event_capture: ["Capture event traces", "לכידת אירועים"],
      system_settings: ["Change system settings", "שינוי הגדרות המערכת"],
    };
    return labels[action] ? this.text(...labels[action]) : action;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const users = this._settings?.directory ?? [];
    return html`<style>
        :host {
          display: block;
          color: var(--primary-text-color, #172633);
        }
        .heading,
        .actions,
        .person-head {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: space-between;
        }
        h2,
        p {
          margin: 0;
        }
        .hint {
          color: var(--secondary-text-color, #64748b);
          margin-top: 6px;
        }
        .grid {
          display: grid;
          gap: 12px;
          margin-top: 18px;
        }
        article {
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, #dbe3ed);
          border-radius: 16px;
          padding: 16px;
        }
        .person {
          font-weight: 700;
        }
        .badge {
          border-radius: 999px;
          padding: 4px 9px;
          background: var(--access-tint, #edf2ff);
          color: var(--primary-color, #3155bf);
          font-size: 0.82rem;
        }
        .inactive {
          background: var(--access-red-bg, #fff0f0);
          color: var(--error-color, #a63737);
        }
        .areas {
          display: grid;
          grid-template-columns: repeat(5, minmax(145px, 1fr));
          gap: 10px;
          margin-top: 14px;
        }
        .permission-preview {
          margin-top: 12px;
          padding: 12px;
          border: 1px solid var(--divider-color, #dbe3ed);
          border-radius: 10px;
        }
        .preview-actions {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
          gap: 8px;
          margin-top: 10px;
        }
        .preview-actions span {
          padding: 8px;
          border-radius: 8px;
          background: var(--access-red-bg, #fff0f0);
        }
        .preview-actions span[data-allowed="true"] {
          background: var(--access-green-bg, #eaf7ef);
        }
        label {
          display: grid;
          gap: 6px;
          color: var(--secondary-text-color, #64748b);
          font-size: 0.88rem;
        }
        select {
          min-height: 42px;
          border: 1px solid var(--divider-color, #ccd7e5);
          border-radius: 10px;
          background: var(--card-background-color, #fff);
          color: inherit;
          padding: 0 10px;
          font: inherit;
        }
        input[type="checkbox"] {
          width: 20px;
          height: 20px;
          accent-color: var(--primary-color, #4264da);
        }
        .switch {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          color: inherit;
        }
        button {
          min-height: 42px;
          padding: 0 16px;
          border-radius: 10px;
          border: 1px solid var(--divider-color, #ccd7e5);
          background: var(--card-background-color, #fff);
          color: inherit;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        }
        button.primary {
          background: var(--primary-color, #4264da);
          color: var(--text-primary-color, #fff);
          border-color: transparent;
        }
        button:disabled,
        select:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .notice {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--access-green-bg, #eaf7ef);
          color: var(--success-color, #24633d);
        }
        .error {
          background: var(--access-red-bg, #fff0f0);
          color: var(--error-color, #a63737);
        }
        @media (max-width: 900px) {
          .areas {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 520px) {
          .heading,
          .person-head {
            align-items: flex-start;
            flex-direction: column;
          }
          .areas {
            grid-template-columns: 1fr;
          }
          .actions {
            width: 100%;
          }
          .actions button {
            flex: 1;
          }
        }
      </style>
      <section dir=${this.he() ? "rtl" : "ltr"}>
        <div class="heading">
          <div>
            <h2>
              ${this.text("System infrastructure user permissions", "הרשאות משתמשי תשתית המערכת")}
            </h2>
            <p class="hint">
              ${this.text("Choose which WisKey areas each non-administrator may view or manage. System infrastructure administrators always have full access.", "בחר אילו אזורים ב־WisKey כל משתמש שאינו מנהל רשאי לראות או לנהל. למנהלי תשתית המערכת יש תמיד גישה מלאה.")}
            </p>
          </div>
          <div class="actions">
            <button ?disabled=${this._busy} @click=${() => this.load()}>
              ${this.text("Reload", "רענון")}</button
            ><button
              class="primary"
              ?disabled=${this._busy || !this._settings}
              @click=${() => this.save()}
            >
              ${this._busy ? this.text("Please wait…", "נא להמתין…") : this.text("Save permissions", "שמירת הרשאות")}
            </button>
          </div>
        </div>
        ${this._error ? html`<p class="notice error" role="alert">${this._error}</p>` : nothing}${this._saved ? html`<p class="notice" role="status">${this.text("Permissions saved and applied immediately.", "ההרשאות נשמרו והוחלו מיד.")}</p>` : nothing}
        <div class="grid">
          ${users.map((user) => {
            const policy = this.policy(user.id);
            return html`<article>
              <div class="person-head">
                <div>
                  <span class="person">${user.name || user.id}</span>
                  ${user.owner ? html`<span class="badge">${this.text("Owner", "בעלים")}</span>` : nothing}
                  ${user.admin ? html`<span class="badge">${this.text("Administrator", "מנהל")}</span>` : nothing}
                  ${!user.active ? html`<span class="badge inactive">${this.text("Inactive", "לא פעיל")}</span>` : nothing}
                </div>
                ${user.admin ? html`<span class="hint">${this.text("Full access from system infrastructure", "גישה מלאה מכוח הרשאת מנהל בתשתית המערכת")}</span>` : html`<label class="switch"><input type="checkbox" .checked=${policy.enabled} ?disabled=${this._busy || !user.active} @change=${(event: Event) => this.changeEnabled(user.id, (event.target as HTMLInputElement).checked)} />${this.text("Allow WisKey access", "מתן גישה ל־WisKey")}</label>`}
              </div>
              ${
                !user.admin
                  ? html`<label class="hint"
                        >${this.text("Role template", "תבנית תפקיד")}
                        <select
                          aria-label=${this.text("Role template for ", "תבנית תפקיד עבור ") + (user.name || user.id)}
                          ?disabled=${this._busy || !user.active}
                          .value=${Object.entries(rolePresets).find(([, levels]) => JSON.stringify(levels) === JSON.stringify(policy.areas))?.[0] ?? "custom"}
                          @change=${(event: Event) => this.applyPreset(user.id, (event.target as HTMLSelectElement).value)}
                        >
                          <option value="custom">${this.text("Custom", "מותאם אישית")}</option>
                          <option value="reception">${this.text("Reception", "קבלה")}</option>
                          <option value="security">${this.text("Security", "אבטחה")}</option>
                          <option value="personnel">${this.text("Personnel", "כוח אדם")}</option>
                          <option value="maintenance">${this.text("Maintenance", "תחזוקה")}</option>
                          <option value="auditor">${this.text("Auditor", "מבקר")}</option>
                        </select></label
                      >
                      <div class="areas">
                        ${areas.map(
                          (area) =>
                            html`<label
                              >${this.areaLabel(area)}<select
                                .value=${policy.areas[area]}
                                ?disabled=${this._busy || !user.active || !policy.enabled}
                                @change=${(event: Event) => this.changeLevel(user.id, area, (event.target as HTMLSelectElement).value as Level)}
                              >
                                ${(["none", "view", "manage"] as Level[]).map((level) => html`<option value=${level}>${this.levelLabel(level)}</option>`)}
                              </select></label
                            >`,
                        )}
                      </div>
                      <button
                        type="button"
                        ?disabled=${this._busy || !!this._previewBusy || !user.active}
                        @click=${() => this.preview(user.id)}
                      >
                        ${this._previewBusy === user.id ? this.text("Checking…", "בודק…") : this.text("Preview effective access", "תצוגה מקדימה של ההרשאות")}
                      </button>
                      ${
                        this._previews[user.id]
                          ? html`<div
                              class="permission-preview"
                              aria-label=${this.text("Effective access preview", "תצוגה מקדימה של גישה בפועל")}
                            >
                              <strong
                                >${this.text("Effective access preview", "תצוגה מקדימה של גישה בפועל")}</strong
                              >
                              <p class="hint">
                                ${this.text("Based on the unsaved selection. Changes take effect only after saving; the user must also be active.", "לפי הבחירה שטרם נשמרה. השינוי יחול רק לאחר שמירה, ובתנאי שהמשתמש פעיל.")}
                              </p>
                              <div class="preview-actions">
                                ${Object.entries(this._previews[user.id].actions).map(([action, allowed]) => html`<span data-allowed=${allowed ? "true" : "false"}>${allowed ? "✓" : "—"} ${this.actionLabel(action)}</span>`)}
                              </div>
                            </div>`
                          : nothing
                      }`
                  : nothing
              }
            </article>`;
          })}
        </div>
      </section>`;
  }
}
customElements.define("wiskey-access-control", WiskeyAccessControl);
