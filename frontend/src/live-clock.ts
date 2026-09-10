import { LitElement, html, css } from "lit";
import { UTC_ZONE, type DisplayZone } from "./time";
import { translate } from "./i18n";

/** Browser time in HA's configured zone; independent of panel refresh and station event time. */
export class LiveClock extends LitElement {
  static properties = { language: {}, zone: {}, now: { state: true } };
  language = "en";
  zone: DisplayZone = UTC_ZONE;
  private now = Date.now();
  private timer?: ReturnType<typeof setTimeout>;
  static styles = css`
    :host {
      display: block;
      margin-top: 5px;
      font-size: 12px;
      color: var(--secondary-text-color, #53647b);
    }
    time {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 4px 8px;
      line-height: 18px;
      font-variant-numeric: tabular-nums;
    }
    .time {
      font-weight: 600;
      color: var(--primary-text-color, #142133);
    }
    .zone {
      font-size: 10px;
      overflow-wrap: anywhere;
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.tick);
    this.tick();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.tick);
  }
  private tick = () => {
    clearTimeout(this.timer);
    if (!this.isConnected) return;
    this.now = Date.now();
    if (!document.hidden) this.timer = setTimeout(this.tick, 1000 - (Date.now() % 1000));
  };
  render() {
    let timeZone = this.zone?.kind === "iana" ? this.zone.name : "UTC";
    try {
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      timeZone = "UTC";
    }
    // HA supplies a BCP 47 language; use an explicit safe fallback for malformed fixture/custom data.
    let locale = this.language;
    try {
      new Intl.DateTimeFormat(locale);
    } catch {
      locale = "en";
    }
    const date = new Date(this.now);
    const day = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const time = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date);
    return html`<div
      role="timer"
      aria-live="off"
      aria-label=${translate(this.language, "live_clock")}
    >
      <time datetime=${date.toISOString()}
        ><bdi class="date">${day}</bdi><bdi class="time" dir="ltr">${time}</bdi
        ><bdi class="zone" dir="ltr" title=${translate(this.language, "clock_zone")}
          >${timeZone}</bdi
        ></time
      >
    </div>`;
  }
}
customElements.define("hikvision-live-clock", LiveClock);
