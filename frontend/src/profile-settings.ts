import { LitElement, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass } from "./types";

export interface ProfileDefinition {
  id: string;
  label: string;
  enabled: boolean;
}
export interface ProfileField extends ProfileDefinition {
  options: string[];
}
export interface ProfilePolicy {
  revision: number;
  fields: ProfileField[];
  groups: ProfileDefinition[];
  photo_enabled: boolean;
}
export class ProfileSettingsPanel extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    stale: { state: true },
  };
  hass?: Hass;
  settings?: ProfilePolicy | null;
  private draft?: ProfilePolicy;
  private busy = false;
  private stale = false;
  private error = "";
  private notice = "";
  private actor?: string;
  private requests = new ScopedRequests(() => this.hass);
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  protected updated(_changes: PropertyValues) {
    if (this.actor !== this.hass?.user?.id) {
      this.actor = this.hass?.user?.id;
      this.requests.cancel();
      this.draft = undefined;
      this.error = this.notice = "";
      this.stale = false;
    }
    if (!this.draft && this.settings) this.draft = structuredClone(this.settings);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
  }
  private add(key: "fields" | "groups") {
    if (!this.draft || this.busy) return;
    const id = (key === "fields" ? "f_" : "g_") + crypto.randomUUID().replaceAll("-", "");
    if (key === "fields") this.draft.fields.push({ id, label: "", enabled: true, options: [] });
    else this.draft.groups.push({ id, label: "", enabled: true });
    this.requestUpdate();
  }
  private async reload() {
    this.busy = true;
    try {
      this.draft = await this.requests.run<ProfilePolicy>(
        { type: "hikvision_intercom/profiles/settings_get" },
        10000,
      );
      this.stale = false;
      this.error = this.notice = "";
    } catch {
      this.error = "profile_load_failed";
    } finally {
      this.busy = false;
    }
  }
  private async save(e: Event) {
    e.preventDefault();
    if (!this.draft || this.busy || this.stale) return;
    this.busy = true;
    this.error = this.notice = "";
    const { revision, ...values } = this.draft;
    try {
      const result = await this.requests.run<ProfilePolicy>(
        { type: "hikvision_intercom/profiles/settings_update", revision, values },
        12000,
      );
      if (!this.isConnected) return;
      this.draft = structuredClone(result);
      this.notice = "saved";
      this.dispatchEvent(new CustomEvent("profile-saved", { detail: result }));
    } catch (e) {
      if (!this.isConnected) return;
      const code = (e as { code?: string }).code;
      this.stale = code !== "invalid_fields";
      this.error =
        code === "revision_conflict"
          ? "media_conflict"
          : code === "invalid_fields"
            ? "media_invalid"
            : "media_save_unknown";
    } finally {
      this.busy = false;
    }
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const draft = this.draft;
    if (!draft) return html`<p role="alert">${this.t("profile_load_failed")}</p>`;
    return html`<section class="station profile-settings">
      <h2>${this.t("profile_options")}</h2>
      <p>${this.t("profile_settings_hint")}</p>
      <form @submit=${(e: Event) => this.save(e)}>
        <fieldset ?disabled=${this.busy}>
          <legend>${this.t("profile_fields")}</legend>
          ${draft.fields.map(
            (f) =>
              html`<div class="profile-definition fields">
                <label
                  >${this.t("profile_label")}<input
                    required
                    maxlength="64"
                    .value=${f.label}
                    @input=${(e: Event) => {
                      f.label = (e.target as HTMLInputElement).value;
                    }}
                /></label>
                <label
                  >${this.t("profile_suggestions")}<textarea
                    rows="2"
                    .value=${f.options.join("\n")}
                    @input=${(e: Event) => {
                      f.options = (e.target as HTMLTextAreaElement).value
                        .split("\n")
                        .map((v) => v.trim())
                        .filter(Boolean);
                    }}
                  ></textarea>
                </label>
                <label class="check"
                  ><input
                    type="checkbox"
                    .checked=${f.enabled}
                    @change=${(e: Event) => {
                      f.enabled = (e.target as HTMLInputElement).checked;
                    }}
                  />${this.t("profile_collect")}</label
                >
              </div>`,
          )}
          <button
            type="button"
            ?disabled=${draft.fields.length >= 12}
            @click=${() => this.add("fields")}
          >
            ${this.t("profile_add_field")}
          </button>
        </fieldset>
        <fieldset ?disabled=${this.busy}>
          <legend>${this.t("profile_groups")}</legend>
          ${draft.groups.map(
            (g) =>
              html`<div class="profile-definition fields">
                <label
                  >${this.t("profile_group_name")}<input
                    required
                    maxlength="64"
                    .value=${g.label}
                    @input=${(e: Event) => {
                      g.label = (e.target as HTMLInputElement).value;
                    }} /></label
                ><label class="check"
                  ><input
                    type="checkbox"
                    .checked=${g.enabled}
                    @change=${(e: Event) => {
                      g.enabled = (e.target as HTMLInputElement).checked;
                    }}
                  />${this.t("active")}</label
                >
              </div>`,
          )}
          <button
            type="button"
            ?disabled=${draft.groups.length >= 64}
            @click=${() => this.add("groups")}
          >
            ${this.t("profile_add_group")}
          </button>
        </fieldset>
        <label class="check"
          ><input
            type="checkbox"
            .checked=${draft.photo_enabled}
            ?disabled=${this.busy}
            @change=${(e: Event) => {
              draft.photo_enabled = (e.target as HTMLInputElement).checked;
            }}
          />${this.t("profile_photo_enabled")}</label
        >
        <p class="sub">${this.t("profile_archive_hint")}</p>
        <div class="row">
          <button type="submit" class="primary" ?disabled=${this.busy || this.stale}>
            ${this.t("save")}</button
          ><button type="button" ?disabled=${this.busy} @click=${() => this.reload()}>
            ${this.t("media_reload")}
          </button>
        </div>
      </form>
      ${this.notice ? html`<p role="status">${this.t(this.notice)}</p>` : nothing}${this.error ? html`<p class="notice error" role="alert">${this.t(this.error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-profile-settings", ProfileSettingsPanel);
