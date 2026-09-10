import { LitElement, html, css, nothing } from "lit";
import { translate } from "./i18n";
export type Appearance = "current" | "modern";
export const appearanceKey = (user: string) => `hikvision-intercom:appearance:v1:${user}`;
export function readAppearance(user?: string): Appearance {
  if (!user) return "current";
  try {
    return localStorage.getItem(appearanceKey(user)) === "modern" ? "modern" : "current";
  } catch {
    return "current";
  }
}
export function saveAppearance(user: string | undefined, appearance: Appearance): boolean {
  if (!user) return false;
  try {
    localStorage.setItem(appearanceKey(user), appearance);
    return true;
  } catch {
    return false;
  }
}
/** Separate top-layer dialog keeps the underlying editor and media nodes mounted. */
export class AppearancePicker extends LitElement {
  static properties = { language: {}, choice: { state: true }, opened: { state: true } };
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
      font:
        14px/1.5 Arial,
        sans-serif;
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
  async show(choice: Appearance, opener: HTMLElement) {
    this.opened = true;
    this.choice = choice;
    this.opener = opener;
    await this.updateComplete;
    this.renderRoot.querySelector("dialog")!.showModal();
  }
  private close() {
    this.renderRoot.querySelector("dialog")!.close();
  }
  private t = (key: string) => translate(this.language, key);
  render() {
    if (!this.opened) return nothing;
    return html`<dialog
      aria-labelledby="appearance-title"
      dir=${this.language.startsWith("he") ? "rtl" : "ltr"}
      @close=${() => {
        this.opened = false;
        if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
      }}
    >
      <h2 id="appearance-title">${this.t("appearance")}</h2>
      <p>${this.t("appearance_hint")}</p>
      <fieldset>
        <legend>${this.t("appearance_choose")}</legend>
        ${(["current", "modern"] as const).map(
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
                @change=${() => {
                  this.opened = true;
                  this.choice = choice;
                }}
              />${this.t(`appearance_${choice}`)}
            </label>`,
        )}
      </fieldset>
      <p>${this.t("appearance_theme")}</p>
      <footer>
        <button @click=${() => this.close()}>${this.t("cancel")}</button
        ><button
          class="primary"
          @click=${() => {
            this.dispatchEvent(new CustomEvent("appearance-change", { detail: this.choice }));
            this.close();
          }}
        >
          ${this.t("appearance_apply")}
        </button>
      </footer>
    </dialog>`;
  }
}
customElements.define("hikvision-appearance-picker", AppearancePicker);
