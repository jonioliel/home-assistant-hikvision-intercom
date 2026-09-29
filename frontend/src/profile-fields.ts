import type { ProfileField, ProfilePolicy } from "./profile-settings";
export function profileApplicability(
  policy: ProfilePolicy | null | undefined,
  values: Record<string, string>,
): Record<string, boolean | null> {
  const definitions = new Map((policy?.fields ?? []).map((f) => [f.id, f]));
  const result: Record<string, boolean | null> = {};
  const visiting = new Set<string>();
  const evaluate = (id: string): boolean | null => {
    if (Object.hasOwn(result, id)) return result[id];
    const field = definitions.get(id);
    if (!field || visiting.has(id)) return null;
    if (!field.enabled) return (result[id] = false);
    if (field.applicability_unknown) return (result[id] = null);
    visiting.add(id);
    const rule = field.depends_on;
    const parent = rule ? evaluate(rule.field_id) : true;
    result[id] =
      parent === null ? null : parent && (!rule || (values[rule.field_id] ?? "") === rule.value);
    visiting.delete(id);
    return result[id];
  };
  for (const field of definitions.values()) evaluate(field.id);
  return result;
}
export function validProfileValue(field: ProfileField, value: string): boolean {
  if (!value) return !field.required;
  if (field.type === "select") return field.options.includes(value);
  if (field.type === "number") return /^-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,8})?$/.test(value);
  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
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
  const active = profileApplicability(policy, values);
  const priorActive = profileApplicability(policy, previous ?? {});
  for (const field of policy?.fields ?? []) {
    const value = values[field.id] ?? "";
    if (
      active[field.id] !== true ||
      (previous && priorActive[field.id] === true && (previous[field.id] ?? "") === value)
    )
      continue;
    if (!validProfileValue(field, value))
      return value ? "profile_value_invalid" : "profile_required";
  }
  return "";
}
