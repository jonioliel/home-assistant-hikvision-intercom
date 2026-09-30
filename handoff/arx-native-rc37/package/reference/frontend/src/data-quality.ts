import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import type { Hass } from "./types";
interface Identity {
  id: string;
  display_name: string;
  employee_no: string;
  archived: boolean;
}
interface Finding {
  kind: string;
  code: string;
  label: string;
  related_count?: number;
  related_people?: Identity[];
}
interface QualityRow extends Identity {
  revision: number;
  operator_editable: boolean;
  issues: Finding[];
}
interface QualityReport {
  snapshot: string;
  stale: boolean;
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  previous_offset: number | null;
  records: QualityRow[];
  coverage: { scope: string; scanned: number; archived: number; unknown_fields: number };
  summary: { people: number; missing: number; invalid: number; duplicate: number };
}
export class DataQuality extends LitElement {
  static properties = {
    hass: { attribute: false },
    context: { type: String },
    canView: { type: Boolean },
    data: { state: true },
    busy: { state: true },
    error: { state: true },
    kind: { state: true },
    state: { state: true },
  };
  static styles = css`
    :host {
      display: block;
      color: var(--ink, var(--primary-text-color));
      min-width: 0;
    }
    h2,
    p {
      margin: 0;
    }
    p {
      line-height: 1.5;
    }
    .sub {
      color: var(--muted, var(--secondary-text-color));
    }
    .heading,
    .toolbar,
    .person {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: space-between;
    }
    .heading {
      margin-bottom: 12px;
    }
    .toolbar {
      justify-content: flex-start;
      margin: 12px 0;
    }
    button,
    select {
      font: inherit;
      color: inherit;
      background: var(--surface, var(--card-background-color));
      border: 1px solid var(--line, var(--divider-color, #dce5e6));
      border-radius: 8px;
      min-height: 40px;
      padding: 7px 10px;
      max-width: 100%;
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    button:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--accent, #407f73);
      outline-offset: 2px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin: 12px 0;
    }
    .metric,
    article {
      border: 1px solid var(--line, var(--divider-color, #dce5e6));
      background: var(--surface, var(--card-background-color));
      border-radius: 10px;
      padding: 12px;
    }
    .metric strong {
      display: block;
      font-size: 1.4rem;
    }
    .list {
      display: grid;
      gap: 8px;
    }
    article {
      min-width: 0;
    }
    .identity {
      overflow-wrap: anywhere;
      min-width: 0;
    }
    .identity small {
      display: block;
    }
    ul {
      margin: 8px 0;
      padding-inline-start: 20px;
    }
    li {
      margin: 5px 0;
    }
    .related {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-block: 8px;
    }
    details {
      margin-block: 6px;
    }
    summary {
      cursor: pointer;
    }
    .pager {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: flex-end;
      margin: 12px 0;
    }
    @media (max-width: 600px) {
      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .toolbar label {
        width: 100%;
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }
    }
  `;
  hass?: Hass;
  context = "";
  canView = false;
  private data?: QualityReport;
  private busy = false;
  private error = "";
  private kind = "all";
  private state = "current";
  private key = "";
  private epoch = 0;
  private connection?: Hass["connection"];
  private requests = new ScopedRequests(
    () => this.hass,
    () => this.canView,
  );
  private t = (key: string) => translate(this.hass?.language ?? "en", key);
  private disconnected = () => {
    this.epoch++;
    this.requests.cancel();
    this.data = undefined;
    this.busy = false;
    this.error = "connection_lost";
  };
  disconnectedCallback() {
    super.disconnectedCallback();
    this.epoch++;
    this.requests.cancel();
    this.connection?.removeEventListener?.("disconnected", this.disconnected);
    this.data = undefined;
  }
  protected updated(_changes: PropertyValues) {
    const key = `${this.hass?.user?.id}:${this.context}:${this.canView}`;
    if (key !== this.key || this.connection !== this.hass?.connection) {
      this.epoch++;
      this.requests.cancel();
      this.data = undefined;
      this.busy = false;
      this.error = "";
      this.key = key;
      this.connection?.removeEventListener?.("disconnected", this.disconnected);
      this.connection = this.hass?.connection;
      this.connection?.addEventListener?.("disconnected", this.disconnected);
      if (this.canView && this.hass?.user) void this.load();
    }
  }
  private async load(offset = 0, snapshot = "") {
    if (!this.canView || !this.hass?.user) return;
    const epoch = ++this.epoch;
    this.requests.cancel();
    this.busy = true;
    this.error = "";
    try {
      const report = await this.requests.run<QualityReport>(
        {
          type: "hikvision_intercom/users/data_quality",
          kind: this.kind,
          state: this.state,
          offset,
          limit: 50,
          snapshot,
        },
        15000,
      );
      if (epoch === this.epoch && this.isConnected) this.data = report;
    } catch (error) {
      if (epoch === this.epoch) {
        this.data = undefined;
        this.error = (error as { code?: string }).code ?? "action_failed";
      }
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  private open(id: string) {
    if (!this.busy && this.canView)
      this.dispatchEvent(new CustomEvent("open-user", { detail: id }));
  }
  private change(key: "kind" | "state", event: Event) {
    this[key] = (event.target as HTMLSelectElement).value;
    this.data = undefined;
    void this.load();
  }
  private finding(item: Finding) {
    return html`<li>
      ${this.t("quality_reason_" + item.code)}${item.label ? ": " + item.label : ""}
      ${
        item.related_count
          ? html`<details>
              <summary>${this.t("quality_related")} (${item.related_count})</summary>
              <div class="related">
                ${(item.related_people ?? []).map((other) => this.related(other))}
              </div>
              ${item.related_count > 10 ? html`<p class="sub">${this.t("quality_related_limit")}</p>` : nothing}
            </details>`
          : nothing
      }
    </li>`;
  }
  private related(other: Identity) {
    return html`<button ?disabled=${this.busy} @click=${() => this.open(other.id)}>
      ${other.display_name} ·
      ${other.employee_no}${other.archived ? " · " + this.t("quality_state_archived") : ""}
    </button>`;
  }
  private row(row: QualityRow) {
    return html`<article>
      <div class="person">
        <div class="identity">
          <strong>${row.display_name}</strong>
          <small class="sub"
            >${row.employee_no}${row.archived ? " · " + this.t("quality_state_archived") : ""}</small
          >
        </div>
        <button ?disabled=${this.busy} @click=${() => this.open(row.id)}>
          ${this.t("lifecycle_open_user")}
        </button>
      </div>
      <ul>
        ${row.issues.map((item) => this.finding(item))}
      </ul>
    </article>`;
  }
  render() {
    if (!this.canView) return nothing;
    const data = this.data;
    return html`<div class="heading">
        <div>
          <h2>${this.t("data_quality")}</h2>
          <p class="sub">${this.t("quality_intro")}</p>
        </div>
        <button ?disabled=${this.busy} @click=${() => this.load()}>${this.t("refresh")}</button>
      </div>
      <div class="toolbar">
        <label
          >${this.t("quality_filter")}
          <select
            .value=${this.kind}
            ?disabled=${this.busy}
            @change=${(e: Event) => this.change("kind", e)}
          >
            ${["all", "missing", "invalid", "duplicate"].map((k) => html`<option value=${k}>${this.t("quality_" + k)}</option>`)}
          </select></label
        >
        <label
          >${this.t("quality_population")}
          <select
            .value=${this.state}
            ?disabled=${this.busy}
            @change=${(e: Event) => this.change("state", e)}
          >
            ${["current", "archived", "all"].map((k) => html`<option value=${k}>${this.t("quality_state_" + k)}</option>`)}
          </select></label
        >
      </div>
      ${this.busy ? html`<p role="status">${this.t("loading")}</p>` : nothing}
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
      ${
        data
          ? html`<p class="sub">
                ${this.t(data.coverage.scope === "visible" ? "quality_visible" : "quality_all_scope")}
                · ${this.t("quality_scanned")} ${data.coverage.scanned} ·
                ${this.t("quality_archived_count")} ${data.coverage.archived}
              </p>
              ${data.coverage.unknown_fields ? html`<p class="sub">${this.t("quality_unknown")}</p>` : nothing}
              <div class="summary">
                ${(["people", "missing", "invalid", "duplicate"] as const).map((k) => html`<div class="metric"><strong>${data.summary[k]}</strong>${this.t("quality_" + k)}</div>`)}
              </div>
              ${
                data.stale
                  ? html`<p role="alert">${this.t("quality_stale")}</p>`
                  : html` <p class="sub">${this.t("quality_results")} ${data.total}</p>
                      <div class="list">${data.records.map((row) => this.row(row))}</div>
                      ${!data.records.length ? html`<p role="status">${this.t("quality_empty")}</p>` : nothing}
                      <div class="pager">
                        <button
                          ?disabled=${this.busy || data.previous_offset === null}
                          @click=${() => this.load(data.previous_offset ?? 0, data.snapshot)}
                        >
                          ${this.t("previous")}
                        </button>
                        <span
                          >${data.total ? data.offset + 1 : 0}–${Math.min(data.offset + data.records.length, data.total)}
                          / ${data.total}</span
                        >
                        <button
                          ?disabled=${this.busy || data.next_offset === null}
                          @click=${() => this.load(data.next_offset ?? 0, data.snapshot)}
                        >
                          ${this.t("next")}
                        </button>
                      </div>`
              }`
          : nothing
      }`;
  }
}
customElements.define("wiskey-data-quality", DataQuality);
