import type { Person } from "./types";
export interface UserFilters {
  station: string;
  rights: string;
  state: string;
  credential: string;
  sort: string;
}
export const defaultFilters = (): UserFilters => ({
  station: "",
  rights: "",
  state: "",
  credential: "",
  sort: "employee",
});
export function matchingUsers(
  users: Person[],
  query: string,
  filters: UserFilters,
  now = Date.now(),
) {
  const text = query.trim().toLocaleLowerCase();
  return users
    .filter((u) => {
      if (
        text &&
        !`${u.display_name} ${u.employee_no}`.toLocaleLowerCase().includes(text) &&
        !(/^[0-9]{4}$/.test(text) && u.cards.some((card) => card.masked_number?.slice(-4) === text))
      )
        return false;
      const assignments = filters.station
        ? [u.assignments[filters.station]].filter(Boolean)
        : Object.values(u.assignments);
      if (filters.station && !filters.rights && !assignments.length) return false;
      if (filters.rights === "assigned" && !assignments.some((a) => a.enabled)) return false;
      if (filters.rights === "unassigned" && assignments.length) return false;
      if (filters.rights === "disabled" && !assignments.some((a) => !a.enabled)) return false;
      if ((filters.state === "active" && !u.active) || (filters.state === "inactive" && u.active))
        return false;
      if (filters.state === "expired" && (!u.valid_until || Date.parse(u.valid_until) > now))
        return false;
      if (filters.state === "upcoming" && (!u.valid_from || Date.parse(u.valid_from) <= now))
        return false;
      const hasCard = u.cards.some((c) => c.enabled);
      if (
        (filters.credential === "pin" && !u.pin_configured) ||
        (filters.credential === "no_pin" && u.pin_configured) ||
        (filters.credential === "card" && !hasCard) ||
        (filters.credential === "no_card" && hasCard)
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const compared =
        filters.sort === "employee"
          ? a.employee_no.localeCompare(b.employee_no, undefined, { numeric: true })
          : a.display_name.localeCompare(b.display_name);
      return (filters.sort === "name_desc" ? -compared : compared) || a.id.localeCompare(b.id);
    });
}
