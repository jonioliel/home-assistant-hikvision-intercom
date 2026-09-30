import type { UserTimingDraft } from "./types";
import { fromLocalInput } from "./time";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function dateValue(value: string) {
  const ms = Date.parse(value + "T00:00:00Z");
  if (
    !/^20[0-3][0-9]-[0-9]{2}-[0-9]{2}$/.test(value) ||
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== value ||
    value > "2037-12-31"
  )
    throw new Error("invalid_user_timing");
  return ms;
}
function minute(value: string, end = false) {
  if (end && value === "24:00") return 1440;
  if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) throw new Error("invalid_user_timing");
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function periods(draft: UserTimingDraft) {
  if (!draft.periods.length || draft.periods.length > 8) throw new Error("invalid_user_timing");
  const rows = draft.periods
    .map((p) => ({ start: minute(p.start), end: minute(p.end, true) }))
    .sort((a, b) => a.start - b.start);
  if (rows.some((p, i) => p.start >= p.end || (i > 0 && rows[i - 1].end > p.start)))
    throw new Error("invalid_user_timing");
  return rows;
}
export function timingPreview(draft: UserTimingDraft, date: string, time: string): boolean {
  const ms = dateValue(date),
    at = minute(time),
    rows = periods(draft);
  // Also reject unknown zones and ambiguous/nonexistent local instants.
  fromLocalInput(date + "T" + time, { kind: "iana", name: draft.timezone });
  const selected =
    draft.mode === "weekly"
      ? draft.days.includes(days[new Date(ms).getUTCDay()])
      : draft.dates.includes(date);
  return selected && rows.some((p) => p.start <= at && at < p.end);
}

/** Convert only an exact single interval: never fill a gap or flatten a recurring rule. */
export function timingValidity(draft: UserTimingDraft): { start: string; end: string } {
  if (draft.mode !== "dates" || !draft.dates.length || draft.dates.length > 64 || draft.days.length)
    throw new Error("user_timing_not_continuous");
  const rows = periods(draft),
    zone = { kind: "iana" as const, name: draft.timezone };
  const dates = [...new Set(draft.dates)].sort();
  if (dates.length !== draft.dates.length) throw new Error("invalid_user_timing");
  const intervals = dates
    .flatMap((date) => {
      const ms = dateValue(date);
      return rows.map((row) => {
        const local = (minutes: number) =>
          new Date(ms + minutes * 60000).toISOString().slice(0, 16);
        const start = fromLocalInput(local(row.start), zone)!;
        const end = fromLocalInput(local(row.end), zone)!;
        if (start >= end || end > "2037-12-31T23:59:59.000Z" || start < "2000-01-01T00:00:00.000Z")
          throw new Error("invalid_validity");
        return { start, end };
      });
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  let end = intervals[0].end;
  for (const interval of intervals.slice(1)) {
    if (interval.start !== end) throw new Error("user_timing_not_continuous");
    end = interval.end;
  }
  return { start: intervals[0].start, end };
}
