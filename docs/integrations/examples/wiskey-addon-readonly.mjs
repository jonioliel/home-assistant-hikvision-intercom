// Read-only WisKey connector smoke test for a Home Assistant add-on backend.
// Run with Node.js 22+ inside the add-on; never expose SUPERVISOR_TOKEN to a browser.
// This example does not implement production reconnect, operator RBAC or writes.

const url = process.env.WISKEY_HA_WS_URL || "ws://supervisor/core/websocket";
const token = process.env.WISKEY_HA_TOKEN || process.env.SUPERVISOR_TOKEN;
if (!token) throw new Error("Set WISKEY_HA_TOKEN or SUPERVISOR_TOKEN in the backend");
if (typeof WebSocket !== "function") throw new Error("Node.js 22+ WebSocket is required");

const socket = new WebSocket(url);
let nextId = 0;
let subscriptionId = null;
const pending = new Map();
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
const timer = setTimeout(() => readyReject(new Error("HA authentication timed out")), 10000);

socket.addEventListener("message", async ({ data }) => {
  let message;
  try {
    message = JSON.parse(String(data));
  } catch {
    return;
  }
  if (message.type === "auth_required") {
    socket.send(JSON.stringify({ type: "auth", access_token: token }));
    return;
  }
  if (message.type === "auth_ok") {
    clearTimeout(timer);
    readyResolve();
    return;
  }
  if (message.type === "auth_invalid") {
    clearTimeout(timer);
    readyReject(new Error("HA rejected the backend credential"));
    return;
  }
  if (message.type === "result" && pending.has(message.id)) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.success) task.resolve(message.result);
    else task.reject(new Error(message.error?.code || "wiskey_request_failed"));
    return;
  }
  if (message.type === "event" && message.id === subscriptionId) {
    if (message.event?.kind === "access_revoked") {
      console.error("WisKey access was revoked; discard all private VMS caches");
      socket.close();
    } else if (message.event?.kind === "refresh") {
      // Production adapter: debounce this, then refetch only active screen data.
      console.log("WisKey data changed; refresh active screen projections");
    }
  }
});
socket.addEventListener("close", () => {
  clearTimeout(timer);
  for (const task of pending.values()) task.reject(new Error("HA socket closed"));
  pending.clear();
});

function call(path, fields = {}) {
  if (socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("HA socket is not open"));
  }
  const id = ++nextId;
  const request = { id, type: "hikvision_intercom/" + path, ...fields };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify(request));
  });
}

await ready;
const session = await call("authorization/session");
if (!session.allowed) throw new Error("This HA identity has no WisKey access");
const overview = await call("overview");
if (!overview.api || overview.api.version < 1 || overview.api.min_client > 1) {
  throw new Error("Unsupported WisKey panel contract");
}
console.log({
  wiskeyVersion: overview.version,
  stationCount: overview.stations.length,
  personCount: overview.user_count,
  accessAreas: session.areas,
  allowedCommandCount: overview.api.commands.length,
});
subscriptionId = nextId + 1;
await call("subscribe");
console.log("Read-only WisKey subscription is active");
