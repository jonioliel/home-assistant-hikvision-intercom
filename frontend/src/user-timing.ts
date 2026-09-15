import { LitElement, css, html, nothing } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import type { UserTimingDraft } from "./types";

export class UserTiming extends LitElement {
  static properties = { value: { attribute: false }, language: {}, date: { state: true } };
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
  private date = "";
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
    return html`<p class="notice" role="note">${this.t("user_timing_draft_notice")}</p>
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
