import type { Hass } from "./types";
export interface ApiContract {
  version: number;
  min_client: number;
  capabilities: string[];
  commands: string[];
}
export const CLIENT_API = 1;
export function compatible(contract?: ApiContract): boolean {
  return (
    !contract ||
    (Number.isInteger(contract.version) &&
      Number.isInteger(contract.min_client) &&
      contract.min_client <= CLIENT_API &&
      contract.version >= CLIENT_API)
  );
}
// Unknown commands are treated as writes in a mismatched session. Audio stop/mute
// and capture cancellation must remain available to safely terminate existing work.
const reads = new Set([
  "authorization/session",
  "appearance/settings_get",
  "authorization/settings_get",
  "acceptance/get",
  "audit/export",
  "audit/list",
  "cards/capture_cancel",
  "cards/capture_status",
  "conflicts/list",
  "events/detail",
  "events/export",
  "events/list",
  "events/print",
  "events/report",
  "events/support",
  "events/trace_get",
  "events/trace_stop",
  "health/get",
  "media/settings_get",
  "whatsapp/templates_get",
  "clock/settings_get",
  "clock/host_status",
  "overview",
  "operations/query",
  "permissions/directory",
  "profiles/settings_get",
  "schedules/export",
  "schedules/list",
  "schedules/operations_export",
  "schedules/operations_list",
  "schedules/plan_export",
  "schedules/plan_list",
  "stations/get",
  "stations/inventory",
  "stations/list",
  "sync/diagnostics",
  "sync/status",
  "users/bulk_receipt",
  "users/bulk_receipts",
  "users/csv_export",
  "users/get",
  "users/list",
  "users/query",
  "users/photo_get",
]);
// Connection-owned audio RPCs use audio_api.py, not the management dispatcher.
// Their server handlers authorize the caller and session token and reject extra
// fields. They must not use the management command list or api_contract envelope.
const audioSessionCommands = new Set([
  "audio/send",
  "audio/receive",
  "audio/mute",
  "audio/diagnostics",
  "tts/engines",
  "tts/start",
]);
const cleanup = new Set(["audio/stop", "audio/mute", "cards/capture_cancel", "events/trace_stop"]);
export function contractHass(
  hass: Hass | undefined,
  current: () => ApiContract | undefined,
): Hass | undefined {
  if (!hass) return undefined;
  let elevatedSource = hass.user;
  let elevatedUser = elevatedSource ? { ...elevatedSource, is_admin: true } : undefined;
  return new Proxy(hass, {
    get(target, property, receiver) {
      if (property === "user" && target.user && current()) {
        if (target.user !== elevatedSource) {
          elevatedSource = target.user;
          elevatedUser = { ...target.user, is_admin: true };
        }
        return elevatedUser;
      }
      if (property !== "callWS") return Reflect.get(target, property, receiver);
      return (message: Record<string, unknown>) => {
        const type = String(message.type ?? ""),
          prefix = "hikvision_intercom/";
        if (!type.startsWith(prefix)) return target.callWS(message);
        const command = type.slice(prefix.length),
          policy = current();
        if (!compatible(policy) && !reads.has(command) && !cleanup.has(command))
          return Promise.reject({ code: "api_incompatible" });
        if (
          compatible(policy) &&
          policy?.capabilities.includes("panel_permissions") &&
          !policy.commands.includes(command) &&
          !audioSessionCommands.has(command) &&
          !cleanup.has(command)
        )
          return Promise.reject({ code: "unauthorized" });
        const envelope =
          compatible(policy) &&
          policy?.commands.includes(command) &&
          !audioSessionCommands.has(command)
            ? { ...message, api_contract: CLIENT_API }
            : message;
        return target.callWS(envelope);
      };
    },
  });
}
