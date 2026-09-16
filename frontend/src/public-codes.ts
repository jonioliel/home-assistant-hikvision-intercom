import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import type { Hass, Station } from "./types";
interface Report {
  status: { states: Record<string, boolean | null>; checked_at: string };
  capabilities: { advertised: boolean; slots: number[]; min: number; max: number };
}
export class PublicCodes extends LitElement {
  static properties = {
    hass: { attribute: false },
    station: { attribute: false },
    report: { state: true },
    busy: { state: true },
    error: { state: true },
    editor: { state: true },
    oldPin: { state: true },
    newPin: { state: true },
    repeatPin: { state: true },
    door: { state: true },
    compatibility: { state: true },
    message: { state: true },
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
      .slots {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      article,
      form {
        padding: 16px;
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        margin-block: 12px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      label {
        display: block;
        margin-block: 12px;
      }
      input[type="checkbox"] {
        width: 20px;
        height: 20px;
        vertical-align: middle;
      }
    `,
  ];
  hass?: Hass;
  station?: Station;
  private report?: Report;
  private busy = false;
  private error = "";
  private message = "";
  private editor?: { slot: number; action: string; expected: boolean };
  private oldPin = "";
  private newPin = "";
  private repeatPin = "";
  private door = 1;
  private compatibility = false;
  private identity = "";
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(_p: PropertyValues) {
    if (_p.has("editor") && !_p.get("editor") && this.editor) {
      this.renderRoot.querySelector("form")?.scrollIntoView({ block: "start" });
    }
    const id = `${this.hass?.user?.id}/${this.station?.id}`;
    if (id !== this.identity) {
      this.identity = id;
      this.requests.cancel();
      this.clear();
      this.report = undefined;
      this.error = "";
      this.message = "";
      this.busy = false;
      this.compatibility = false;
      this.door = this.station?.integrated_locks[0]?.api_id ?? 1;
      void this.load();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
    this.clear();
  }
  private clear() {
    this.editor = undefined;
    this.oldPin = "";
    this.newPin = "";
    this.repeatPin = "";
  }
  private async load() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.clear();
    const id = this.identity;
    try {
      const report = await this.requests.run<Report>(
        { type: "hikvision_intercom/stations/technical_codes_get", station_id: this.station?.id },
        70000,
      );
      if (id === this.identity) this.report = report;
    } catch (e) {
      if (id === this.identity) {
        this.report = undefined;
        this.error = (e as { code?: string }).code ?? "technical_read_failed";
      }
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  private async save() {
    if (this.busy || !this.editor || !this.report) return;
    if (this.editor.action !== "remove" && this.newPin !== this.repeatPin) {
      this.error = "public_pin_mismatch";
      return;
    }
    if (!confirm(this.t("public_pin_confirm"))) return;
    const msg = {
      type: "hikvision_intercom/stations/technical_codes_write",
      station_id: this.station?.id,
      ...this.editor,
      old_pin: this.oldPin,
      new_pin: this.newPin,
      door: this.door,
      compatibility: this.compatibility,
      confirmed: true,
    };
    this.busy = true;
    this.error = "";
    this.message = "";
    this.clear();
    const id = this.identity;
    try {
      const report = await this.requests.run<Report>(msg, 70000);
      if (id === this.identity) {
        this.report = report;
        this.message = "public_pin_saved";
      }
    } catch (e) {
      if (id === this.identity) {
        this.report = undefined;
        this.error = (e as { code?: string }).code ?? "technical_write_unknown";
      }
    } finally {
      msg.old_pin = "";
      msg.new_pin = "";
      if (id === this.identity) this.busy = false;
    }
  }
  render() {
    return html`<h3>${this.t("station_tab_public_codes")}</h3>
      <p>${this.t("public_pin_intro")}</p>
      <button ?disabled=${this.busy} @click=${() => this.load()}>${this.t("refresh")}</button>
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
      ${this.message ? html`<p role="status">${this.t(this.message)}</p>` : nothing}
      ${
        this.report && !this.report.capabilities.advertised
          ? html`<label
              ><input
                type="checkbox"
                .checked=${this.compatibility}
                ?disabled=${this.busy}
                @change=${(e: Event) => {
                  this.compatibility = (e.target as HTMLInputElement).checked;
                  this.clear();
                }}
              />${this.t("public_pin_compatibility")}</label
            >`
          : nothing
      }
      <div class="slots">
        ${
          this.report
            ? Array.from({ length: 16 }, (_, i) => {
                const slot = i + 1,
                  state = this.report!.status.states[`public${slot}Configured`];
                const disabled =
                  this.busy ||
                  typeof state !== "boolean" ||
                  !this.report!.capabilities.slots.includes(slot) ||
                  (!this.report!.capabilities.advertised && !this.compatibility) ||
                  !this.station?.integrated_locks.length;
                return html`<article>
                  <strong>${this.t("public_code_slot")} ${slot}</strong>
                  <p>
                    ${this.t(state === true ? "configured" : state === false ? "not_configured" : "not_verified")}
                  </p>
                  <div class="actions">
                    <button
                      ?disabled=${disabled}
                      @click=${() => {
                      this.clear();
                      this.editor = {
                        slot,
                        action: state ? "replace" : "add",
                        expected: state === true,
                      };
                    }}
                    >
                      ${this.t(state ? "edit" : "public_pin_add")}
                    </button>
                    ${
                    state
                      ? html`<button
                          class="danger"
                          ?disabled=${disabled}
                          @click=${() => {
                    this.clear();
                    this.editor = { slot, action: "remove", expected: true };
                  }}
                        >
                          ${this.t("remove")}
                        </button>`
                      : nothing
                  }
                  </div>
                </article>`;
              })
            : nothing
        }
      </div>
      ${
        this.editor
          ? html`<form
              @submit=${(e: Event) => {
                e.preventDefault();
                void this.save();
              }}
            >
              <fieldset ?disabled=${this.busy}>
                <legend>
                  ${this.t("public_code_slot")} ${this.editor.slot} ·
                  ${this.t(this.editor.action === "remove" ? "remove" : "edit")}
                </legend>
                ${this.editor.action !== "add" ? html`<label>${this.t("public_pin_old")}<input type="password" autocomplete="new-password" inputmode="numeric" required minlength="4" maxlength="16" pattern="[0-9]+" .value=${this.oldPin} @input=${(e: Event) => (this.oldPin = (e.target as HTMLInputElement).value)} /></label>` : nothing}
                ${
                  this.editor.action !== "remove"
                    ? html`<label
                          >${this.t("public_pin_new")}<input
                            type="password"
                            autocomplete="new-password"
                            inputmode="numeric"
                            required
                            minlength=${this.report!.capabilities.min}
                            maxlength=${this.report!.capabilities.max}
                            pattern="[0-9]+"
                            .value=${this.newPin}
                            @input=${(e: Event) => (this.newPin = (e.target as HTMLInputElement).value)}
                        /></label>
                        <label
                          >${this.t("public_pin_repeat")}<input
                            type="password"
                            autocomplete="new-password"
                            required
                            .value=${this.repeatPin}
                            @input=${(e: Event) => (this.repeatPin = (e.target as HTMLInputElement).value)}
                        /></label>
                        <label
                          >${this.t("physical_lock")}<select
                            .value=${String(this.door)}
                            @change=${(e: Event) => (this.door = Number((e.target as HTMLSelectElement).value))}
                          >
                            ${this.station?.integrated_locks.map((l) => html`<option value=${l.api_id}>${l.name ?? this.t("physical_lock") + " " + l.physical_index}</option>`)}
                          </select></label
                        >`
                    : nothing
                }
                <div class="actions">
                  <button type="submit" class="primary">
                    ${this.t(this.editor.action === "remove" ? "remove" : "save")}</button
                  ><button type="button" @click=${() => this.clear()}>${this.t("cancel")}</button>
                </div>
              </fieldset>
            </form>`
          : nothing
      }`;
  }
}
customElements.define("wiskey-public-codes", PublicCodes);
