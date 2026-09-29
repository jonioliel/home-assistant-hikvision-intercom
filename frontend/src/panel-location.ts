/** Embed contract v1. IDs are screen IDs, never device commands or credentials. */
export const embedApiVersion = 1;
export const panelTabIds = [
  "overview",
  "users",
  "devices",
  "events",
  "sync",
  "tools",
  "camera_wall",
] as const;
export const managementToolIds = [
  "clock_options",
  "media_options",
  "whatsapp_templates",
  "profile_options",
  "permission_directory",
  "workflow_center",
  "platform_center",
  "operations_center",
  "investigations",
  "camera_wall",
  "identity_lifecycle",
  "data_quality",
  "access_reviews",
  "access_comparison",
  "guest_templates",
  "visit_requests",
  "fleet_alerts",
  "users",
  "devices",
  "sync",
  "audit",
  "health",
  "schedules",
  "access_control",
] as const;
const screens = new Set<string>([...panelTabIds, ...managementToolIds]);
const tabs = new Set<string>(panelTabIds);
const tools = new Set<string>(managementToolIds);

export interface PanelLocation {
  tab: string;
  tool: string | null;
}

export function knownScreen(value: string): boolean {
  return screens.has(value);
}

/** Existing direct tool IDs also work as tab=; writes always use canonical URLs. */
export function requestedScreen(tab: unknown, tool: unknown): string | null {
  if (typeof tab !== "string" || !screens.has(tab)) return null;
  if (tool != null && tool !== "") {
    if (tab !== "tools" || typeof tool !== "string" || !tools.has(tool)) return null;
    return tool;
  }
  return tab;
}

export function screenLocation(screen: string): PanelLocation {
  return tabs.has(screen) ? { tab: screen, tool: null } : { tab: "tools", tool: screen };
}
