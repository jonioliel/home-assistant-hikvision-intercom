import { LitElement, css, html, nothing } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass } from "./types";

interface AuthStep {
  authenticated: boolean;
  flow_id?: string;
  fields?: { name: string; choices: Record<string, string> | null }[];
  errors?: string[];
}
export class Reauth extends LitElement {
  static properties = {
    hass: { attribute: false },
    locked: { type: Boolean },
    step: { state: true },
    error: { state: true },
    busy: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        display: block;
        height: auto;
        overflow: visible;
      }
      .shade {
        position: fixed;
        inset: 0;
        z-index: 10020;
        display: grid;
        place-items: center;
        background: #111920aa;
        padding: 16px;
        box-sizing: border-box;
      }
      .card {
        background: var(--surface, #fff);
        color: var(--ink, #17222a);
        width: min(420px, 100%);
        padding: 24px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        box-sizing: border-box;
      }
      label {
        display: grid;
        gap: 8px;
        margin-block: 14px;
      }
      input,
      select {
        padding: 12px;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        background: var(--surface);
        color: var(--ink);
        min-width: 0;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .error {
        color: var(--error-color, #c43c48);
      }
    `,
  ];
  hass?: Hass;
  locked = false;
  private step?: AuthStep;
  private error = "";
  private busy = false;
  private values: Record<string, string> = {};
  private requests = new ScopedRequests(
    () => this.hass,
    (hass) => !!hass.user,
  );
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  connectedCallback() {
    super.connectedCallback();
    void this.start();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
    this.values = {};
    this.step = undefined;
  }
  private async start() {
    await this.run("security/reauth_start", {});
  }
  private async run(command: string, data: Record<string, unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      const result = await this.requests.run<AuthStep>({
        type: `hikvision_intercom/${command}`,
        ...data,
      });
      this.values = {};
      this.step = result;
      if (result.authenticated)
        this.dispatchEvent(new CustomEvent("reauthenticated", { bubbles: true, composed: true }));
      else if (result.errors?.length) this.error = this.t("reauth_failed");
    } catch (error) {
      this.error = this.t((error as { code?: string }).code ?? "reauth_failed");
      this.values = {};
    } finally {
      this.busy = false;
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLInputElement>("input")?.focus();
    }
  }
  render() {
    return html`<div class="shade" dir=${this.hass?.language.startsWith("he") ? "rtl" : "ltr"}>
      <section class="card" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
        <h2 id="reauth-title">${this.t(this.locked ? "screen_locked" : "reauth_required")}</h2>
        <p>${this.t("reauth_hint")}</p>
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        <form
          @submit=${(e: Event) => {
            e.preventDefault();
            void this.run("security/reauth_step", {
              flow_id: this.step?.flow_id,
              values: { ...this.values },
            });
          }}
        >
          ${this.step?.fields?.map(
            (field) =>
              html`<label
                >${this.t(field.name === "password" ? "reauth_password" : "reauth_code")}${
                  field.choices
                    ? html`<select
                        required
                        @change=${(e: Event) => (this.values[field.name] = (e.target as HTMLSelectElement).value)}
                      >
                        <option value="">${this.t("select")}</option>
                        ${Object.entries(field.choices).map(([id, label]) => html`<option value=${id}>${label}</option>`)}
                      </select>`
                    : html`<input
                        required
                        type=${field.name === "password" ? "password" : "text"}
                        autocomplete=${field.name === "password" ? "current-password" : "one-time-code"}
                        .value=${this.values[field.name] ?? ""}
                        @input=${(e: Event) => (this.values[field.name] = (e.target as HTMLInputElement).value)}
                      />`
                }</label
              >`,
          )}
          <div class="actions">
            ${this.step?.flow_id ? html`<button type="submit" ?disabled=${this.busy}>${this.t("reauth_continue")}</button>` : html`<button type="button" ?disabled=${this.busy} @click=${() => void this.start()}>${this.t("refresh")}</button>`}${!this.locked ? html`<button type="button" @click=${() => this.dispatchEvent(new CustomEvent("reauth-cancel", { bubbles: true, composed: true }))}>${this.t("cancel")}</button>` : nothing}
          </div>
        </form>
      </section>
    </div>`;
  }
}
customElements.define("wiskey-reauth", Reauth);
