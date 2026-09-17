import { LitElement, html, css, nothing } from "lit";
import { translate } from "./i18n";
export const appearances = ["current", "modern", "access-light", "access-dark"] as const;
export type Appearance = (typeof appearances)[number];
export const isAccessAppearance = (value: Appearance) => value.startsWith("access-");
export function appearanceOverride(user?: string): Appearance | null {
  if (!user) return null;
  try {
    const value = localStorage.getItem(appearanceKey(user));
    return appearances.includes(value as Appearance) ? (value as Appearance) : null;
  } catch {
    return null;
  }
}
export const appearanceKey = (user: string) => `hikvision-intercom:appearance:v1:${user}`;
export function readAppearance(user?: string, shared: Appearance = "current"): Appearance {
  return appearanceOverride(user) ?? shared;
}
export function saveAppearance(
  user: string | undefined,
  appearance: Appearance | "default",
): boolean {
  if (!user) return false;
  try {
    if (appearance === "default") localStorage.removeItem(appearanceKey(user));
    else localStorage.setItem(appearanceKey(user), appearance);
    return true;
  } catch {
    return false;
  }
}
/** Separate top-layer dialog keeps the underlying editor and media nodes mounted. */
export class AppearancePicker extends LitElement {
  static properties = {
    language: {},
    choice: { state: true },
    opened: { state: true },
    settings: { attribute: false },
    canSetDefault: {},
    useDefault: { state: true },
    shared: { state: true },
    busy: { state: true },
    error: { state: true },
  };
  settings?: { revision: number; default: Appearance } | null;
  canSetDefault = false;
  saveDefault?: (revision: number, choice: Appearance) => Promise<unknown>;
  private revision = 0;
  private useDefault = false;
  private shared = false;
  private busy = false;
  private error = "";
  language = "en";
  private choice: Appearance = "current";
  private opened = false;
  private opener?: HTMLElement;
  static styles = css`
    :host {
      display: contents;
      color: var(--primary-text-color, #142133);
    }
    * {
      box-sizing: border-box;
    }
    dialog {
      width: min(620px, calc(100vw - 24px));
      max-height: calc(100dvh - 24px);
      max-width: calc(100cqw - 16px);
      overflow: auto;
      padding: 24px;
      border: 1px solid var(--divider-color, #dce4ee);
      border-radius: 16px;
      background: var(--card-background-color, white);
      color: inherit;
      font: 14px/1.5 var(--wiskey-font, Arial, sans-serif);
    }
    dialog::backdrop {
      background: #08132299;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    p {
      color: var(--secondary-text-color, #526176);
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 20px 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    legend {
      padding: 0 0 10px;
    }
    label {
      cursor: pointer;
      border: 2px solid var(--divider-color, #dce4ee);
      border-radius: 12px;
      padding: 12px;
      min-width: 0;
    }
    label:has(input:checked) {
      border-color: var(--primary-color, #0874e8);
      background: color-mix(in srgb, var(--primary-color, #0874e8) 6%, transparent);
    }
    input {
      accent-color: var(--primary-color, #0874e8);
      width: 18px;
      height: 18px;
      vertical-align: middle;
      margin-inline: 0 8px;
    }
    .mini {
      height: 105px;
      margin-bottom: 12px;
      display: grid;
      grid-template-columns: 24px 1fr;
      gap: 8px;
      background: #f3f6f6;
      padding: 8px;
      border-radius: 6px;
      direction: ltr;
    }
    .mini aside {
      background: #dce9e9;
      border-radius: 3px;
    }
    .mini.modern {
      background: #f3f6fa;
    }
    .mini.modern aside {
      background: #1c2730;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }
    .tiles i {
      background: linear-gradient(#dce4ee 65%, #087e83 65%);
      border: 4px solid white;
      border-radius: 4px;
    }
    .modern .tiles i {
      background: linear-gradient(#dce4ee 65%, #0874e8 65%);
    }
    .mini.access-light,
    .mini.access-dark {
      grid-template-columns: 1fr;
      grid-template-rows: 13px 1fr;
      background: #f5f6fa;
    }
    .mini.access-light aside,
    .mini.access-dark aside {
      background: #191d29;
    }
    .access-light .tiles i {
      background: linear-gradient(#e4e6ee 65%, #5b54df 65%);
    }
    .mini.access-dark {
      background: #10121a;
    }
    .access-dark .tiles i {
      border-color: #252937;
      background: linear-gradient(#353b51 65%, #a49cff 65%);
    }
    .scope {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 10px 0;
      border: 0;
      padding: 0;
    }
    .scope input {
      flex-shrink: 0;
    }
    .error {
      color: var(--error-color, #c53545);
    }
    footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: end;
      gap: 10px;
      margin-top: 20px;
    }
    button {
      min-height: 44px;
      padding: 10px 18px;
      border: 1px solid var(--divider-color, #dce4ee);
      border-radius: 8px;
      background: var(--card-background-color, white);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .primary {
      background: var(--primary-color, #0874e8);
      color: var(--text-primary-color, white);
    }
    :focus-visible {
      outline: 3px solid var(--primary-color, #0874e8);
      outline-offset: 3px;
    }
    @media (max-width: 370px) {
      dialog {
        padding: 16px;
      }
      label {
        padding: 8px;
      }
      .mini {
        height: 80px;
      }
    }
  `;
  async show(choice: Appearance, opener: HTMLElement, useDefault = false) {
    this.opened = true;
    this.choice = choice;
    this.useDefault = useDefault;
    this.shared = false;
    this.error = "";
    this.revision = this.settings?.revision ?? 0;
    this.opener = opener;
    await this.updateComplete;
    this.renderRoot.querySelector("dialog")!.showModal();
  }
  private close() {
    if (!this.busy) this.renderRoot.querySelector("dialog")!.close();
  }
  private t = (key: string) => translate(this.language, key);
  render() {
    if (!this.opened) return nothing;
    return html`<dialog
      aria-labelledby="appearance-title"
      dir=${this.language.startsWith("he") ? "rtl" : "ltr"}
      @cancel=${(event: Event) => {
        if (this.busy) event.preventDefault();
      }}
      @close=${() => {
        this.opened = false;
        if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
      }}
    >
      <h2 id="appearance-title">${this.t("appearance")}</h2>
      <p>${this.t("appearance_hint")}</p>
      <fieldset>
        <legend>${this.t("appearance_choose")}</legend>
        ${appearances.map(
          (choice) =>
            html`<label>
              <div class="mini ${choice}" aria-hidden="true">
                <aside></aside>
                <div class="tiles"><i></i><i></i><i></i><i></i></div>
              </div>
              <input
                type="radio"
                name="appearance"
                value=${choice}
                .checked=${this.choice === choice}
                ?disabled=${this.busy}
                @change=${() => {
                  this.opened = true;
                  this.choice = choice;
                  this.useDefault = false;
                }}
              />${this.t(`appearance_${choice}`)}
            </label>`,
        )}
      </fieldset>
      <p>${this.t("appearance_theme")}</p>
      <label class="scope"
        ><input
          type="checkbox"
          .checked=${this.useDefault}
          ?disabled=${this.busy}
          @change=${(e: Event) => {
            this.useDefault = (e.target as HTMLInputElement).checked;
            this.shared = false;
            if (this.useDefault) this.choice = this.settings?.default ?? "current";
          }}
        />${this.t("appearance_follow")}</label
      >
      ${
        this.canSetDefault && this.settings
          ? html`<label class="scope"
                ><input
                  type="checkbox"
                  .checked=${this.shared}
                  ?disabled=${this.busy || this.useDefault}
                  @change=${(e: Event) => (this.shared = (e.target as HTMLInputElement).checked)}
                />${this.t("appearance_shared")}</label
              >
              <p>${this.t("appearance_shared_hint")}</p>`
          : nothing
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <footer>
        <button @click=${() => this.close()}>${this.t("cancel")}</button
        ><button
          class="primary"
          ?disabled=${this.busy}
          @click=${async () => {
            this.busy = true;
            this.error = "";
            try {
              if (this.shared) {
                if (!this.saveDefault) throw { code: "appearance_settings_unavailable" };
                await this.saveDefault(this.revision, this.choice);
              }
              this.dispatchEvent(
                new CustomEvent("appearance-change", {
                  detail: this.shared || this.useDefault ? "default" : this.choice,
                }),
              );
              this.busy = false;
              this.close();
            } catch (error) {
              this.error = this.t(String((error as { code?: string })?.code ?? "failed"));
            } finally {
              this.busy = false;
            }
          }}
        >
          ${this.t("appearance_apply")}
        </button>
      </footer>
    </dialog>`;
  }
}
customElements.define("hikvision-appearance-picker", AppearancePicker);
