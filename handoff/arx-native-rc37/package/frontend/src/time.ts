export type DisplayZone =
  | { kind: "iana"; name: string }
  | {
      kind: "device";
      name: string;
      standard: number;
      delta: number;
      start: number[] | null;
      end: number[] | null;
    };
export const UTC_ZONE: DisplayZone = { kind: "iana", name: "UTC" };
const formatters = new Map<string, Intl.DateTimeFormat>();
function transition(year: number, rule: number[], offset: number) {
  const [month, week, weekday, second] = rule;
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let day = 1 + ((weekday - first + 7) % 7) + (week - 1) * 7;
  if (day > count) day -= 7;
  return Date.UTC(year, month - 1, day) + (second - offset) * 1000;
}
export function offsetAt(ms: number, zone: DisplayZone): number {
  if (zone.kind === "iana") {
    let formatter = formatters.get(zone.name);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: zone.name,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      formatters.set(zone.name, formatter);
    }
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
    );
    return (
      (Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      ) -
        Math.floor(ms / 1000) * 1000) /
      1000
    );
  }
  if (zone.delta && zone.start && zone.end) {
    const y = new Date(ms).getUTCFullYear();
    for (let year = y - 1; year <= y + 1; year++) {
      const start = transition(year, zone.start, zone.standard);
      let end = transition(year, zone.end, zone.standard + zone.delta);
      if (end <= start) end = transition(year + 1, zone.end, zone.standard + zone.delta);
      if (ms >= start && ms < end) return zone.standard + zone.delta;
    }
  }
  return zone.standard;
}
export function offsetLabel(offset: number) {
  const seconds = Math.abs(offset);
  return `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}${seconds % 60 ? ":" + String(seconds % 60).padStart(2, "0") : ""}`;
}
export function formatTime(
  value: string | null | undefined,
  locale: string | undefined,
  zone: DisplayZone = UTC_ZONE,
) {
  if (!value || !/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  try {
    const offset = offsetAt(ms, zone);
    return (
      new Date(ms + offset * 1000).toLocaleString(locale, { timeZone: "UTC" }) +
      " · " +
      offsetLabel(offset)
    );
  } catch {
    return new Date(ms).toISOString() + " · UTC";
  }
}
export function localInput(value: string | null, zone: DisplayZone = UTC_ZONE) {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + offsetAt(ms, zone) * 1000).toISOString().slice(0, 16);
}
export function fromLocalInput(value: string, zone: DisplayZone = UTC_ZONE): string | null {
  if (!value) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(value))
    throw new Error("clock_invalid_local");
  const naive = Date.parse(value + ":00Z");
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value)
    throw new Error("clock_invalid_local");
  const offsets = new Set(
    [-172800, -86400, 0, 86400, 172800].map((delta) => offsetAt(naive + delta * 1000, zone)),
  );
  const candidates = [...offsets]
    .map((offset) => new Date(naive - offset * 1000).toISOString())
    .filter((candidate) => localInput(candidate, zone) === value);
  if (candidates.length !== 1)
    throw new Error(candidates.length ? "clock_ambiguous" : "clock_nonexistent");
  return candidates[0];
}

/** Keep a known instant (including a DST fold) when its displayed input is unchanged. */
export function resolveLocalInput(
  value: string,
  zone: DisplayZone,
  known?: unknown,
): string | null {
  if (typeof known === "string" && localInput(known, zone) === value) return known;
  return fromLocalInput(value, zone);
}
