import { LitElement, css, html, nothing } from "lit";
import { timingValidity, timingPreview } from "./timing-validity";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { UserTimingDraft } from "./types";

export class UserTiming extends LitElement {
  static properties = {
    value: { attribute: false },
    language: {},
    enforcement: {},
    canEnforce: { attribute: false },
    date: { state: true },
    previewDate: { state: true },
    previewTime: { state: true },
  };
  static styles = [
    styles,
    css`
      :host {
        height: auto;
        overflow: visible;
        background: transparent;
      }
      .days {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-block: 12px;
      }
      .day {
        display: flex;
        gap: 8px;
        align-items: center;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 8px;
      }
      input[type="checkbox"] {
        width: 20px;
        height: 20px;
        margin: 0;
      }
      .period {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 8px;
        margin-block: 12px;
      }
      .period label {
        flex: 1 1 110px;
        min-width: 0;
      }
      .sub {
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .notice {
        padding: 12px;
        border-inline-start: 3px solid #c58016;
        background: var(--secondary-background-color, #fff8e7);
        line-height: 1.6;
      }
    `,
  ];
  value?: UserTimingDraft;
  language = "en";
  enforcement = "draft";
  canEnforce = false;
  private date = "";
  private previewDate = "";
  private previewTime = "12:00";
  private t = (key: string) => translate(this.language, key);
  private change(patch: Partial<UserTimingDraft>) {
    this.dispatchEvent(
      new CustomEvent("timing-change", {
        detail: { ...this.value, ...patch },
        bubbles: true,
        composed: true,
      }),
    );
  }
  render() {
    const draft = this.value;
    if (!draft) return nothing;
    const allDay =
      draft.periods.length === 1 &&
      draft.periods[0].start === "00:00" &&
      draft.periods[0].end === "24:00";
    let convertible = false;
    try {
      timingValidity(draft);
      convertible = true;
    } catch {
      /* Keep all gaps restricted. */
    }
    let preview = "";
    if (this.previewDate) {
      try {
        preview = this.t(
          timingPreview(draft, this.previewDate, this.previewTime)
            ? this.enforcement === "draft"
              ? "user_timing_preview_inside"
              : "user_timing_active_preview_inside"
            : this.enforcement === "draft"
              ? "user_timing_preview_outside"
              : "user_timing_active_preview_outside",
        );
      } catch {
        preview = this.t("user_timing_preview_invalid");
      }
    }
    return html`<p class="notice" role="note">
        ${this.t(this.enforcement === "draft" ? (this.canEnforce ? "user_timing_choose_notice" : "user_timing_draft_notice") : "user_timing_" + this.enforcement + "_notice")}
      </p>
      <label
        >${this.t("user_timing_zone")}<input
          dir="ltr"
          .value=${draft.timezone}
          @change=${(e: Event) => this.change({ timezone: (e.target as HTMLInputElement).value })}
      /></label>
      ${draft.mode === "weekly" ? this.week(draft) : this.dates(draft)}
      <label class="day"
        ><input
          type="checkbox"
          .checked=${allDay}
          @change=${(e: Event) => this.change({ periods: (e.target as HTMLInputElement).checked ? [{ start: "00:00", end: "24:00" }] : [{ start: "09:00", end: "17:00" }] })}
        />${this.t("user_timing_all_day")}</label
      >
      ${
        allDay
          ? nothing
          : draft.periods.map(
              (period, index) =>
                html`<div class="period">
                  <label
                    >${this.t("valid_from")}<input
                      type="time"
                      .value=${period.start}
                      @change=${(e: Event) => this.change({ periods: draft.periods.map((p, i) => (i === index ? { ...p, start: (e.target as HTMLInputElement).value } : p)) })} /></label
                  ><label
                    >${this.t("valid_until")}<input
                      type="time"
                      .value=${period.end === "24:00" ? "00:00" : period.end}
                      @change=${(e: Event) => {
                        const end = (e.target as HTMLInputElement).value;
                        this.change({
                          periods: draft.periods.map((p, i) =>
                            i === index ? { ...p, end: end === "00:00" ? "24:00" : end } : p,
                          ),
                        });
                      }} /></label
                  ><button
                    type="button"
                    ?disabled=${draft.periods.length === 1}
                    @click=${() => this.change({ periods: draft.periods.filter((_, i) => i !== index) })}
                  >
                    ${this.t("remove")}
                  </button>
                </div>`,
            )
      }
      ${
        allDay
          ? nothing
          : html`<p class="sub">${this.t("user_timing_midnight")}</p>
              <button
                type="button"
                ?disabled=${draft.periods.length >= 8}
                @click=${() => this.change({ periods: [...draft.periods, { start: "18:00", end: "20:00" }] })}
              >
                ${this.t("user_timing_add_period")}
              </button>`
      }
      <details>
        <summary>${this.t("user_timing_preview")}</summary>
        <p class="sub">
          ${this.t(this.enforcement === "draft" ? "user_timing_preview_hint" : "user_timing_active_preview_hint")}
          · <bdi>${draft.timezone}</bdi>
        </p>
        <div class="period">
          <label
            >${this.t("user_timing_preview_date")}<input
              type="date"
              min="2000-01-01"
              max="2037-12-31"
              .value=${this.previewDate}
              @input=${(e: Event) => {
                this.previewDate = (e.target as HTMLInputElement).value;
              }}
          /></label>
          <label
            >${this.t("user_timing_preview_time")}<input
              type="time"
              .value=${this.previewTime}
              @input=${(e: Event) => {
                this.previewTime = (e.target as HTMLInputElement).value;
              }}
          /></label>
        </div>
        <output aria-live="polite">${preview}</output>
      </details>
      ${
        draft.mode === "dates" && this.enforcement === "draft" && !this.canEnforce
          ? html`<p class="sub">${this.t("user_timing_convert_hint")}</p>
              <button
                type="button"
                ?disabled=${!convertible}
                @click=${() => this.dispatchEvent(new CustomEvent("timing-convert", { bubbles: true, composed: true }))}
              >
                ${this.t("user_timing_convert")}
              </button>`
          : nothing
      }`;
  }
  private week(draft: UserTimingDraft) {
    return html`<div class="days">
      ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => html`<label class="day"><input type="checkbox" .checked=${draft.days.includes(day)} @change=${(e: Event) => this.change({ days: (e.target as HTMLInputElement).checked ? [...draft.days, day] : draft.days.filter((d) => d !== day) })} />${this.t("day_" + day)}</label>`)}
    </div>`;
  }
  private dates(draft: UserTimingDraft) {
    return html`<div class="period">
        <label
          >${this.t("user_timing_date")}<input
            type="date"
            min="2000-01-01"
            max="2037-12-31"
            .value=${this.date}
            @change=${(e: Event) => {
              this.date = (e.target as HTMLInputElement).value;
            }} /></label
        ><button
          type="button"
          ?disabled=${!this.date || draft.dates.includes(this.date) || draft.dates.length >= 64}
          @click=${() => {
            this.change({ dates: [...draft.dates, this.date].sort() });
            this.date = "";
          }}
        >
          ${this.t("user_timing_add_date")}
        </button>
      </div>
      <div class="days">
        ${draft.dates.map((date) => html`<button type="button" aria-label=${this.t("remove") + " " + date} @click=${() => this.change({ dates: draft.dates.filter((d) => d !== date) })}><bdi>${date}</bdi> ×</button>`)}
      </div>`;
  }
}
customElements.define("hikvision-user-timing", UserTiming);
