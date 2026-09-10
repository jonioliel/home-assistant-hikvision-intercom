import { LitElement, html, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { ScopedRequests } from "./request";
import { translate } from "./i18n";
import type { Hass, Station } from "./types";

export interface ProfileDefinition {
  id: string;
  label: string;
  enabled: boolean;
  station_ids?: string[];
}
export interface ProfileField extends ProfileDefinition {
  options: string[];
  type?: "text" | "select" | "number" | "date";
  required?: boolean;
}
export interface OnboardingTemplate {
  id: string;
  label: string;
  enabled: boolean;
  profile: Record<string, string>;
  group_ids: string[];
}
export interface ProfilePolicy {
  revision: number;
  fields: ProfileField[];
  groups: ProfileDefinition[];
  photo_enabled: boolean;
  templates?: OnboardingTemplate[];
}
interface PolicyReview {
  operation_id: string;
  requires_confirmation: boolean;
  changed: number;
  offline: string[];
  rows: {
    user_id: string;
    display_name: string;
    employee_no: string;
    before: string[];
    after: string[];
    overrides: Record<string, string>;
    changed: boolean;
  }[];
}
export class ProfileSettingsPanel extends LitElement {
  static styles = styles;
  static properties = {
    hass: { attribute: false },
    settings: { attribute: false },
    stations: { attribute: false },
    draft: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    stale: { state: true },
    review: { state: true },
    page: { state: true },
    pending: { state: true },
  };
  hass?: Hass;
  settings?: ProfilePolicy | null;
  stations: Station[] = [];
  private draft?: ProfilePolicy;
  private review?: PolicyReview;
  private page = 0;
  private pending = "";
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
      this.review = undefined;
      this.pending = "";
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
    else this.draft.groups.push({ id, label: "", enabled: true, station_ids: [] });
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
      this.review = undefined;
      this.pending = "";
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
      const result = await this.requests.run<PolicyReview>(
        { type: "hikvision_intercom/profiles/settings_preview", revision, values },
        15000,
      );
      if (!this.isConnected) return;
      this.review = result;
      this.page = 0;
      if (!result.requires_confirmation) await this.applyReview();
    } catch (e) {
      if (!this.isConnected) return;
      const code = (e as { code?: string }).code;
      this.stale = code !== "invalid_fields";
      this.error =
        code === "revision_conflict"
          ? "media_conflict"
          : code === "invalid_fields"
            ? "media_invalid"
            : code === "station_not_found" ||
                code === "unmanaged_lock" ||
                code === "station_has_no_managed_lock"
              ? this.t(code)
              : "media_save_unknown";
    } finally {
      this.busy = false;
    }
  }
  private async applyReview() {
    if (!this.review || this.pending) return;
    this.pending = this.review.operation_id;
    this.busy = true;
    try {
      await this.requests.run(
        { type: "hikvision_intercom/profiles/settings_apply", operation_id: this.pending },
        20000,
      );
      if (!this.isConnected) return;
      await this.reload();
      this.notice = "saved";
      this.dispatchEvent(new CustomEvent("profile-saved", { detail: this.draft }));
    } catch (e) {
      if (!this.isConnected) return;
      this.error = (e as { code?: string }).code ?? "media_save_unknown";
      this.stale = true;
      // A missing response is not evidence that the transaction failed. Keep its ID.
    } finally {
      this.busy = false;
    }
  }
  private async checkReceipt() {
    if (!this.pending || this.busy) return;
    this.busy = true;
    try {
      await this.requests.run(
        { type: "hikvision_intercom/users/bulk_receipt", operation_id: this.pending },
        10000,
      );
      await this.reload();
      this.notice = "saved";
      this.dispatchEvent(new CustomEvent("profile-saved", { detail: this.draft }));
    } catch (e) {
      this.error = (e as { code?: string }).code ?? "media_save_unknown";
    } finally {
      this.busy = false;
    }
  }
  private templatesView() {
    const draft = this.draft!;
    return html`<fieldset ?disabled=${this.busy || !!this.review}>
      <legend>${this.t("onboarding_templates")}</legend>
      <p>${this.t("onboarding_templates_hint")}</p>
      ${(draft.templates ?? []).map(
        (template) =>
          html`<details class="station">
            <summary>${template.label || this.t("onboarding_new")}</summary>
            <label
              >${this.t("onboarding_name")}<input
                required
                maxlength="64"
                .value=${template.label}
                @input=${(e: Event) => {
                template.label = (e.target as HTMLInputElement).value;
                this.requestUpdate();
              }}
            /></label>
            <label class="check"
              ><input
                type="checkbox"
                .checked=${template.enabled}
                @change=${(e: Event) => (template.enabled = (e.target as HTMLInputElement).checked)}
              />${this.t("active")}</label
            >
            <div class="fields">
              ${draft.fields.filter((f) => f.enabled).map((f) => html`<label>${f.label}<input maxlength="100" .value=${template.profile[f.id] ?? ""} @input=${(e: Event) => (template.profile[f.id] = (e.target as HTMLInputElement).value)} /></label>`)}
            </div>
            <div class="fields">
              ${draft.groups
              .filter((g) => g.enabled || template.group_ids.includes(g.id))
              .map(
                (g) =>
                  html`<label class="check"
                    ><input
                      type="checkbox"
                      .checked=${template.group_ids.includes(g.id)}
                      @change=${(e: Event) => {
                  template.group_ids = (e.target as HTMLInputElement).checked
                    ? [...template.group_ids, g.id]
                    : template.group_ids.filter((id) => id !== g.id);
                }}
                    />${g.label}</label
                  >`,
              )}
            </div>
          </details>`,
      )}
      <button
        type="button"
        ?disabled=${(draft.templates?.length ?? 0) >= 32}
        @click=${() => {
          draft.templates = [
            ...(draft.templates ?? []),
            {
              id: "t_" + crypto.randomUUID().replaceAll("-", ""),
              label: "",
              enabled: true,
              profile: {},
              group_ids: [],
            },
          ];
          this.requestUpdate();
        }}
      >
        ${this.t("onboarding_add")}
      </button>
    </fieldset>`;
  }
  private reviewView() {
    const review = this.review;
    if (!review) return nothing;
    const names = (ids: string[]) =>
      ids.map((id) => this.stations.find((s) => s.id === id)?.name ?? id).join(", ") || "—";
    return html`<section class="station" aria-label=${this.t("policy_review")}>
      <h3>${this.t("policy_review")}</h3>
      <p>${this.t("policy_review_hint")}</p>
      <p>
        ${this.t("bulk_changed")}: ${review.changed} · ${this.t("offline")}:
        ${names(review.offline)}
      </p>
      ${review.rows.slice(this.page * 50, (this.page + 1) * 50).map(
        (row) =>
          html`<article class="notice">
            <strong>${row.display_name}</strong> <bdi>${row.employee_no}</bdi>
            <p>
              ${this.t("before")}: ${names(row.before)} → ${this.t("after")}: ${names(row.after)}
            </p>
            <p>
              ${this.t("personal_overrides")}:
              ${
                Object.entries(row.overrides)
                  .map(
                    ([sid, mode]) =>
                      `${names([sid])}: ${this.t(mode === "deny" ? "permission_denied" : "permission_personal")}`,
                  )
                  .join(", ") || "—"
              }
            </p>
          </article>`,
      )}
      <div class="row">
        <button type="button" ?disabled=${this.page === 0} @click=${() => this.page--}>
          ${this.t("previous")}
        </button>
        <span>${this.page + 1} / ${Math.max(1, Math.ceil(review.rows.length / 50))}</span>
        <button
          type="button"
          ?disabled=${(this.page + 1) * 50 >= review.rows.length}
          @click=${() => this.page++}
        >
          ${this.t("next")}
        </button>
      </div>
      <div class="row">
        <button
          class="primary"
          type="button"
          ?disabled=${this.busy || this.stale || !!this.pending}
          @click=${() => this.applyReview()}
        >
          ${this.t("policy_apply")}
        </button>
        <button
          type="button"
          ?disabled=${this.busy || !!this.pending}
          @click=${() => (this.review = undefined)}
        >
          ${this.t("cancel")}
        </button>
      </div>
      ${
        this.pending
          ? html`<p><bdi>${this.pending}</bdi></p>
              <button type="button" ?disabled=${this.busy} @click=${() => this.checkReceipt()}>
                ${this.t("bulk_receipt")}
              </button>`
          : nothing
      }
    </section>`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    const draft = this.draft;
    if (!draft) return html`<p role="alert">${this.t("profile_load_failed")}</p>`;
    return html`<section class="station profile-settings">
      <h2>${this.t("profile_options")}</h2>
      <p>${this.t("profile_settings_hint")}</p>
      <p class="sub">${this.t("profile_legacy_hint")}</p>
      <form @submit=${(e: Event) => this.save(e)}>
        <fieldset ?disabled=${this.busy || !!this.review}>
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
                  >${this.t("profile_field_type")}<select
                    .value=${f.type ?? "text"}
                    @change=${(e: Event) => {
                      f.type = (e.target as HTMLSelectElement).value as ProfileField["type"];
                      this.requestUpdate();
                    }}
                  >
                    ${["text", "select", "number", "date"].map((kind) => html`<option value=${kind}>${this.t("profile_type_" + kind)}</option>`)}
                  </select></label
                >
                <label class="check"
                  ><input
                    type="checkbox"
                    .checked=${f.required ?? false}
                    @change=${(e: Event) => (f.required = (e.target as HTMLInputElement).checked)}
                  />${this.t("profile_field_required")}</label
                >
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
        <fieldset ?disabled=${this.busy || !!this.review}>
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
                <fieldset class="group-door-options">
                  <legend>${this.t("group_doors")}</legend>
                  <p class="sub">${this.t("group_doors_hint")}</p>
                  ${this.stations.map(
                    (station) =>
                      html`<label class="check"
                        ><input
                          type="checkbox"
                          .checked=${g.station_ids?.includes(station.id) ?? false}
                          ?disabled=${!station.lock_enabled && !g.station_ids?.includes(station.id)}
                          @change=${(e: Event) => {
                            g.station_ids = (e.target as HTMLInputElement).checked
                              ? [...(g.station_ids ?? []), station.id]
                              : (g.station_ids ?? []).filter((id) => id !== station.id);
                            this.requestUpdate();
                          }}
                        />${station.name}</label
                      >`,
                  )}
                  ${(g.station_ids ?? [])
                    .filter((id) => !this.stations.some((s) => s.id === id))
                    .map(
                      (id) =>
                        html`<label class="check"
                          ><input
                            type="checkbox"
                            checked
                            @change=${() => {
                              g.station_ids = g.station_ids?.filter((s) => s !== id);
                              this.requestUpdate();
                            }}
                          />${this.t("group_missing_station")} (${id})</label
                        >`,
                    )}
                </fieldset>
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
        ${this.templatesView()}
        <label class="check"
          ><input
            type="checkbox"
            .checked=${draft.photo_enabled}
            ?disabled=${this.busy || !!this.review}
            @change=${(e: Event) => {
              draft.photo_enabled = (e.target as HTMLInputElement).checked;
            }}
          />${this.t("profile_photo_enabled")}</label
        >
        <p class="sub">${this.t("profile_archive_hint")}</p>
        <div class="row">
          <button
            type="submit"
            class="primary"
            ?disabled=${this.busy || this.stale || !!this.review}
          >
            ${this.t("save")}</button
          ><button type="button" ?disabled=${this.busy} @click=${() => this.reload()}>
            ${this.t("media_reload")}
          </button>
        </div>
      </form>
      ${this.reviewView()}
      ${this.notice ? html`<p role="status">${this.t(this.notice)}</p>` : nothing}${this.error ? html`<p class="notice error" role="alert">${this.t(this.error)}</p>` : nothing}
    </section>`;
  }
}
customElements.define("hikvision-profile-settings", ProfileSettingsPanel);
