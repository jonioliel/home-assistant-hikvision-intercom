import { LitElement, html, css, nothing } from "lit";
import type { Hass } from "./types";
import { boundedRequest } from "./request";
type Flow = {
  type: string;
  flow_id?: string;
  step_id?: string;
  data_schema?: any[];
  errors?: Record<string, string>;
  reason?: string;
  description_placeholders?: Record<string, string>;
};
type Row = {
  host: string;
  name: string;
  state: "queued" | "saved" | "skipped" | "failed";
  model?: string;
};
export class WiskeyStationOnboarding extends LitElement {
  static properties = {
    hass: { attribute: false },
    rows: { state: true },
    flow: { state: true },
    busy: { state: true },
    error: { state: true },
    draft: { state: true },
    addresses: { state: true },
  };
  static styles = css`
    :host {
      display: block;
      max-width: 100%;
      color: inherit;
    }
    * {
      box-sizing: border-box;
    }
    input,
    select,
    textarea,
    button {
      font: inherit;
      color: inherit;
      max-width: 100%;
      border: 1px solid var(--divider-color, #dce5e6);
      border-radius: 8px;
      padding: 9px;
      background: var(--surface, var(--card-background-color, #fff));
    }
    input,
    select,
    textarea {
      width: 100%;
      min-width: 0;
    }
    textarea {
      min-height: 80px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    label {
      display: grid;
      gap: 5px;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .check input {
      width: auto;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
    }
    .error {
      color: var(--error-color, #b33d4d);
    }
    .row {
      padding: 8px;
      border-bottom: 1px solid var(--divider-color, #dce5e6);
      overflow-wrap: anywhere;
    }
    .sub {
      font-size: 0.9em;
      opacity: 0.8;
    }
    .physical {
      border-inline-start: 3px solid #b18a36;
      padding: 10px;
    }
    @media (max-width: 600px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  hass?: Hass;
  private rows: Row[] = [];
  private flow: Flow | null = null;
  private busy = false;
  private error = "";
  private draft: Record<string, any> = {};
  private addresses = "";
  private credentials = {
    username: "admin",
    password: "",
    scheme: "http",
    port: 80,
    verify_ssl: true,
    rtsp_port: 554,
  };
  private index = -1;
  private actor = "";
  private transport?: Hass["connection"];
  private controller?: AbortController;
  private closed = false;
  private flowOwner?: Hass;
  private epoch = 0;
  private copy(en: string, he: string) {
    return this.hass?.language?.startsWith("he") ? he : en;
  }
  private label(key: string) {
    const labels: Record<string, [string, string]> = {
      username: ["Username", "שם משתמש"],
      password: ["Password", "סיסמה"],
      name: ["Station name", "שם תחנה"],
      host: ["Address", "כתובת"],
      port: ["Port", "פורט"],
      scheme: ["Protocol", "פרוטוקול"],
      rtsp_port: ["RTSP port", "פורט RTSP"],
      verify_ssl: ["Verify TLS certificate", "אמת תעודת TLS"],
      mode: ["Station management", "ניהול תחנה"],
      lock_name: ["Door name", "שם הדלת"],
      api_id: ["API relay", "ממסר API"],
      test_unlock: ["I am at the door and authorize a relay test", "אני ליד הדלת ומאשר בדיקת ממסר"],
      result: ["Observed physical result", "התוצאה הפיזית שראיתי"],
      camera_only: ["Camera only", "מצלמה בלבד"],
      map_active_relay: ["Map active relay", "מיפוי ממסר פעיל"],
      keep_confirmed_mapping: ["Keep confirmed mapping", "שמור מיפוי מאומת"],
      released_and_returned: ["Released and returned normally", "נפתח וחזר למצב רגיל"],
      choose_again: ["Choose another relay", "בחר ממסר אחר"],
      queued: ["Queued", "ממתינה"],
      saved: ["Added", "נוספה"],
      skipped: ["Skipped", "דולגה"],
      failed: ["Needs attention", "נדרשת בדיקה"],
    };
    return labels[key] ? this.copy(...labels[key]) : key;
  }
  protected updated() {
    const actor = this.hass?.user?.id ?? "";
    if (
      actor !== this.actor ||
      this.transport !== this.hass?.connection ||
      (!this.hass?.user?.is_admin &&
        (this.rows.length > 0 || !!this.flow || !!this.credentials.password))
    ) {
      this.clear();
      this.actor = actor;
      this.transport = this.hass?.connection;
    }
  }
  connectedCallback() {
    super.connectedCallback();
    this.closed = false;
  }
  disconnectedCallback() {
    this.closed = true;
    this.clear();
    super.disconnectedCallback();
  }
  private abortFlow(hass: Hass | undefined, flow: Flow | null) {
    if (
      flow?.type === "form" &&
      flow.flow_id &&
      hass?.callApi &&
      hass.user?.is_admin &&
      hass.connection?.connected !== false
    )
      void hass.callApi("DELETE", "config/config_entries/flow/" + flow.flow_id).catch(() => {});
  }
  private clear() {
    this.abortFlow(this.flowOwner, this.flow);
    this.flowOwner = undefined;
    this.epoch++;
    this.controller?.abort();
    this.flow = null;
    this.rows = [];
    this.draft = {};
    this.credentials = {
      username: "admin",
      password: "",
      scheme: "http",
      port: 80,
      verify_ssl: true,
      rtsp_port: 554,
    };
    this.addresses = "";
    this.index = -1;
    this.busy = false;
    this.error = "";
  }
  private async api(method: string, path: string, data?: Record<string, unknown>): Promise<Flow> {
    const hass = this.hass,
      actor = hass?.user?.id,
      connection = hass?.connection;
    if (!hass?.user?.is_admin || !hass.callApi || connection?.connected === false || this.closed)
      throw { code: "connection_lost" };
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    const lost = () => controller.abort();
    connection?.addEventListener?.("disconnected", lost);
    try {
      const pending = hass.callApi!<Flow>(method, path, data);
      // The wait cannot cancel server work; discard only unfinished forms.
      // A created station must never be removed by browser cleanup.
      void pending.then(
        (result) => {
          if (controller.signal.aborted || epoch !== this.epoch) this.abortFlow(hass, result);
        },
        () => {},
      );
      const result = await boundedRequest(() => pending, 60000, controller.signal);
      if (
        this.closed ||
        epoch !== this.epoch ||
        this.hass?.user?.id !== actor ||
        !this.hass?.user?.is_admin ||
        this.hass.connection !== connection ||
        (connection?.connected as boolean | undefined) === false
      )
        throw { code: "connection_lost" };
      return result;
    } finally {
      connection?.removeEventListener?.("disconnected", lost);
      if (this.controller === controller) this.controller = undefined;
    }
  }
  private async action(run: () => Promise<void>) {
    if (this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = "";
    try {
      await run();
    } catch {
      if (epoch !== this.epoch) return;
      this.error = this.copy(
        "The request did not complete. Verify installation state before retrying.",
        "הבקשה לא הסתיימה. בדוק את מצב ההתקנה לפני ניסיון נוסף.",
      );
      if (this.rows[this.index])
        this.rows = this.rows.map((r, i) => (i === this.index ? { ...r, state: "failed" } : r));
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private prepare(result: Flow) {
    this.flowOwner = this.hass;
    this.flow = result;
    this.draft = {};
    for (const field of result.data_schema ?? [])
      this.draft[field.name] =
        field.default ??
        (field.name === "mode"
          ? "camera_only"
          : field.type === "boolean" || field.selector?.boolean !== undefined
            ? false
            : "");
    if (result.step_id === "user")
      this.draft = {
        ...this.draft,
        ...this.credentials,
        host: this.rows[this.index]?.host ?? "",
        name: this.rows[this.index]?.name ?? "",
      };
    if (result.type === "create_entry") {
      this.rows = this.rows.map((r, i) => (i === this.index ? { ...r, state: "saved" } : r));
      this.flow = null;
      if (!this.rows.some((row) => row.state === "queued")) this.credentials.password = "";
    } else if (result.type === "abort") {
      this.rows = this.rows.map((r, i) => (i === this.index ? { ...r, state: "failed" } : r));
      this.flow = null;
      this.error =
        result.reason === "already_configured"
          ? this.copy("Station already configured.", "התחנה כבר מוגדרת.")
          : this.copy("The setup wizard stopped.", "אשף ההתקנה נעצר.");
    } else if (result.step_id === "confirm_device")
      this.rows = this.rows.map((r, i) =>
        i === this.index ? { ...r, model: result.description_placeholders?.model } : r,
      );
    if (result.errors && Object.keys(result.errors).length)
      this.error = this.copy(
        "Check station values and connection, or skip it.",
        "בדוק את הנתונים ואת החיבור לתחנה, או דלג עליה.",
      );
  }
  private async next() {
    const next = this.rows.findIndex((r) => r.state === "queued");
    if (next < 0) {
      this.credentials.password = "";
      return;
    }
    this.index = next;
    const flow = await this.api("POST", "config/config_entries/flow", {
      handler: "hikvision_intercom",
    });
    this.flow = flow;
    this.flowOwner = this.hass;
    if (flow.type !== "form" || flow.step_id !== "user" || !flow.flow_id) {
      this.prepare(flow);
      return;
    }
    this.prepare(
      await this.api("POST", "config/config_entries/flow/" + flow.flow_id, {
        ...this.credentials,
        host: this.rows[next].host,
        name: this.rows[next].name,
      }),
    );
  }
  private async start() {
    const rows = this.addresses
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [host, name] = s.split("|");
        return { host: host.trim(), name: name?.trim() || host.trim() };
      });
    if (
      !rows.length ||
      rows.length > 20 ||
      rows.some((r) => !r.host || r.name.length > 64) ||
      new Set(rows.map((r) => r.host.toLowerCase())).size !== rows.length
    ) {
      this.error = this.copy(
        "Enter 1–20 distinct addresses, optionally followed by | station name.",
        "הזן 1–20 כתובות שונות, אפשר להוסיף | שם תחנה.",
      );
      return;
    }
    this.rows = rows.map((r) => ({ ...r, state: "queued" }));
    await this.next();
  }
  private field(field: any, values: Record<string, any>, set: (key: string, value: any) => void) {
    const bool = field.type === "boolean" || field.selector?.boolean !== undefined;
    const numeric = field.type === "integer" || ["port", "rtsp_port"].includes(field.name);
    const options = (field.selector?.select?.options ?? field.options ?? []).map((o: any) => ({
      value: Array.isArray(o) ? o[0] : typeof o === "object" ? o.value : o,
      label: Array.isArray(o) ? o[1] : typeof o === "object" ? (o.label ?? o.value) : o,
    }));
    return html`<label class=${bool ? "check" : ""}
      >${this.label(field.name)}${
        bool
          ? html`<input
              aria-label=${this.label(field.name)}
              ?disabled=${this.busy}
              type="checkbox"
              .checked=${!!values[field.name]}
              @change=${(e: Event) => set(field.name, (e.target as HTMLInputElement).checked)}
            />`
          : options.length
            ? html`<select
                aria-label=${this.label(field.name)}
                ?disabled=${this.busy}
                .value=${String(values[field.name])}
                @change=${(e: Event) => set(field.name, options.find((o: any) => String(o.value) === (e.target as HTMLSelectElement).value)?.value)}
              >
                <option value="">${this.copy("Select", "בחר")}</option>
                ${options.map((o: any) => html`<option .value=${String(o.value)} .selected=${String(values[field.name]) === String(o.value)}>${this.label(String(o.label))}</option>`)}
              </select>`
            : html`<input
                aria-label=${this.label(field.name)}
                ?disabled=${this.busy}
                type=${field.name === "password" ? "password" : numeric ? "number" : "text"}
                .value=${String(values[field.name] ?? "")}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  set(field.name, numeric ? Number(v) : v);
                }}
              />`
      }</label
    >`;
  }
  render() {
    if (!this.hass?.user?.is_admin) return nothing;
    if (!this.hass.callApi)
      return html`<p>
        ${this.copy("Use the existing infrastructure setup wizard.", "השתמש באשף ההתקנה הקיים בתשתית המערכת.")}
      </p>`;
    const info = this.flow?.description_placeholders;
    return html`<details>
      <summary>${this.copy("Add stations in sequence", "הוספת תחנות ברצף")}</summary>
      <p class="sub">
        ${this.copy("Every station uses existing identity and physical relay confirmation. No relay test runs automatically.", "כל תחנה עוברת אימות זהות ואישור ממסר פיזי באשף הקיים. בדיקת ממסר אינה מופעלת אוטומטית.")}
      </p>
      ${
        !this.rows.length
          ? html`<label
                >${this.copy("One address per line; optional | station name", "כתובת בכל שורה; אפשר להוסיף | שם תחנה")}<textarea
                  ?disabled=${this.busy}
                  .value=${this.addresses}
                  @input=${(e: Event) => (this.addresses = (e.target as HTMLTextAreaElement).value)}
                ></textarea>
              </label>
              <div class="grid">
                ${["username", "password", "scheme", "port", "verify_ssl", "rtsp_port"].map((name) => this.field({ name, type: name === "verify_ssl" ? "boolean" : undefined, options: name === "scheme" ? ["http", "https"] : undefined }, this.credentials, (key, value) => (this.credentials = { ...this.credentials, [key]: value })))}
              </div>
              <div class="actions">
                <button ?disabled=${this.busy} @click=${() => void this.action(() => this.start())}>
                  ${this.copy("Validate first station", "אמת תחנה ראשונה")}
                </button>
              </div>`
          : html`${this.rows.map((row) => html`<div class="row"><strong>${row.name}</strong> · <span dir="ltr">${row.host}</span> · ${row.model ?? ""} · ${this.label(row.state)}</div>`)}${
              this.flow
                ? html`<h4>${this.rows[this.index]?.name}</h4>
                    ${info ? html`<p>${[info.model, info.firmware, info.serial].filter(Boolean).join(" · ")}</p>` : nothing}${["mapping", "confirm_mapping"].includes(this.flow.step_id ?? "") ? html`<p class="physical">${this.copy("A relay test may open a real door. Continue only if you can observe it. A command acknowledgement is not physical confirmation.", "בדיקת ממסר עשויה לפתוח דלת אמיתית. המשך רק אם ניתן לצפות בה. אישור פקודה אינו אישור פיזי.")}</p>` : nothing}
                    <div class="grid">
                      ${(this.flow.data_schema ?? []).map((field) => this.field(field, this.draft, (key, value) => (this.draft = { ...this.draft, [key]: value })))}
                    </div>
                    <div class="actions">
                      <button
                        ?disabled=${this.busy || (this.flow.step_id === "mapping" && !this.draft.test_unlock)}
                        @click=${() => void this.action(async () => this.prepare(await this.api("POST", "config/config_entries/flow/" + this.flow!.flow_id, this.draft)))}
                      >
                        ${this.flow.step_id === "mapping" ? this.copy("Run authorized relay test", "בצע בדיקת ממסר מאושרת") : this.copy("Continue this station", "המשך בתחנה זו")}</button
                      ><button
                        ?disabled=${this.busy}
                        @click=${() =>
                          void this.action(async () => {
                            if (this.flow?.flow_id)
                              await this.api(
                                "DELETE",
                                "config/config_entries/flow/" + this.flow.flow_id,
                              );
                            this.rows = this.rows.map((r, i) =>
                              i === this.index ? { ...r, state: "skipped" } : r,
                            );
                            this.flow = null;
                          })}
                      >
                        ${this.copy("Skip station", "דלג על תחנה")}
                      </button>
                    </div>`
                : this.rows.some((r) => r.state === "queued")
                  ? html`<button
                      ?disabled=${this.busy}
                      @click=${() => void this.action(() => this.next())}
                    >
                      ${this.copy("Next station", "לתחנה הבאה")}
                    </button>`
                  : html`<p>
                        ${this.copy("Sequence finished; inspect failed rows separately.", "הרצף הסתיים; בדוק שורות שנכשלו בנפרד.")}
                      </p>
                      <button @click=${() => this.clear()}>
                        ${this.copy("New sequence", "רצף חדש")}
                      </button>`
            }`
      }
      ${this.error ? html`<p role="alert" class="error">${this.error}</p>` : nothing}
    </details>`;
  }
}
customElements.define("wiskey-station-onboarding", WiskeyStationOnboarding);
