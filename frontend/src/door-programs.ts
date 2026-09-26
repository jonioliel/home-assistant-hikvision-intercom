import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { styles } from "./styles";
import { translate } from "./i18n";
import { ScopedRequests } from "./request";
import type { Hass, Station } from "./types";
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Period = { start: string; end: string };
type Policy = {
  timezone: string;
  schedule: {
    name: string;
    weekly: Record<string, Period[]>;
    holidays: { name: string; start: string; end: string; periods: Period[] }[];
  };
};
interface Program {
  door: number;
  revision: number;
  policy: Policy;
  enabled: boolean;
  removing: boolean;
  error: string | null;
  checked_at: string | null;
  execution: { owned: boolean; status: string };
}
export class DoorPrograms extends LitElement {
  static properties = {
    hass: { attribute: false },
    station: { attribute: false },
    programs: { state: true },
    saved: { state: true },
    editor: { state: true },
    door: { state: true },
    revision: { state: true },
    busy: { state: true },
    error: { state: true },
    loaded: { state: true },
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
      .bar,
      .actions,
      .times {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .bar {
        justify-content: space-between;
        margin-bottom: 16px;
      }
      article,
      form {
        padding: 16px;
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        margin: 12px 0;
      }
      h3 {
        margin: 0;
      }
      .schedule-day {
        margin: 12px 0;
        padding: 10px;
        border-bottom: 1px solid var(--divider-color);
      }
      label {
        display: block;
        margin: 10px 0;
      }
      input[type="checkbox"] {
        width: 20px;
        height: 20px;
        vertical-align: middle;
      }
      .times input {
        width: 130px;
      }
      .times label {
        margin: 4px 0;
      }
      .sources {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      button {
        min-height: 40px;
      }
      .sub {
        overflow-wrap: anywhere;
      }
    `,
  ];
  hass?: Hass;
  station?: Station;
  private programs: Program[] = [];
  private saved: Program[] = [];
  private editor?: Policy;
  private door = 1;
  private revision = 0;
  private busy = false;
  private error = "";
  private loaded = false;
  private identity = "";
  private timezone = "UTC";
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
      this.programs = [];
      this.saved = [];
      this.editor = undefined;
      this.error = "";
      this.busy = false;
      this.loaded = false;
      void this.load();
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.requests.cancel();
  }
  private async load() {
    if (this.busy) return;
    this.busy = true;
    const id = this.identity;
    try {
      const data = await this.requests.run<{
        programs: Program[];
        saved: Program[];
        timezone: string;
      }>({
        type: "smplwise_access_control/stations/technical_program_list",
        station_id: this.station?.id,
      });
      if (id !== this.identity) return;
      if (!Array.isArray(data.programs) || !Array.isArray(data.saved))
        throw new Error("invalid response");
      this.timezone = data.timezone;
      this.programs = data.programs;
      this.saved = data.saved;
      this.loaded = true;
      this.error = "";
    } catch {
      if (id === this.identity) this.error = "technical_read_failed";
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  private async beginEdit(item: Program) {
    if (this.busy || item.removing) return;
    if (!item.enabled && !item.execution.owned) {
      this.edit(item);
      return;
    }
    if (!confirm(this.t("program_edit_pause"))) return;
    this.busy = true;
    this.error = "";
    const id = this.identity;
    try {
      const result = await this.requests.run<{ programs: Program[] }>(
        {
          type: "smplwise_access_control/stations/technical_program_action",
          station_id: this.station?.id,
          door: item.door,
          revision: item.revision,
          action: "pause",
        },
        70000,
      );
      if (id !== this.identity) return;
      this.programs = result.programs;
      const paused = result.programs.find((p) => p.door === item.door);
      if (!paused || paused.enabled || paused.execution.owned || paused.removing) {
        this.error = "hold_pause_before_edit";
        return;
      }
      this.edit(paused);
    } catch (e) {
      if (id === this.identity)
        this.error = (e as { code?: string }).code ?? "technical_write_unknown";
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  private edit(item?: Program) {
    this.door =
      item?.door ??
      this.station?.integrated_locks.find(
        (l) => !this.programs.some((p) => p.door === l.physical_index),
      )?.physical_index ??
      1;
    this.revision = item?.revision ?? 0;
    this.editor = structuredClone(
      item?.policy ?? {
        timezone: this.timezone,
        schedule: { name: "", weekly: Object.fromEntries(days.map((d) => [d, []])), holidays: [] },
      },
    );
  }
  private change(fn: (p: Policy) => void) {
    if (!this.editor) return;
    const next = structuredClone(this.editor);
    fn(next);
    this.editor = next;
  }
  private async save(enabled: boolean) {
    if (!this.editor || this.busy) return;
    this.busy = true;
    this.error = "";
    const id = this.identity;
    try {
      const result = await this.requests.run<{ programs: Program[] }>({
        type: "smplwise_access_control/stations/technical_program_save",
        station_id: this.station?.id,
        door: this.door,
        revision: this.revision,
        policy: this.editor,
        enabled,
      });
      if (id === this.identity) {
        this.programs = result.programs;
        this.editor = undefined;
      }
    } catch (e) {
      if (id === this.identity)
        this.error = (e as { code?: string }).code ?? "technical_write_unknown";
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  private async deleteSaved(item: Program) {
    if (this.busy || !confirm(this.t("program_delete_saved_confirm"))) return;
    this.busy = true;
    const id = this.identity;
    try {
      await this.requests.run({
        type: "smplwise_access_control/stations/technical_hold_delete",
        station_id: this.station?.id,
        door: item.door,
        revision: item.revision,
      });
      if (id === this.identity) this.saved = this.saved.filter((s) => s !== item);
    } catch {
      if (id === this.identity) this.error = "technical_write_unknown";
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  private async action(item: Program, action: string) {
    if (
      this.busy ||
      !confirm(this.t(action === "remove" ? "program_remove_confirm" : "program_pause_confirm"))
    )
      return;
    this.busy = true;
    const id = this.identity;
    try {
      const result = await this.requests.run<{ programs: Program[] }>(
        {
          type: "smplwise_access_control/stations/technical_program_action",
          station_id: this.station?.id,
          door: item.door,
          revision: item.revision,
          action,
        },
        70000,
      );
      if (id === this.identity) this.programs = result.programs;
    } catch {
      if (id === this.identity) this.error = "technical_write_unknown";
    } finally {
      if (id === this.identity) this.busy = false;
    }
  }
  private periods(periods: Period[], changed: (v: Period[]) => void) {
    return html`<button type="button" @click=${() => changed([{ start: "00:00", end: "24:00" }])}>
        ${this.t("user_timing_all_day")}</button
      >${periods.map(
        (p, i) =>
          html`<div class="times">
            <label
              >${this.t("program_start")}<input
                type="time"
                .value=${p.start}
                @change=${(e: Event) => changed(periods.map((v, j) => (j === i ? { ...v, start: (e.target as HTMLInputElement).value } : v)))} /></label
            ><label
              >${this.t("program_end")}<input
                type="time"
                .value=${p.end === "24:00" ? "00:00" : p.end}
                @change=${(e: Event) => changed(periods.map((v, j) => (j === i ? { ...v, end: (e.target as HTMLInputElement).value === "00:00" ? "24:00" : (e.target as HTMLInputElement).value } : v)))} /></label
            ><button type="button" @click=${() => changed(periods.filter((_, j) => j !== i))}>
              ${this.t("remove")}
            </button>
          </div>`,
      )}<button
        type="button"
        ?disabled=${periods.length >= 8}
        @click=${() => changed([...periods, { start: "08:00", end: "17:00" }])}
      >
        ${this.t("user_timing_add_period")}
      </button>`;
  }
  render() {
    return html`<div class="bar">
        <h3>${this.t("programs_title")}</h3>
        <div class="actions">
          <button ?disabled=${this.busy} @click=${() => this.load()}>${this.t("refresh")}</button
          ><button
            class="primary"
            ?disabled=${this.busy || !this.loaded || !this.station?.integrated_locks.some((l) => !this.programs.some((p) => p.door === l.physical_index))}
            @click=${() => this.edit()}
          >
            ${this.t("program_new")}
          </button>
        </div>
      </div>
      <p class="sub">${this.t("hold_dependency")}</p>
      ${this.error ? html`<p role="alert">${this.t(this.error)}</p>` : nothing}
      ${this.programs.map(
        (p) =>
          html`<article>
            <div class="bar">
              <strong>${p.policy.schedule.name}</strong
              ><span
                >${this.t(p.removing ? "program_removing" : p.error ? "technical_write_unknown" : p.enabled ? "program_active" : "program_inactive")}</span
              >
            </div>
            <p>
              ${this.station?.integrated_locks.find((l) => l.physical_index === p.door)?.name ?? this.t("physical_lock") + " " + p.door}
              · Home Assistant · <bdi>${p.policy.timezone}</bdi>
            </p>
            <p>${this.t("program_" + p.execution.status)}</p>
            ${p.checked_at ? html`<p class="sub">${this.t("program_checked")}: <bdi>${p.checked_at}</bdi></p>` : nothing}
            <details>
              <summary>${this.t("program_times")}</summary>
              ${days.filter((d) => p.policy.schedule.weekly[d]?.length).map((d) => html`<p>${this.t("day_" + d)}: ${p.policy.schedule.weekly[d].map((w) => `${w.start}–${w.end}`).join(", ")}</p>`)}${p.policy.schedule.holidays.map((h) => html`<p><bdi>${h.start}–${h.end}</bdi>: ${h.periods.map((w) => `${w.start}–${w.end}`).join(", ")}</p>`)}
            </details>
            <div class="actions">
              <button ?disabled=${this.busy || p.removing} @click=${() => this.beginEdit(p)}>
                ${this.t("edit")}</button
              ><button ?disabled=${this.busy || !p.enabled} @click=${() => this.action(p, "pause")}>
                ${this.t("program_pause")}</button
              ><button
                class="danger"
                ?disabled=${this.busy}
                @click=${() => this.action(p, "remove")}
              >
                ${this.t("remove")}
              </button>
            </div>
          </article>`,
      )}
      ${this.saved
        .filter((s) => !this.programs.some((p) => p.door === s.door))
        .map(
          (s) =>
            html`<article>
              <strong>${s.policy.schedule.name}</strong>
              <p>${this.t("program_legacy")}</p>
              <button ?disabled=${this.busy} @click=${() => this.edit({ ...s, revision: 0 })}>
                ${this.t("edit")}</button
              ><button class="danger" ?disabled=${this.busy} @click=${() => this.deleteSaved(s)}>
                ${this.t("remove")}
              </button>
            </article>`,
        )}
      ${
        this.editor
          ? html`<form
              @submit=${(e: Event) => {
                e.preventDefault();
                void this.save(true);
              }}
            >
              <fieldset ?disabled=${this.busy}>
                <legend>${this.t("program_edit")}</legend>
                <label
                  >${this.t("name")}<input
                    required
                    maxlength="32"
                    .value=${this.editor.schedule.name}
                    @input=${(e: Event) => this.change((p) => (p.schedule.name = (e.target as HTMLInputElement).value))} /></label
                ><label
                  >${this.t("physical_lock")}<select
                    ?disabled=${this.revision > 0}
                    .value=${String(this.door)}
                    @change=${(e: Event) => {
                      this.door = Number((e.target as HTMLSelectElement).value);
                    }}
                  >
                    ${this.station?.integrated_locks.map((l) => html`<option ?disabled=${this.revision === 0 && this.programs.some((p) => p.door === l.physical_index)} value=${l.physical_index}>${l.name ?? this.t("physical_lock") + " " + l.physical_index}</option>`)}
                  </select></label
                >
                <div class="sources">
                  <strong>Home Assistant</strong><span>${this.t("program_ha_storage")}</span>
                </div>
                <p>${this.t("hold_dependency")}</p>
                <label
                  >${this.t("hold_timezone")}<input
                    required
                    .value=${this.editor.timezone}
                    @input=${(e: Event) => this.change((p) => (p.timezone = (e.target as HTMLInputElement).value))}
                /></label>
                ${days.map(
                  (d) =>
                    html`<section class="schedule-day">
                      <label
                        ><input
                          type="checkbox"
                          .checked=${!!this.editor!.schedule.weekly[d].length}
                          @change=${(e: Event) => this.change((p) => (p.schedule.weekly[d] = (e.target as HTMLInputElement).checked ? [{ start: "08:00", end: "17:00" }] : []))}
                        />
                        ${this.t("day_" + d)}</label
                      >${this.editor!.schedule.weekly[d].length ? this.periods(this.editor!.schedule.weekly[d], (v) => this.change((p) => (p.schedule.weekly[d] = v))) : nothing}
                    </section>`,
                )}
                <h4>${this.t("program_dates")}</h4>
                ${this.editor.schedule.holidays.map(
                  (h, i) =>
                    html`<section>
                      <label
                        >${this.t("program_start")}<input
                          type="date"
                          required
                          .value=${h.start}
                          @change=${(e: Event) => this.change((p) => (p.schedule.holidays[i].start = (e.target as HTMLInputElement).value))} /></label
                      ><label
                        >${this.t("program_end")}<input
                          type="date"
                          required
                          .value=${h.end}
                          @change=${(e: Event) => this.change((p) => (p.schedule.holidays[i].end = (e.target as HTMLInputElement).value))} /></label
                      >${this.periods(h.periods, (v) => this.change((p) => (p.schedule.holidays[i].periods = v)))}<button
                        type="button"
                        @click=${() => this.change((p) => p.schedule.holidays.splice(i, 1))}
                      >
                        ${this.t("remove")}
                      </button>
                    </section>`,
                )}<button
                  type="button"
                  @click=${() => this.change((p) => p.schedule.holidays.push({ name: "Date", start: "", end: "", periods: [{ start: "08:00", end: "17:00" }] }))}
                >
                  ${this.t("user_timing_add_date")}
                </button>
                <p>${this.t("program_end_hint")}</p>
                <div class="actions">
                  <button class="primary" type="submit">${this.t("program_activate")}</button
                  ><button type="button" @click=${() => this.save(false)}>
                    ${this.t("program_save_inactive")}</button
                  ><button
                    type="button"
                    @click=${() => {
                      this.editor = undefined;
                    }}
                  >
                    ${this.t("cancel")}
                  </button>
                </div>
              </fieldset>
            </form>`
          : nothing
      }`;
  }
}
customElements.define("wiskey-door-programs", DoorPrograms);
