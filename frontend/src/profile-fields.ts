import type { ProfileField, ProfilePolicy } from "./profile-settings";
export function validProfileValue(field: ProfileField, value: string): boolean {
  if (!value) return !field.required;
  if (field.type === "select") return field.options.includes(value);
  if (field.type === "number") return /^-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,8})?$/.test(value);
  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const day = new Date(value + "T00:00:00Z");
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
  }
  return true;
}
export function profileError(
  policy: ProfilePolicy | null | undefined,
  values: Record<string, string>,
  previous?: Record<string, string>,
): string {
  for (const field of policy?.fields ?? []) {
    const value = values[field.id] ?? "";
    if (!field.enabled || (previous && (previous[field.id] ?? "") === value)) continue;
    if (!validProfileValue(field, value))
      return value ? "profile_value_invalid" : "profile_required";
  }
  return "";
}
