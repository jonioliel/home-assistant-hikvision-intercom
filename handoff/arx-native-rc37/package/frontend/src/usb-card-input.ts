import { LitElement, html, nothing, css, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { Hass } from "./types";
/** Deliberate keyboard-wedge capture scoped to one input. No document-level key capture. */
export class UsbCardInput extends LitElement {
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
    `,
  ];
  static properties = {
    hass: { attribute: false },
    locked: { type: Boolean },
    text: { state: true },
    candidate: { state: true },
    error: { state: true },
  };
  hass?: Hass;
  locked = false;
  private text = "";
  private candidate = "";
  private error = "";
  private actor?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private onVisibility = () => {
    if (document.hidden) this.clear();
  };
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
  }
  disconnectedCallback() {
    this.clear();
    document.removeEventListener("visibilitychange", this.onVisibility);
    super.disconnectedCallback();
  }
  protected updated(changes: PropertyValues) {
    if (
      this.actor !== this.hass?.user?.id ||
      !this.hass?.user?.is_admin ||
      (changes.has("locked") && this.locked)
    )
      this.clear();
    this.actor = this.hass?.user?.id;
  }
  private clear() {
    clearTimeout(this.timer);
    this.text = this.candidate = this.error = "";
  }
  private review() {
    if (this.locked) return;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(this.text)) {
      this.error = "usb_card_invalid";
      return;
    }
    this.candidate = this.text;
    this.text = "";
    this.error = "";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), 60000);
  }
  private use() {
    if (!this.candidate || this.locked || !this.hass?.user?.is_admin) return;
    const number = this.candidate;
    this.clear();
    this.dispatchEvent(new CustomEvent("card-reviewed", { detail: { card_no: number } }));
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    return html`<details
      @toggle=${(e: Event) => {
        if (!(e.target as HTMLDetailsElement).open) this.clear();
      }}
    >
      <summary>${this.t("usb_card_title")}</summary>
      <p class="sub">${this.t("usb_card_hint")}</p>
      <label
        >${this.t("usb_card_input")}<input
          type="password"
          autocomplete="off"
          maxlength="256"
          .value=${this.text}
          ?disabled=${this.locked || !!this.candidate}
          @input=${(e: Event) => {
            this.text = (e.target as HTMLInputElement).value;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.clear(), 60000);
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (!e.repeat) this.review();
            }
          }}
      /></label>
      <button type="button" ?disabled=${this.locked || !this.text} @click=${() => this.review()}>
        ${this.t("usb_card_review")}
      </button>
      ${
        this.candidate
          ? html`<p role="status">
                ${this.t("usb_card_candidate")}: <bdi>•••• ${this.candidate.slice(-4)}</bdi> ·
                ${this.candidate.length}
              </p>
              <button type="button" ?disabled=${this.locked} @click=${() => this.use()}>
                ${this.t("usb_card_use")}
              </button>`
          : nothing
      }
      <button type="button" @click=${() => this.clear()}>${this.t("cancel")}</button>
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
    </details>`;
  }
}
customElements.define("wiskey-usb-card-input", UsbCardInput);
