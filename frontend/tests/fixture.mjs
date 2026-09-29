import "/panel.js";
const query = new URLSearchParams(location.search);
const hebrew = query.get("lang") === "he";
if (query.has("dark")) document.body.classList.add("dark");
const names = hebrew
  ? [
      "שער ראשי",
      "כניסת לובי",
      "חניון צפוני",
      "כניסת משרד",
      "מחסן",
      "שער שירות",
      "בניין ב׳",
      "כניסת צוות",
      "כניסה אחורית",
    ]
  : [
      "Main gate",
      "Lobby entrance",
      "North parking",
      "Office entrance",
      "Warehouse",
      "Service gate",
      "Building B",
      "Staff entrance",
      "Rear entrance",
    ];
const photos = {};
function groupAccess(user) {
  if (!user.permission_overrides) return;
  const ids = new Set(
    data.profile_settings.groups
      .filter((g) => g.enabled && user.group_ids?.includes(g.id))
      .flatMap((g) => g.station_ids ?? []),
  );
  for (const [id, mode] of Object.entries(user.permission_overrides)) {
    if (mode === "allow") ids.add(id);
    else ids.delete(id);
  }
  user.assignments = Object.fromEntries(
    [...ids].map((id) => [id, { enabled: true, allowed_locks: [1], sync_state: "pending" }]),
  );
}
const fullAreas = {
  overview: "manage",
  users: "manage",
  events: "manage",
  stations: "manage",
  management: "manage",
};
const noAreas = {
  overview: "none",
  users: "none",
  events: "none",
  stations: "none",
  management: "none",
};
const delegatedAreas = { ...noAreas };
for (const grant of (query.get("grant") ?? "").split(",").filter(Boolean)) {
  const [area, level] = grant.split(":");
  if (area in delegatedAreas && ["view", "manage"].includes(level)) delegatedAreas[area] = level;
}
const delegated = Object.values(delegatedAreas).some((level) => level !== "none");
const access = query.has("reader")
  ? { allowed: delegated, is_admin: false, revision: 0, areas: delegatedAreas }
  : { allowed: true, is_admin: true, revision: 0, areas: fullAreas };
const data = {
  access,
  user_count: 0,
  profile_settings: { revision: 0, fields: [], groups: [], photo_enabled: false },
  media_settings: {
    revision: 0,
    transport: "webrtc",
    webrtc_mode: "rtc",
    fallback_hls: true,
    go2rtc_url: "",
  },
  appearance_settings: { revision: 0, default: "current", accent: "green" },
  api: query.has("paged")
    ? {
        version: 1,
        min_client: 0,
        capabilities: ["user_timing_draft", "panel_permissions", "user_directory_query"],
        commands: [
          "overview",
          "users/query",
          "support/bundle",
          "fleet/inventory_export",
          "upgrade/readiness",
        ],
      }
    : {
        version: 1,
        min_client: 0,
        capabilities: ["user_timing_draft", "operational_readiness"],
        commands: ["support/bundle", "fleet/inventory_export", "upgrade/readiness"],
      },
  default_zone: { kind: "iana", name: "UTC" },
  version: "0.33.0-beta.1",
  users: [],
  stations: names.map((name, i) => ({
    id: `station-${i}`,
    clock: {
      source: "device",
      zone: { kind: "iana", name: "UTC" },
      device_zone: { kind: "iana", name: "UTC" },
      device_time: "2026-09-08T12:00:00Z",
      checked_at: "2026-09-08T12:00:00Z",
      status: "ready",
      error: null,
      skew_seconds: 0,
      time_mode: "NTP",
    },
    name,
    lock_enabled: i !== 8,
    loaded: true,
    online: i !== 5,
    call_state: i === 0 ? "ringing" : i === 5 ? "unavailable" : "idle",
    sync_state: i === 5 ? "offline" : i === 2 ? "conflict" : "synced",
    last_error: i === 5 ? "connection_failed" : null,
    scanned_at: new Date().toISOString(),
    scanning: false,
    scan_error: null,
    observations: {
      call_status: true,
      snapshot: true,
      video_channel: true,
      user_info: true,
      card_info: true,
      event_query: i !== 5,
    },
    integrated_locks: i === 8 ? [] : [{ physical_index: 1, api_id: 1 }],
    event_status: {
      stream: i === 5 ? "disconnected" : "connected",
      history: i === 5 ? "incomplete" : "recovered",
      reconnects: 0,
      recovered_until: "2026-09-08T12:30:00Z",
    },
    reconciled_at: i === 5 ? null : new Date().toISOString(),
    managed_user_count: 6,
    pending_user_count: i === 5 ? 2 : i === 2 ? 1 : 0,
    last_seen: "2026-09-08T12:30:00Z",
    last_poll_ms: 18.4,
    last_access:
      i === 0
        ? {
            timestamp: "2026-09-08T12:15:00Z",
            time_source: "device",
            person_name: "Dana",
            employee_no: "42",
            authentication: "card",
            result: "granted",
            event_type: "access_granted",
            recovered: true,
            door: 1,
          }
        : null,
    user_count: 18 + i,
    card_count: 23 + i,
    unmanaged_count: i === 0 ? 1 : 0,
    model: "DS-KV6124-E1",
    firmware: "V3.9.0",
    host: `192.0.2.${10 + i}`,
    entities: { camera: `camera.station_${i}`, ...(i !== 8 ? { lock: `lock.station_${i}` } : {}) },
    capabilities: {
      max_users: 2000,
      max_cards: 6000,
      cards_per_person: 5,
      pin_writable: true,
      pin_min: 4,
      pin_max: 8,
      name_max: 32,
      schedules: false,
    },
  })),
  tombstones: [],
  revocations: [],
  card_removals: [],
  pin_removals: [],
};
if (query.has("summary")) {
  data.api.capabilities.push("overview_summary");
  data.api.commands.push("overview/summary", "sync/status", "users/list", "users/get");
}
const people = hebrew
  ? ["אור לוי", "דנה כהן", "יובל ברק", "נועה ישראלי", "צוות אחזקה", "אורח זמני"]
  : ["Or Levy", "Dana Cohen", "Yuval Barak", "Noa Israeli", "Maintenance", "Temporary guest"];
people.forEach((name, index) =>
  data.users.push({
    id: `person-${index}`,
    employee_no: `100${index}`,
    display_name: name,
    active: index !== 3,
    pin_configured: index % 2 === 0,
    cards:
      index === 4
        ? []
        : [
            {
              id: `card-${index}`,
              masked_number: `•••• ${4821 + index}`,
              label: hebrew ? "כרטיס ראשי" : "Main card",
              card_type: "normalCard",
              enabled: true,
            },
          ],
    assignments: Object.fromEntries(
      data.stations.slice(0, index + 2).map((station, i) => [
        station.id,
        {
          enabled: true,
          allowed_locks: [1],
          sync_state: i === 2 && index === 1 ? "conflict" : station.online ? "synced" : "offline",
          last_error: i === 2 && index === 1 ? "device_changed" : null,
          desired_revision: 1,
          applied_revision: station.online ? 1 : null,
        },
      ]),
    ),
    revision: 1,
    identity_locked: true,
    valid_from: null,
    valid_until: null,
  }),
);
if (query.has("operations")) {
  data.api = {
    version: 1,
    min_client: 0,
    capabilities: ["user_timing_draft", "panel_permissions", "operations_query"],
    commands: ["overview", "operations/query", "sync/user", "sync/station", "users/get"],
  };
  data.sync_operations = [
    {
      id: "sync-ok",
      user_id: "person-0",
      station_id: "station-0",
      state: "verified",
      queued_at: "2026-09-22T10:00:00Z",
      updated_at: "2026-09-22T10:01:00Z",
      verified_at: "2026-09-22T10:01:00Z",
    },
    {
      id: "sync-failed",
      user_id: "person-1",
      station_id: "station-1",
      state: "failed",
      queued_at: "2026-09-22T10:00:00Z",
      updated_at: "2026-09-22T10:02:00Z",
      verified_at: null,
    },
  ];
}
if (query.has("lifecycle")) {
  data.api = {
    version: 1,
    min_client: 0,
    capabilities: ["user_timing_draft", "panel_permissions", "identity_lifecycle"],
    commands: [
      "overview",
      "users/get",
      "users/lifecycle",
      "users/duplicate_check",
      "users/create",
      "users/update",
      ...(!query.has("legacy-cancellation") ? ["users/temporary_cancel"] : []),
      "support/bundle",
    ],
  };
  data.users[1].valid_until = "2026-10-01T12:00:00Z";
  data.users[4].pin_configured = false;
  data.users[4].cards = [];
  if (query.has("temporary")) {
    data.default_zone = { kind: "iana", name: "Asia/Jerusalem" };
    for (const index of [0, 1, 3, 5]) {
      Object.assign(data.users[index], {
        access_category: index % 2 ? "contractor" : "visitor",
        responsible_person: hebrew ? "מנהל אחזקה" : "Facilities manager",
        access_purpose: hebrew ? "תחזוקה" : "Maintenance visit",
        valid_from: "2026-09-20T09:00:00Z",
        valid_until: "2026-09-25T09:00:00Z",
      });
    }
    data.users[1].valid_until = "2026-09-23T09:00:00Z";
    data.users[5].valid_from = "2026-09-24T09:00:00Z";
  }
}
if (query.has("legacy-api")) {
  data.api.commands = data.api.commands.filter(
    (command) =>
      !["support/bundle", "fleet/inventory_export", "upgrade/readiness"].includes(command),
  );
}
if (query.has("paged")) {
  for (let index = data.users.length; index < 126; index++) {
    data.users.push({
      ...structuredClone(data.users[index % 6]),
      id: `scale-person-${index}`,
      employee_no: String(2000 + index),
      display_name: `Scale Person ${index}`,
      phone: `050${String(index).padStart(7, "0")}`,
      revision: 1,
    });
  }
}
data.user_count = data.users.length;
if (query.has("people-archive")) {
  data.api.capabilities.push("people_archive", "user_directory_query");
  data.api.commands.push("users/query", "users/archive", "users/unarchive");
}
if (query.has("guest-templates")) {
  data.api.capabilities.push("guest_visit_templates", "user_timing_enforcement");
  data.api.commands.push("guest_templates/get", "guest_templates/upsert", "guest_templates/delete");
}
const guestTemplates = {
  revision: 0,
  items: query.has("guest-templates")
    ? [
        {
          id: "a".repeat(32),
          label: hebrew ? "תחזוקת שבוע" : "Weekly maintenance",
          access_category: "contractor",
          responsible_person: hebrew ? "מנהל אחזקה" : "Facilities",
          access_purpose: hebrew ? "ביקורת" : "Inspection",
          duration_minutes: 180,
          doors: { "station-0": [1], "station-1": [1] },
          weekly_timing: {
            mode: "weekly",
            timezone: "Asia/Jerusalem",
            days: ["Monday", "Thursday"],
            dates: [],
            periods: [{ start: "12:00", end: "18:00" }],
          },
          updated_at: "2026-09-28T00:00:00Z",
          updated_by: "admin",
        },
      ]
    : [],
};
window.guestTemplates = guestTemplates;
if (query.has("visits")) {
  data.api.capabilities.push("visit_host_approval");
  data.api.commands.push(
    "visits/operators",
    "visits/list",
    "visits/create",
    "visits/request",
    "visits/decide",
  );
  Object.assign(data.users[3], {
    access_category: "visitor",
    responsible_person: "Reception",
    access_purpose: "Inspection",
    valid_from: new Date().toISOString(),
    valid_until: new Date(Date.now() + 86400000).toISOString(),
  });
}
function visitSnapshot(user) {
  return {
    display_name: user.display_name,
    employee_no: user.employee_no,
    access_category: user.access_category,
    responsible_person: user.responsible_person,
    access_purpose: user.access_purpose,
    valid_from: user.valid_from,
    valid_until: user.valid_until,
    pin_configured: user.pin_configured,
    enabled_cards: user.cards.filter((card) => card.enabled).length,
    doors: Object.fromEntries(
      Object.entries(user.assignments)
        .filter(([, item]) => item.enabled)
        .map(([id, item]) => [id, item.allowed_locks]),
    ),
    timing_schedule: user.access_timing_policy?.schedule ?? null,
  };
}
const visitRequests = {
  revision: query.has("visits") ? 1 : 0,
  items: query.has("visits")
    ? [
        {
          id: "visit-1",
          user_id: data.users[3].id,
          user_revision: 1,
          revision: 1,
          approver_id: "demo-admin",
          requested_by: "demo-host",
          requested_at: new Date().toISOString(),
          status: "pending",
          decided_by: "",
          decided_at: null,
          snapshot: visitSnapshot(data.users[3]),
          stale: false,
          user_deleted: false,
        },
      ]
    : [],
};
window.visitRequests = visitRequests;
if (query.has("fleet-alerts")) {
  data.api.capabilities.push("fleet_triage_alerts");
  data.api.commands.push("fleet/alerts", "fleet/alerts_action");
}
const fleetAlerts = {
  revision: 0,
  suppressions: [],
  items: [
    {
      id: "station-0/sync_conflict",
      station_id: "station-0",
      station_name: names[0],
      kind: "sync_conflict",
      severity: "error",
      observed_since: new Date(Date.now() - 3600000).toISOString(),
      observed_seconds: 3600,
      suppressed: false,
      suppression: null,
    },
    {
      id: "station-1/event_gap",
      station_id: "station-1",
      station_name: names[1],
      kind: "event_gap",
      severity: "warning",
      observed_since: new Date(Date.now() - 1800000).toISOString(),
      observed_seconds: 1800,
      suppressed: false,
      suppression: null,
    },
  ],
};
window.fleetAlerts = fleetAlerts;
if (query.has("investigations")) {
  data.api.capabilities.push("investigation_timeline");
  data.api.commands.push("investigations/query");
}
const investigationRows = ["access", "sync", "change"].map((source, i) => ({
  id: `${source}/example`,
  source,
  time: new Date(Date.now() - i * 60000).toISOString(),
  received_at: source === "access" ? new Date().toISOString() : null,
  time_source: source === "access" ? "device" : "system",
  user_id: data.users[0].id,
  person_name: data.users[0].display_name,
  employee_no: data.users[0].employee_no,
  station_ids: ["station-0"],
  action:
    source === "access"
      ? "access_granted"
      : source === "sync"
        ? "sync/user_station"
        : "users/update",
  status: source === "access" ? "granted" : source === "sync" ? "verified" : "saved",
  actor: source === "change" ? "demo-admin" : null,
  evidence:
    source === "access"
      ? "device_event"
      : source === "sync"
        ? "device_readback"
        : "desired_state_saved",
  details:
    source === "access"
      ? {
          authentication: "pin",
          door: 1,
          identity_basis: "observed_station_owner",
          recovered: false,
        }
      : source === "change"
        ? { fields: ["assignments"], revision_before: 1, revision_after: 2 }
        : { queued_at: new Date().toISOString(), verified_at: new Date().toISOString() },
}));
window.investigationRows = investigationRows;
window.investigationRevision = 0;
if (query.has("empty")) {
  data.users = [];
  data.stations = [];
}
const captures = new Map();
const callbacks = new Set();
window.demoNotify = () => callbacks.forEach((callback) => callback({ kind: "refresh" }));
window.calls = [];
const schedules = [];
const scheduleBaselines = new Map();
const deploymentPlans = [];
window.demoPlans = deploymentPlans;
const operations = { claims: [], jobs: [], archive: [], journal: [], writes_enabled: false };
window.demoOperations = operations;
let claimPreview;
let deploymentPreview;
let scheduleImport;
window.demoBaselineChange = false;
window.demoSchedules = schedules;
if (query.has("shared-accent"))
  data.appearance_settings = { revision: 1, default: "wiskey-dark", accent: "purple" };
const platformCommands = [
  "get",
  "capacity",
  "save",
  "delete",
  "config_read",
  "config_preview",
  "config_apply",
  "maintenance_preview",
  "maintenance_enqueue",
  "maintenance_jobs",
  "maintenance_plan",
  "maintenance_decide",
  "maintenance_cancel",
  "retention_preview",
  "retention_apply",
  "archive",
  "report",
  "export",
  "import_preview",
  "import_apply",
  "webhook_save",
  "webhook_key",
  "integrity",
  "demo",
];
if (query.has("platform"))
  data.api.commands.push("users/get", ...platformCommands.map((c) => "platform/" + c));
window.platformData = {
  revision: 0,
  stations: {},
  templates: {},
  door_presets: {},
  capabilities: [
    "fleet_door_presets",
    ...(query.has("maintenance") ? ["fleet_maintenance_queue"] : []),
    ...(query.has("capacity-trends") ? ["fleet_capacity_trends"] : []),
  ],
  views: {},
  reports: {},
  journal: [],
  observations: [],
  receipts: [],
  report_runs: [],
  webhook: { enabled: false, url: "", kinds: [] },
  catalog: Object.fromEntries(data.stations.map((s) => [s.id, s.name])),
  event_usage: {
    records: 100,
    bytes: 65536,
    days: 30,
    count_limit: 5000,
    byte_limit: 16777216,
    count_horizon_days: 40,
  },
};
window.maintenanceJobs = [];
let maintenanceReview;
const workflowCommands = [
  "workflows/get",
  "backups/export",
  "backups/preview",
  "backups/apply",
  "workflows/settings_update",
  "workflows/inventory_save",
  "workflows/inventory_issue",
  "workflows/inventory_return",
  "workflows/template_save",
  "workflows/template_delete",
  "workflows/renew_request",
  "jobs/list",
  "jobs/action",
];
if (query.has("workflows")) data.api.commands.push(...workflowCommands);
window.workflowData = {
  settings: { revision: 0, idle_minutes: 0, reauth_sensitive: false, dual_approval: false },
  approvals: [],
  transfers: [],
  inventory: [],
  templates: [],
  reminders: [],
  renewals: [],
};
window.demoData = data;
const fake = {
  language: hebrew ? "he" : "en",
  user: { id: "demo-admin", is_admin: !query.has("reader") },
  themes: { darkMode: query.has("dark") },
  states: Object.fromEntries(
    data.stations.map((station, i) => [
      station.entities.camera,
      {
        state: "idle",
        attributes: {
          entity_picture: `/api/camera_proxy/camera.station_${i}?token=synthetic-only`,
        },
      },
    ]),
  ),
  connection: {
    async subscribeMessage(callback, message = {}) {
      if (message.type === "hikvision_intercom/tts/start") {
        window.calls.push(structuredClone(message));
        window.tts ??= { starts: 0, stops: 0 };
        window.tts.starts++;
        let cancelled = false;
        queueMicrotask(() => {
          if (!cancelled) callback({ state: "generating", format: "hikvision_intercom.tts" });
        });
        setTimeout(() => {
          if (!cancelled)
            callback({
              state: "speaking",
              format: "hikvision_intercom.tts",
              duration_seconds: 1.2,
            });
        }, 1000);
        setTimeout(() => {
          if (!cancelled)
            callback({
              state: "completed",
              format: "hikvision_intercom.tts",
              duration_seconds: 1.2,
              bytes_written: 9600,
            });
        }, 2500);
        return () => {
          cancelled = true;
          window.tts.stops++;
        };
      }
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  },
  async callWS(message) {
    window.calls.push(structuredClone(message));
    const command = message.type.replace("hikvision_intercom/", "");
    if (query.has("platform") && command.startsWith("platform/")) {
      const state = window.platformData;
      const route = command.slice(9);
      if (route === "get") return structuredClone(state);
      if (route === "save") {
        const id = message.record_id || "saved-" + state.revision;
        state[message.collection][id] = {
          actor: this.user.id,
          values: structuredClone(message.values),
        };
        state.revision++;
        return { id, revision: state.revision };
      }
      if (route === "delete") {
        delete state[message.collection][message.record_id];
        state.revision++;
        return { revision: state.revision };
      }
      if (route === "capacity")
        return {
          records: [
            {
              station_id: "station-0",
              name: "Main gate",
              sampled_at: "2026-09-29T02:00:00Z",
              fresh: true,
              sample_count: 3,
              sample_span_days: 2,
              users: {
                count: 80,
                advertised_limit: 100,
                used_percent: 80,
                remaining: 20,
                observed_growth_per_day: 10,
                estimated_days_to_limit: 2,
                alert: "near_limit",
              },
              cards: {
                count: 100,
                advertised_limit: null,
                used_percent: null,
                remaining: null,
                observed_growth_per_day: null,
                estimated_days_to_limit: null,
                alert: "unknown",
              },
            },
          ],
        };
      if (route === "maintenance_jobs") return { records: structuredClone(window.maintenanceJobs) };
      if (route === "maintenance_preview") {
        maintenanceReview = {
          review_id: "maintenance-review",
          queue_count: message.station_ids.length,
          rows: message.station_ids.map((id) => ({
            station_id: id,
            name: state.catalog[id],
            before: { openDuration: 5 },
            after: { openDuration: 5, ...message.changes },
            window: {
              enabled: true,
              days: [0, 3],
              start: "08:00",
              end: "18:00",
              timezone: "Asia/Jerusalem",
            },
            error: null,
          })),
        };
        return structuredClone(maintenanceReview);
      }
      if (route === "maintenance_enqueue") {
        const job = {
          id: "queued-plan",
          fingerprint: "reviewed-fingerprint",
          actor: this.user.id,
          own_request: true,
          state: "queued",
          created_at: "2026-09-29T02:00:00Z",
          expires_at: "2026-10-07T02:00:00Z",
          consent: null,
          rows: maintenanceReview.rows.map((r) => ({ ...r, state: "pending" })),
        };
        window.maintenanceJobs.push(job);
        return { job_id: job.id, state: job.state };
      }
      if (route === "maintenance_cancel") {
        window.maintenanceJobs.find((j) => j.id === message.job_id).state = "cancelled";
        return { records: structuredClone(window.maintenanceJobs) };
      }
      if (route === "maintenance_decide") {
        window.maintenanceJobs.find((j) => j.id === message.job_id).state = message.approve
          ? "queued"
          : "rejected";
        return { records: structuredClone(window.maintenanceJobs) };
      }
      if (route === "config_read")
        return {
          rows: message.station_ids.map((id) => ({
            station_id: id,
            name: state.catalog[id],
            configuration: {
              door: message.door,
              values: { openDuration: 5 },
              constraints: { openDuration: { type: "integer", min: 1, max: 255 } },
            },
          })),
        };
      if (route === "config_preview")
        return {
          review_id: "config-review",
          rows: message.station_ids.map((id) => ({
            station_id: id,
            name: state.catalog[id],
            before: { openDuration: 5 },
            after: message.changes,
            error: null,
          })),
          apply_count: message.station_ids.length,
        };
      if (route === "config_apply") {
        state.receipts = [
          {
            at: "2026-09-28T12:00:00Z",
            station_id: "station-0",
            state: "failed",
            code: "device_unavailable",
          },
          { at: "2026-09-28T12:00:00Z", station_id: "station-1", state: "verified", code: "" },
        ];
        return { receipts: state.receipts };
      }
      if (route === "retention_preview")
        return {
          review_id: "retention-review",
          before: 100,
          after: 90,
          removed: 10,
          values: message.values,
        };
      if (route === "retention_apply") {
        state.event_usage.days = 7;
        state.event_usage.records = 90;
        state.revision++;
        return state.event_usage;
      }
      if (route === "archive")
        return {
          body: { format: "smplwise-event-archive", records: [] },
          algorithm: "Ed25519",
          signature: "synthetic",
          public_key: "synthetic",
        };
      if (route === "report")
        return {
          totals: { records: 1, granted: 1, denied: 0 },
          csv: "timestamp,station\n2026-09-28,Demo\n",
          print_records: [
            {
              display_timestamp: "2026-09-28T12:00:00Z",
              station: "Main gate",
              person_name: "Report person",
              result: "granted",
            },
          ],
        };
      if (route === "export")
        return { format: "smplwise-operations", version: 1, stations: {}, templates: [] };
      if (route === "import_preview") {
        const file = JSON.parse(message.content);
        if (Object.keys(file.stations).some((id) => !message.mapping[id]))
          throw { code: "station_mapping_required" };
        return {
          review_id: "import-review",
          stations: Object.entries(file.stations).map(([id, row]) => ({
            source: id,
            name: row.name,
            target: message.mapping[id],
            replaces: false,
          })),
          templates: file.templates.length,
        };
      }
      if (route === "import_apply") {
        state.revision++;
        return { revision: state.revision };
      }
      if (route === "webhook_save") {
        state.webhook = structuredClone(message.values);
        state.revision++;
        return { revision: state.revision };
      }
      if (route === "webhook_key") return { key: "synthetic signing key" };
      if (route === "integrity")
        return {
          checks: [{ component: "access", state: "available", remedy: "none" }],
          writes_performed: false,
        };
      if (route === "demo")
        return { demo: true, stations: [{ name: "Demo station", online: true }], device_writes: 0 };
    }
    if (query.has("workflows")) {
      const center = window.workflowData;
      if (command === "workflows/get") return structuredClone(center);
      if (command === "jobs/list") return { records: [] };
      if (command === "backups/export")
        return {
          filename: "demo.encrypted.json",
          content: JSON.stringify({
            format: "smplwise-access",
            version: 1,
            data: "encrypted-test-data",
          }),
        };
      if (command === "backups/preview")
        return {
          review_id: "backup-review",
          changed: 1,
          errors: 0,
          rows: [{ name: "Restored person", employee_no: "1001", action: "create", error: null }],
        };
      if (command === "backups/apply") return { saved: 1 };
      if (command === "workflows/settings_update") {
        center.settings = { ...message.values, revision: center.settings.revision + 1 };
        return structuredClone(center.settings);
      }
      if (command === "workflows/inventory_save") {
        let item = center.inventory.find((item) => item.id === message.card_id);
        if (!item) {
          item = {
            id: "inventory-" + center.inventory.length,
            revision: 0,
            holder: null,
            holder_id: null,
            masked_number: "•••• " + message.values.card_no.slice(-4),
          };
          center.inventory.push(item);
        }
        Object.assign(item, {
          label: message.values.label,
          status: message.values.status,
          return_by: message.values.return_by,
          revision: item.revision + 1,
        });
        return structuredClone(item);
      }
      if (command === "workflows/template_save") {
        const item = {
          ...message.values,
          id: message.template_id || "staff-preset",
          revision: message.revision + 1,
        };
        center.templates = [...center.templates.filter((t) => t.id !== item.id), item];
        return structuredClone(item);
      }
      if (command === "workflows/template_delete") {
        center.templates = center.templates.filter((t) => t.id !== message.template_id);
        return { deleted: true };
      }
      if (command === "workflows/renew_request") {
        center.renewals.push({
          id: "renew",
          name: "Renewed",
          actor: "demo-admin",
          until: message.until,
          reason: message.reason,
          state: "pending",
        });
        return { id: "renew", state: "pending" };
      }
    }

    if (command === "investigations/query") {
      if (window.investigationDelay)
        await new Promise((resolve) => setTimeout(resolve, window.investigationDelay));
      const filters = message.filters;
      const rows = window.investigationRows.filter(
        (row) =>
          (!filters.user_id || row.user_id === filters.user_id) &&
          (!filters.station_id || row.station_ids.includes(filters.station_id)) &&
          (!filters.source || filters.source === "all" || row.source === filters.source) &&
          (!filters.query || row.person_name.toLowerCase().includes(filters.query.toLowerCase())),
      );
      const snapshot = "investigation-" + window.investigationRevision;
      return structuredClone({
        records: rows.slice(message.offset, message.offset + message.limit),
        total: rows.length,
        offset: message.offset,
        limit: message.limit,
        next_offset:
          message.offset + message.limit < rows.length ? message.offset + message.limit : null,
        previous_offset: message.offset ? Math.max(0, message.offset - message.limit) : null,
        snapshot,
        stale: !!message.snapshot && message.snapshot !== snapshot,
        summary: Object.fromEntries(
          ["access", "change", "sync"].map((source) => [
            source,
            rows.filter((row) => row.source === source).length,
          ]),
        ),
        sources: { access_available: true, access_storage_failed: false },
        actors: { "demo-admin": "System administrator" },
      });
    }
    if (command === "authorization/session")
      return structuredClone(
        this?.user?.is_admin === false && !query.has("reader")
          ? { allowed: false, is_admin: false, revision: 0, areas: noAreas }
          : access,
      );
    if (command === "authorization/settings_get")
      return {
        revision: 0,
        stations: data.stations.map(({ id, name }) => ({ id, name })),
        fields: ["phone", "photo", "credentials", "profile", "access"],
        areas: Object.keys(fullAreas),
        levels: ["none", "view", "manage"],
        users: {},
        directory: [
          { id: "demo-admin", name: "Demo administrator", active: true, admin: true, owner: true },
          { id: "reader-user", name: "Reception", active: true, admin: false, owner: false },
        ],
      };
    if (command === "authorization/preview") {
      const policy = message.policy;
      const has = (area, manage = false) =>
        policy.enabled &&
        (policy.station_ids == null || policy.station_ids.length > 0) &&
        (policy.areas[area] === "manage" || (!manage && policy.areas[area] === "view"));
      const restricted =
        policy.station_ids != null ||
        Object.values(policy.fields ?? {}).some((level) => level !== "manage");
      return {
        enabled: policy.enabled,
        actions: {
          door_unlock: has("overview", true) || has("stations", true),
          station_view: has("stations"),
          station_settings: has("stations", true),
          station_maintenance: has("stations", true),
          station_clock: has("management", true),
          tts_broadcast: has("overview", true) || has("stations", true),
          people_view: has("users"),
          people_edit: has("users", true),
          card_capture: has("users", true) && (policy.fields?.credentials ?? "manage") === "manage",
          people_export: has("users") && !restricted,
          whatsapp_send: has("users", true) && !restricted,
          events_view: has("events"),
          events_export: has("events"),
          event_capture:
            has("events", true) &&
            Object.values(policy.fields ?? {}).every((level) => level === "manage"),
          system_settings: has("management", true) && !restricted,
        },
      };
    }
    if (command === "authorization/settings_update")
      return {
        revision: message.revision + 1,
        stations: data.stations.map(({ id, name }) => ({ id, name })),
        fields: ["phone", "photo", "credentials", "profile", "access"],
        areas: Object.keys(fullAreas),
        levels: ["none", "view", "manage"],
        users: structuredClone(message.users),
        directory: [
          { id: "demo-admin", name: "Demo administrator", active: true, admin: true, owner: true },
          { id: "reader-user", name: "Reception", active: true, admin: false, owner: false },
        ],
      };
    if (command === "profiles/settings_get") return structuredClone(data.profile_settings);
    if (command === "users/pin_check") return { available: true };
    if (command === "users/pin_generate") return { pin: "482615" };
    if (command === "profiles/settings_preview") {
      if (message.revision !== data.profile_settings.revision) throw { code: "revision_conflict" };
      const groups = message.values.groups;
      const changed = groups.filter((g) => {
        const old = data.profile_settings.groups.find((x) => x.id === g.id) ?? {
          enabled: true,
          station_ids: [],
        };
        return (
          g.enabled !== old.enabled ||
          JSON.stringify([...(g.station_ids ?? [])].sort()) !==
            JSON.stringify([...(old.station_ids ?? [])].sort())
        );
      });
      const rows = data.users
        .filter((u) => (u.group_ids ?? []).some((id) => changed.some((g) => g.id === id)))
        .map((u) => {
          const overrides = u.permission_overrides ?? {};
          const grant = new Set(
            groups
              .filter((g) => g.enabled && (u.group_ids ?? []).includes(g.id))
              .flatMap((g) => g.station_ids ?? []),
          );
          for (const [sid, mode] of Object.entries(overrides))
            mode === "allow" ? grant.add(sid) : grant.delete(sid);
          return {
            user_id: u.id,
            display_name: u.display_name,
            employee_no: u.employee_no,
            before: Object.keys(u.assignments).filter((s) => u.assignments[s].enabled),
            after: [...grant],
            overrides,
            changed: true,
          };
        });
      const operation_id = crypto.randomUUID();
      window.fixturePolicyReviews ??= {};
      window.fixturePolicyReviews[operation_id] = structuredClone(message);
      return {
        operation_id,
        requires_confirmation: changed.length > 0 || (window.fixtureFieldChanges?.length ?? 0) > 0,
        field_changes: window.fixtureFieldChanges ?? [],
        can_apply: window.fixtureCanApply ?? true,
        changed: rows.length,
        offline: [],
        rows,
        expires_in: 300,
        device_writes: 0,
      };
    }
    if (command === "profiles/settings_apply") {
      const planned = window.fixturePolicyReviews[message.operation_id];
      if (planned.revision !== data.profile_settings.revision) throw { code: "bulk_review_stale" };
      data.profile_settings = { ...planned.values, revision: planned.revision + 1 };
      data.users.forEach(groupAccess);
      window.demoNotify();
      return {
        operation_id: message.operation_id,
        changed: 0,
        stations: [],
        user_ids: [],
        action: "bulk/group_policy",
      };
    }
    if (command === "profiles/settings_update") {
      if (message.revision !== data.profile_settings.revision) throw { code: "revision_conflict" };
      data.profile_settings = { ...message.values, revision: message.revision + 1 };
      data.users.forEach(groupAccess);
      window.demoNotify();
      return structuredClone(data.profile_settings);
    }
    if (command === "users/photo_get")
      return {
        photo: data.profile_settings.photo_enabled ? (photos[message.user_id] ?? null) : null,
      };
    if (command === "tts/engines")
      return {
        default: "tts.google_translate_en_com",
        engines: [
          {
            engine_id: "tts.google_translate_en_com",
            name: "Google Translate",
            supported_languages: ["en", "iw"],
            default_language: "en",
          },
        ],
      };
    if (command === "media/provider_discover")
      return { url: "http://a889bffc-go2rtc-hardware:1984", version: "1.9.14" };
    if (command === "appearance/settings_get") return structuredClone(data.appearance_settings);
    if (command === "appearance/settings_update") {
      if (message.revision !== data.appearance_settings.revision)
        throw { code: "revision_conflict" };
      data.appearance_settings = {
        default: message.default,
        accent: message.accent ?? data.appearance_settings.accent,
        revision: message.revision + 1,
      };
      window.demoNotify();
      return structuredClone(data.appearance_settings);
    }
    if (command === "media/settings_get") return structuredClone(data.media_settings);
    if (command === "media/settings_update") {
      if (message.revision !== data.media_settings.revision) throw { code: "revision_conflict" };
      data.media_settings = { ...message.values, revision: message.revision + 1 };
      window.demoNotify();
      return structuredClone(data.media_settings);
    }
    if (command === "media/provider_check")
      return {
        available: true,
        source: "home_assistant",
        server: "Home Assistant",
        version: "1.9.14",
      };
    if (command === "media/call")
      return {
        call_commands: ["answer", "reject", "hangUp"],
        state: data.stations.find((s) => s.id === message.station_id)?.call_state ?? "unknown",
        checked_at: new Date().toISOString(),
        busy: false,
        last_result: null,
      };
    if (command === "media/signal")
      return {
        command: message.command,
        acknowledged: true,
        physical_result: "unverified",
        observation: "unchanged",
        observed_state: "ringing",
        checked_at: new Date().toISOString(),
      };
    if (command === "stations/clock_refresh")
      return data.stations.find((s) => s.id === message.station_id).clock;
    if (command.startsWith("schedules/operations_")) {
      const action = command.replace("schedules/operations_", "");
      if (action === "list" || action === "export") return structuredClone(operations);
      const plan = deploymentPlans.find((p) => p.id === message.plan_id);
      if (action === "claim_preview") {
        claimPreview = {
          token: "PRIVATE_CLAIM_TOKEN",
          plan_id: plan.id,
          plan_revision: plan.revision,
          resource_keys: ["weekly:" + plan.bindings.weekly, "template:" + plan.bindings.template],
          report: plan.report,
        };
        return structuredClone(claimPreview);
      }
      if (action === "claim_confirm") {
        const source = deploymentPlans.find((p) => p.id === claimPreview.plan_id);
        const claim = {
          id: crypto.randomUUID(),
          revision: 1,
          plan_id: source.id,
          station_id: source.station_id,
          resource_keys: claimPreview.resource_keys,
        };
        operations.claims.push(claim);
        claimPreview = undefined;
        return structuredClone(claim);
      }
      if (action === "create") {
        if (operations.jobs.some((j) => j.plan_id === plan.id && j.status !== "cancelled"))
          throw { code: "schedule_operation_exists" };
        const job = {
          id: crypto.randomUUID(),
          revision: 1,
          plan_id: plan.id,
          plan_revision: plan.revision,
          station_id: plan.station_id,
          name: plan.name,
          resource_keys: ["weekly:" + plan.bindings.weekly, "template:" + plan.bindings.template],
          status: "pending",
          error: null,
          blockers: ["schedule_writes_unverified"],
          ownership: "not_checked",
          journal_id: null,
          report: null,
          updated_at: new Date().toISOString(),
        };
        operations.jobs.push(job);
        return structuredClone(job);
      }
      if (action === "claim_release") {
        if (operations.jobs.some((j) => j.status !== "cancelled"))
          throw { code: "schedule_claim_in_use" };
        operations.claims.splice(
          operations.claims.findIndex((c) => c.id === message.claim_id),
          1,
        );
        return { released: true };
      }
      const job = operations.jobs.find((j) => j.id === message.job_id);
      if (!job || job.revision !== message.revision) throw { code: "revision_conflict" };
      if (action === "check") {
        job.status = "queued";
        job.revision++;
        setTimeout(() => {
          job.status = "blocked";
          job.revision++;
          job.ownership = operations.claims.length ? "current" : "missing";
          job.report = structuredClone(deploymentPlans.find((p) => p.id === job.plan_id).report);
          job.blockers = job.report.blockers.filter(
            (b) => b !== "schedule_ownership_unknown" || job.ownership !== "current",
          );
        }, window.demoOperationDelay ?? 100);
      }
      if (action === "cancel") {
        job.status = "cancelled";
        job.revision++;
      }
      if (action === "archive") {
        operations.archive.push(job);
        operations.jobs.splice(operations.jobs.indexOf(job), 1);
      }
      return structuredClone(job);
    }
    if (command === "schedules/plan_list")
      return structuredClone(
        deploymentPlans.map((p) => ({
          ...p,
          source_state: schedules.some((s) => s.id === p.draft_id)
            ? schedules.find((s) => s.id === p.draft_id).revision === p.draft_revision
              ? "current"
              : "changed"
            : "missing",
        })),
      );
    if (command === "schedules/plan_preview") {
      const source = schedules.find((s) => s.id === message.schedule_id);
      deploymentPreview = {
        id: crypto.randomUUID(),
        revision: 1,
        station_id: message.station_id,
        draft_id: source.id,
        draft_revision: source.revision,
        name: source.name,
        bindings: message.bindings,
        source_state: "current",
        drifted_resources: [],
        token: "PRIVATE_PLAN_TOKEN",
        report: {
          checked_at: new Date().toISOString(),
          can_apply: false,
          blockers: [
            "schedule_writes_unverified",
            "schedule_ownership_unknown",
            "schedule_plan_user_defaults",
          ],
          resources: ["weekly", "template"].map((kind) => ({
            kind,
            id: message.bindings[kind],
            coverage: "complete",
            state: "different",
            fields: ["enable"],
            active: false,
            externally_referenced: kind === "weekly",
          })),
        },
        candidates: [
          {
            kind: "weekly",
            id: message.bindings.weekly,
            body: { UserRightWeekPlanCfg: { enable: true, WeekPlanCfg: [] } },
          },
        ],
      };
      return structuredClone(deploymentPreview);
    }
    if (command === "schedules/plan_save") {
      if (!deploymentPreview) throw { code: "schedule_plan_expired" };
      const item = structuredClone(deploymentPreview);
      delete item.token;
      deploymentPlans.push(item);
      deploymentPreview = undefined;
      return structuredClone(item);
    }
    if (
      command === "schedules/plan_recheck" ||
      command === "schedules/plan_delete" ||
      command === "schedules/plan_export"
    ) {
      const item = deploymentPlans.find((p) => p.id === message.plan_id);
      if (!item || item.revision !== message.revision) throw { code: "revision_conflict" };
      if (command.endsWith("delete")) {
        deploymentPlans.splice(deploymentPlans.indexOf(item), 1);
        return { deleted: true };
      }
      if (command.endsWith("recheck")) {
        item.revision++;
        if (window.demoPlanDrift) item.drifted_resources = ["weekly:" + item.bindings.weekly];
      }
      return structuredClone(item);
    }
    if (command === "schedules/export")
      return {
        format: "hikvision_intercom.schedule_drafts",
        version: 1,
        schedules: schedules.map(({ name, weekly, holidays }) =>
          structuredClone({ name, weekly, holidays }),
        ),
      };
    if (command === "schedules/import_preview") {
      let document;
      try {
        document = JSON.parse(message.document);
      } catch {
        throw { code: "schedule_transfer_invalid" };
      }
      if (
        document.format !== "hikvision_intercom.schedule_drafts" ||
        document.version !== 1 ||
        !Array.isArray(document.schedules) ||
        !document.schedules.length
      )
        throw { code: "schedule_transfer_invalid" };
      scheduleImport = structuredClone(document.schedules);
      return {
        token: "PRIVATE_IMPORT_TOKEN",
        count: scheduleImport.length,
        name_collisions: scheduleImport.filter((d) => schedules.some((s) => s.name === d.name))
          .length,
        expires_in: 300,
        items: scheduleImport.map((d) => ({
          name: d.name,
          weekly_periods: Object.values(d.weekly).reduce((n, p) => n + p.length, 0),
          holidays: d.holidays.length,
        })),
      };
    }
    if (command === "schedules/import_apply") {
      if (!scheduleImport) throw { code: "schedule_import_expired" };
      const items = scheduleImport.map((d) => ({
        ...d,
        id: crypto.randomUUID(),
        revision: 1,
        updated_at: new Date().toISOString(),
      }));
      scheduleImport = undefined;
      schedules.push(...items);
      return structuredClone(items);
    }
    if (command === "schedules/list") return structuredClone(schedules);
    if (command === "schedules/create" || command === "schedules/update") {
      const current = schedules.find((s) => s.id === message.schedule_id);
      if (command === "schedules/update" && current?.revision !== message.revision)
        throw { code: "revision_conflict" };
      const item = {
        ...structuredClone(message.data),
        id: current?.id ?? crypto.randomUUID(),
        revision: (current?.revision ?? 0) + 1,
        updated_at: "2026-09-08T20:00:00Z",
      };
      if (current) schedules.splice(schedules.indexOf(current), 1, item);
      else schedules.push(item);
      return structuredClone(item);
    }
    if (command === "schedules/delete") {
      const index = schedules.findIndex((s) => s.id === message.schedule_id);
      if (index < 0 || schedules[index].revision !== message.revision)
        throw { code: "revision_conflict" };
      schedules.splice(index, 1);
      return { deleted: true };
    }
    if (command === "schedules/preview") {
      const d = message.data;
      const holiday = d.holidays.find((h) => h.start <= message.date && h.end >= message.date);
      const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        new Date(message.date + "T12:00:00Z").getUTCDay()
      ];
      const periods = holiday?.periods ?? d.weekly[day];
      if (periods.some((p) => p.start >= p.end)) throw { code: "schedule_invalid_time" };
      return {
        within_window: periods.some((p) => p.start <= message.time && message.time < p.end),
        source: holiday ? "holiday" : "weekly",
        holiday: holiday?.name ?? null,
        periods,
        date: message.date,
        time: message.time,
      };
    }
    if (command === "schedules/baseline_save") {
      const prior = scheduleBaselines.get(message.station_id);
      scheduleBaselines.set(message.station_id, {
        revision: (prior?.revision ?? 0) + 1,
        checked_at: "2026-09-09T00:00:00Z",
      });
      return scheduleBaselines.get(message.station_id);
    }
    if (command === "schedules/baseline_clear") {
      scheduleBaselines.delete(message.station_id);
      return { revision: 0, checked_at: null };
    }
    if (command === "schedules/dependencies")
      return {
        checked_at: new Date().toISOString(),
        mapping_complete: false,
        can_apply: false,
        users: { state: "complete", error: null, read: 2, explicit: 1, implicit: 1, malformed: 0 },
        checks: ["template", "weekly", "holiday_group", "holiday"].map((kind) => ({
          kind,
          coverage: kind === "holiday" ? "partial" : "complete",
          referenced: 1,
          observed: 1,
          not_observed: 0,
          disabled: 1,
          ids: [1],
          not_observed_ids: [],
        })),
      };
    if (command === "schedules/assess") {
      const prior = scheduleBaselines.get(message.station_id);
      return {
        baseline: {
          state: prior ? (window.demoBaselineChange ? "changed" : "incomplete") : "missing",
          revision: prior?.revision ?? 0,
          checked_at: prior?.checked_at ?? null,
          token: "PRIVATE_BASELINE_TOKEN",
          checks: prior
            ? ["template", "weekly", "holiday_group", "holiday"].map((kind) => ({
                kind,
                state:
                  kind === "weekly" && window.demoBaselineChange
                    ? "changed"
                    : kind === "holiday"
                      ? "incomplete"
                      : "unchanged",
                modified: kind === "weekly" && window.demoBaselineChange ? 1 : 0,
                added: 0,
                removed: 0,
                modified_ids: kind === "weekly" && window.demoBaselineChange ? [10] : [],
                added_ids: [],
                removed_ids: [],
                unverified_new: 0,
                unverified_missing: kind === "holiday" ? 5 : 0,
                coverage_complete: kind !== "holiday",
                capability_changed: false,
              }))
            : [],
        },
        checked_at: "2026-09-09T00:00:00Z",
        complete: false,
        can_apply: false,
        users_checked: false,
        ownership_checked: false,
        checks: ["template", "weekly", "holiday_group", "holiday"].map((kind) => ({
          kind,
          state: kind === "holiday" ? "partial" : "complete",
          error: kind === "holiday" ? "schedule_search_bound" : null,
          read: kind === "holiday" ? 300 : 255,
          total: kind === "holiday" ? 1024 : 255,
          enabled: 0,
          disabled: kind === "holiday" ? 300 : 255,
          referenced: kind === "weekly" ? 255 : null,
        })),
        assessment: {
          state: message.data.holidays.length ? "unknown" : "fits",
          can_apply: false,
          limits: [
            { key: "weekly_per_day", needed: 1, available: 8, state: "fits" },
            ...(message.data.holidays.length
              ? [
                  {
                    key: "holiday_membership",
                    needed: message.data.holidays.length,
                    available: null,
                    state: "unknown",
                  },
                ]
              : []),
          ],
          blockers: [
            "schedule_writes_unverified",
            "schedule_ownership_unknown",
            "schedule_inventory_incomplete",
          ],
        },
      };
    }
    if (command === "schedules/readiness")
      return {
        checked_at: "2026-09-08T20:00:00Z",
        can_apply: false,
        sample_only: true,
        reason: "schedule_writes_unverified",
        checks: ["template", "weekly", "holiday_group", "holiday"].map((kind) => ({
          kind,
          advertised: true,
          capabilities: { ids: [1, kind === "holiday" ? 1024 : 255] },
          sample_id: 1,
          read_state: "failed",
          error: "device_rejected",
        })),
      };
    if (command === "cards/reader_capabilities") return { readers: [0], card_min: 1, card_max: 32 };
    if (command === "cards/capture_start") {
      const id = "synthetic-capture-" + captures.size;
      captures.set(id, {
        session_id: id,
        state: "captured",
        error: null,
        station_id: message.station_id,
        user_id: message.user_id,
        revision: message.revision,
        card: { masked_number: "•••• 7788", technology: "TypeA_M1", reader_id: null },
      });
      return { session_id: id, state: "preparing" };
    }
    if (command === "cards/capture_status") {
      if (!captures.has(message.session_id)) throw { code: "capture_not_found" };
      return structuredClone(captures.get(message.session_id));
    }
    if (command === "cards/capture_cancel") {
      captures.delete(message.session_id);
      return { cancelled: true };
    }
    if (command === "cards/capture_confirm") {
      const captured = captures.get(message.session_id);
      if (!captured) throw { code: "capture_not_found" };
      const user = data.users.find((user) => user.id === captured.user_id);
      if (user.revision !== captured.revision) throw { code: "revision_conflict" };
      user.cards.push({
        id: "captured-card",
        masked_number: "•••• 7788",
        label: message.label,
        card_type: "normalCard",
        enabled: true,
      });
      user.revision++;
      captures.delete(message.session_id);
      return structuredClone(user);
    }
    if (command === "operations/query") {
      const syncRows = (data.sync_operations ?? []).map((item) => ({
        id: item.id,
        kind: "sync",
        action: "sync/user_station",
        state: item.state,
        created_at: item.queued_at,
        updated_at: item.updated_at,
        changed: 1,
        user_ids: [item.user_id],
        station_ids: [item.station_id],
        progress: {
          total: 1,
          pending: Number(item.state === "pending"),
          failed: Number(item.state === "failed"),
          verified: Number(item.state === "verified"),
          settled: Number(item.state === "settled"),
        },
        children: [item],
      }));
      const receipt = {
        id: "csv-import",
        kind: "csv",
        action: "bulk/csv_import",
        state: "failed",
        created_at: "2026-09-22T09:59:00Z",
        updated_at: "2026-09-22T10:02:00Z",
        changed: 2,
        user_ids: ["person-0", "person-1"],
        station_ids: ["station-0", "station-1"],
        progress: { total: 2, pending: 0, failed: 1, verified: 1, settled: 0 },
        children: structuredClone(data.sync_operations ?? []),
      };
      const records = [...syncRows, receipt].filter(
        (item) =>
          (message.filters.kind === "all" || item.kind === message.filters.kind) &&
          (message.filters.state === "all" || item.state === message.filters.state) &&
          (!message.filters.station_id || item.station_ids.includes(message.filters.station_id)) &&
          (!message.filters.query ||
            JSON.stringify(item).toLowerCase().includes(message.filters.query.toLowerCase())),
      );
      return {
        records,
        total: records.length,
        offset: 0,
        limit: 50,
        next_offset: null,
        previous_offset: null,
        snapshot: "operations-fixture",
        stale: false,
        summary: {
          pending: records.filter((item) => item.state === "pending").length,
          failed: records.filter((item) => item.state === "failed").length,
          verified: records.filter((item) => item.state === "verified").length,
          settled: records.filter((item) => item.state === "settled").length,
          saved: records.filter((item) => item.state === "saved").length,
        },
      };
    }
    if (command === "users/lifecycle") {
      const now = Date.parse("2026-09-23T09:00:00Z");
      const temporaryUsers = data.users
        .filter((user) => ["visitor", "contractor"].includes(user.access_category))
        .map((user) => {
          const end = Date.parse(user.valid_until);
          const state = !user.active
            ? "inactive"
            : end <= now
              ? "expired"
              : Date.parse(user.valid_from) > now
                ? "upcoming"
                : "active";
          return {
            ...structuredClone(user),
            state,
            expiring_soon: state === "active" && end - now <= message.warning_days * 86400000,
            assignment_count: Object.values(user.assignments).filter(
              (assignment) => assignment.enabled,
            ).length,
            timing_policy_configured: !!user.access_timing_policy,
            assignment_states: structuredClone(user.assignments),
          };
        });
      const temporarySummary = Object.fromEntries(
        ["total", "active", "upcoming", "expired", "inactive", "expiring"].map((state) => [
          state,
          state === "total"
            ? temporaryUsers.length
            : temporaryUsers.filter((user) =>
                state === "expiring" ? user.expiring_soon : user.state === state,
              ).length,
        ]),
      );
      return {
        format: "hikvision_intercom.identity_lifecycle",
        generated_at: "2026-09-23T09:00:00Z",
        warning_days: message.warning_days,
        summary: {
          total: data.users.length,
          active: data.users.filter((user) => user.active).length,
          scheduled: 0,
          expired: 0,
          expiring: 1,
          without_credentials: 1,
          duplicate_groups: 1,
          duplicate_users: 2,
        },
        expirations: [
          {
            ...structuredClone(data.users[1]),
            phone: "050-123-4567",
            card_count: 1,
            enabled_card_count: 1,
            assignment_count: 3,
            group_ids: [],
            state: "expiring",
            seconds_remaining: 700000,
          },
        ],
        duplicates: [
          {
            reason: "phone",
            match: null,
            users: [0, 1].map((index) => ({
              ...structuredClone(data.users[index]),
              phone: "050-123-4567",
              card_count: 1,
              enabled_card_count: 1,
              assignment_count: 2,
              group_ids: [],
            })),
          },
        ],
        without_credentials: [
          {
            ...structuredClone(data.users[4]),
            phone: "",
            card_count: 0,
            enabled_card_count: 0,
            assignment_count: 6,
            group_ids: [],
          },
        ],
        ...(query.has("legacy-lifecycle")
          ? {}
          : { temporary_access: { summary: temporarySummary, users: temporaryUsers } }),
        truncated: { expirations: false, duplicates: false, without_credentials: false },
        privacy: "no_pin_or_complete_card_values",
      };
    }
    if (command === "users/duplicate_check") {
      const duplicate =
        String(message.data?.display_name ?? "")
          .trim()
          .toLowerCase() === "dana cohen";
      return {
        matches: duplicate
          ? [
              {
                id: "person-1",
                display_name: "Dana Cohen",
                employee_no: "1001",
                phone: "050-123-4567",
                reasons: ["display_name"],
                card_matches: [],
              },
            ]
          : [],
        total: duplicate ? 1 : 0,
        truncated: false,
        blocking: false,
        privacy: "no_pin_or_complete_card_values",
      };
    }
    if (command === "users/get") {
      const person = data.users.find((item) => item.id === message.user_id);
      if (!person) throw { code: "user_not_found" };
      return { ...structuredClone(person), phone: person.phone ?? "0501234567" };
    }
    if (command === "overview" || command === "sync/status") return structuredClone(data);
    if (command === "users/list") return structuredClone(data.users);
    if (command === "overview/summary") {
      if (!query.has("summary")) throw { code: "unknown_command" };
      const summary = structuredClone(data);
      summary.users = [];
      summary.users_complete = false;
      summary.user_count = data.users.length;
      for (const key of [
        "sync_operations",
        "tombstones",
        "revocations",
        "card_removals",
        "pin_removals",
      ])
        summary[key] = [];
      return summary;
    }
    if (command === "users/archive" || command === "users/unarchive") {
      const person = data.users.find((u) => u.id === message.user_id);
      if (!person || person.revision !== message.revision) throw { code: "revision_conflict" };
      if (!message.confirmed) throw { code: "confirmation_required" };
      person.archived_at = command === "users/archive" ? new Date().toISOString() : null;
      person.active = false;
      person.revision++;
      return structuredClone(person);
    }
    if (command === "users/query") {
      if (query.has("query-fails")) throw { code: "fixture_query_failed" };
      const text = String(message.query ?? "")
        .trim()
        .toLocaleLowerCase();
      const filtered = data.users
        .filter((user) => !!user.archived_at === (message.filters?.state === "archived"))
        .filter(
          (user) =>
            !text ||
            `${user.display_name} ${user.employee_no} ${user.phone ?? ""}`
              .toLocaleLowerCase()
              .includes(text),
        )
        .sort((a, b) =>
          message.filters?.sort === "name"
            ? a.display_name.localeCompare(b.display_name)
            : a.employee_no.localeCompare(b.employee_no, undefined, { numeric: true }),
        );
      const offset = Math.min(
        Number(message.offset),
        filtered.length ? Math.floor((filtered.length - 1) / message.limit) * message.limit : 0,
      );
      return {
        records: structuredClone(filtered.slice(offset, offset + message.limit)),
        total: filtered.length,
        total_all: data.users.length,
        profile_facets: Object.fromEntries(
          data.profile_settings.fields.map((field) => [
            field.id,
            [...new Set(data.users.map((user) => user.profile?.[field.id]).filter(Boolean))].sort(),
          ]),
        ),
        offset,
        limit: message.limit,
        next_offset: offset + message.limit < filtered.length ? offset + message.limit : null,
        previous_offset: offset ? Math.max(0, offset - message.limit) : null,
        snapshot: "fixture-snapshot",
        stale: false,
      };
    }
    if (command === "sync/diagnostics")
      return {
        integration_version: "0.6.1-alpha.1",
        stations: [
          { station_ref: "aabbccddeeff", state: "error", last_error: "validity_rejected" },
        ],
        retention: "last_200_stages_since_start",
        recent: [
          {
            station_ref: "aabbccddeeff",
            user_ref: "112233445566",
            step: "create_person",
            outcome: "failed",
            error: "validity_rejected",
            fields: ["beginTime", "endTime"],
          },
        ],
      };
    if (command === "events/list") {
      const records = [
        {
          id: "event-1",
          ...(query.has("platform")
            ? { person_link: { user_id: data.users[0].id, revision: data.users[0].revision } }
            : {}),
          station_id: data.stations[0]?.id,
          timestamp: "2026-09-08T12:00:00Z",
          person_name: "Dana",
          employee_no: "42",
          door: 1,
          authentication: "pin",
          result: "denied",
          event_type: "access_denied",
          card: null,
          recovered: false,
          major: 5,
          minor: 150,
        },
        {
          id: "event-2",
          station_id: data.stations[0]?.id,
          timestamp: "2026-09-08T11:00:00Z",
          person_name: null,
          employee_no: null,
          door: null,
          authentication: "card",
          result: "granted",
          event_type: "access_granted",
          card: "••••3210",
          recovered: true,
          major: 5,
          minor: 1,
        },
      ].filter(
        (row) =>
          (!message.filters.result || row.result === message.filters.result) &&
          (!message.filters.person || row.person_name?.includes(message.filters.person)),
      );
      return { records, next: null, storage_failed: false, stations: {} };
    }
    if (command === "users/csv_inspect") {
      const headers = message.csv
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)[0]
        .split(",")
        .map((value) => value.replace(/^"|"$/g, ""));
      return { headers, mapping: Object.fromEntries(headers.map((header) => [header, header])) };
    }
    if (command === "users/csv_preview")
      return {
        review_token: "synthetic-csv-review",
        errors: [],
        counts: { create: 1, update: 0, unchanged: 0 },
        rows: [
          {
            line: 2,
            employee_no: "9001",
            display_name: "CSV Resident",
            operation: "create",
            changed_fields: ["display_name", "pin", "assignments"],
            active: true,
            pin_configured: true,
            card_count: 1,
            stations: ["station-0"],
            access_removed: false,
          },
        ],
      };
    if (command === "users/csv_apply")
      return { saved: 1, counts: { create: 1, update: 0, unchanged: 0 } };
    if (command === "users/csv_export")
      return {
        csv: '\ufeff"employee_no","display_name"\r\n"9001","CSV Resident"\r\n',
        count: 1,
        stations: [],
      };
    if (["events/report", "events/export"].includes(command)) {
      const counts = {
        records: 260,
        authentication: 200,
        granted: 180,
        denied: 20,
        unknown: 0,
        other: 60,
        recovered: 90,
      };
      return {
        generated_at: "2026-09-08T12:30:00Z",
        oldest: "2026-09-08T01:00:00Z",
        newest: "2026-09-08T12:00:00Z",
        day_timezone: "UTC",
        totals: counts,
        methods: { card: 150, pin: 50 },
        anomalies: {
          access_denied: 12,
          attempt_limit: 3,
          unlock_exception: 1,
          door_not_closed: 2,
        },
        anomaly_by_station: [
          {
            station_id: "station-0",
            total: 18,
            counts: {
              access_denied: 12,
              attempt_limit: 3,
              unlock_exception: 1,
              door_not_closed: 2,
            },
          },
        ],
        by_station: [{ station_id: "station-0", ...counts }],
        by_day: [{ day: "2026-09-08", ...counts }],
        storage_failed: false,
        stations: {},
        ...(command === "events/export"
          ? { csv: '\ufeff"timestamp","masked_card"\r\n"2026-09-08T12:00:00Z","•••• 3210"\r\n' }
          : {}),
      };
    }
    if (command === "users/create") {
      const { pin, cards, photo, ...fields } = message.data;
      const user = {
        ...fields,
        id: crypto.randomUUID(),
        revision: 1,
        pin_configured: !!pin,
        identity_locked: false,
        cards: cards.map((card, i) => ({
          id: `new-card-${i}`,
          masked_number: `•••• ${card.card_no.slice(-4)}`,
          label: card.label,
          card_type: card.card_type,
          enabled: card.enabled,
        })),
      };
      if (photo !== undefined) {
        photos[user.id] = photo;
        user.photo_configured = !!photo;
      }
      groupAccess(user);
      data.users.push(user);
      callbacks.forEach((callback) => callback({ kind: "refresh" }));
      return structuredClone(user);
    }
    if (command === "users/update") {
      const user = data.users.find((item) => item.id === message.user_id);
      if (message.revision !== user.revision) throw { code: "revision_conflict" };
      const { pin, cards, photo, ...fields } = message.data;
      if (photo !== undefined) {
        photos[user.id] = photo;
        user.photo_configured = !!photo;
      }
      if (
        fields.access_policy_revision !== undefined &&
        fields.access_policy_revision !== data.profile_settings.revision
      )
        throw { code: "group_policy_changed" };
      Object.assign(user, fields);
      groupAccess(user);
      user.revision++;
      if (pin !== undefined) user.pin_configured = !!pin;
      if (cards)
        user.cards = cards.map((card, i) => {
          const old = user.cards.find((item) => item.id === card.id);
          return {
            ...old,
            ...card,
            id: card.id ?? `new-card-${i}`,
            masked_number: old?.masked_number ?? `•••• ${card.card_no.slice(-4)}`,
            card_no: undefined,
          };
        });
      callbacks.forEach((callback) => callback({ kind: "refresh" }));
      return structuredClone(user);
    }
    if (command === "users/delete") {
      data.users = data.users.filter((item) => item.id !== message.user_id);
      callbacks.forEach((callback) => callback({ kind: "refresh" }));
    }
    if (command === "users/set_active") {
      const user = data.users.find((item) => item.id === message.user_id);
      user.active = message.active;
      user.revision++;
    }
    if (command === "users/temporary_cancel") {
      const user = data.users.find((item) => item.id === message.user_id);
      if (message.revision !== user.revision) throw { code: "revision_conflict" };
      if (!["visitor", "contractor"].includes(user.access_category))
        throw { code: "temporary_user_required" };
      if (!user.active) throw { code: "temporary_already_inactive" };
      user.active = false;
      user.revision++;
      for (const assignment of Object.values(user.assignments)) {
        assignment.sync_state = "pending";
        assignment.desired_revision = user.revision;
      }
      callbacks.forEach((callback) => callback({ kind: "refresh" }));
      return structuredClone(user);
    }
    if (command === "guest_templates/get") return structuredClone(guestTemplates);
    if (command === "fleet/alerts") {
      const policies = fleetAlerts.suppressions.filter((row) => Date.parse(row.until) > Date.now());
      const rows = fleetAlerts.items.map((item) => {
        const suppression = policies.find(
          (row) =>
            row.station_id === item.station_id &&
            (row.kind === item.kind || row.kind === "maintenance"),
        );
        return { ...item, suppressed: !!suppression, suppression: suppression ?? null };
      });
      const filtered = rows.filter(
        (row) =>
          (message.include_suppressed || !row.suppressed) &&
          (!message.station_id || row.station_id === message.station_id) &&
          (!message.kind || row.kind === message.kind),
      );
      return {
        revision: fleetAlerts.revision,
        generated_at: new Date().toISOString(),
        items: structuredClone(filtered.slice(message.offset, message.offset + message.limit)),
        total: filtered.length,
        offset: message.offset,
        next_offset: null,
        active_count: rows.filter((row) => !row.suppressed).length,
        suppressed_count: rows.filter((row) => row.suppressed).length,
        suppressions: structuredClone(policies),
      };
    }
    if (command === "fleet/alerts_action") {
      if (message.revision !== fleetAlerts.revision) throw { code: "revision_conflict" };
      fleetAlerts.suppressions = fleetAlerts.suppressions.filter(
        (row) => !(row.station_id === message.station_id && row.kind === message.kind),
      );
      if (message.action === "suppress")
        fleetAlerts.suppressions.push({
          station_id: message.station_id,
          kind: message.kind,
          reason: message.reason,
          until: new Date(Date.now() + message.duration_minutes * 60000).toISOString(),
          created_at: new Date().toISOString(),
          actor: this.user.id,
        });
      fleetAlerts.revision++;
      return { revision: fleetAlerts.revision };
    }
    if (command === "visits/operators")
      return {
        operators: [
          { id: "demo-admin", name: "Administrator" },
          { id: "demo-host", name: "Reception host" },
        ],
      };
    if (command === "visits/list") {
      const filters = message.filters ?? {};
      const rows = visitRequests.items.filter(
        (row) =>
          (!filters.status || filters.status === "all" || row.status === filters.status) &&
          (!filters.scope ||
            filters.scope === "all" ||
            row[filters.scope === "approver" ? "approver_id" : "requested_by"] === this.user.id) &&
          (!filters.query ||
            [
              row.snapshot.display_name,
              row.snapshot.employee_no,
              row.snapshot.responsible_person,
              row.snapshot.access_purpose,
            ]
              .join(" ")
              .toLowerCase()
              .includes(filters.query.toLowerCase())),
      );
      const offset = Math.min(
        message.offset,
        rows.length ? Math.floor((rows.length - 1) / message.limit) * message.limit : 0,
      );
      return {
        ...structuredClone(visitRequests),
        items: structuredClone(rows.slice(offset, offset + message.limit)),
        total: rows.length,
        offset,
        next_offset: offset + message.limit < rows.length ? offset + message.limit : null,
      };
    }
    if (command === "visits/create") {
      if (message.approver_id === this.user.id) throw { code: "visit_second_operator_required" };
      const source = structuredClone(message.data);
      const user = {
        ...source,
        id: crypto.randomUUID(),
        employee_no: source.employee_no || "1099",
        revision: 1,
        active: false,
        pin_configured: !!source.pin,
        cards: source.cards ?? [],
        assignments: source.assignments ?? {},
        identity_locked: false,
      };
      delete user.pin;
      if (source.door_permissions)
        user.assignments = Object.fromEntries(
          Object.entries(source.door_permissions).map(([id, locks]) => [
            id,
            { enabled: true, allowed_locks: locks, sync_state: "pending" },
          ]),
        );
      data.users.push(user);
      visitRequests.revision++;
      visitRequests.items.unshift({
        id: crypto.randomUUID(),
        user_id: user.id,
        user_revision: 1,
        revision: 1,
        approver_id: message.approver_id,
        requested_by: this.user.id,
        requested_at: new Date().toISOString(),
        status: "pending",
        decided_by: "",
        decided_at: null,
        snapshot: visitSnapshot(user),
        stale: false,
        user_deleted: false,
      });
      return structuredClone(user);
    }
    if (command === "visits/decide") {
      const row = visitRequests.items.find((item) => item.id === message.request_id);
      if (row.revision !== message.revision) throw { code: "revision_conflict" };
      if (row.status !== "pending") throw { code: "visit_request_closed" };
      const user = data.users.find((item) => item.id === row.user_id);
      if (message.decision === "approve" && (row.stale || user.revision !== row.user_revision))
        throw { code: "visit_request_stale" };
      row.status = { approve: "approved", reject: "rejected", cancel: "cancelled" }[
        message.decision
      ];
      row.revision++;
      row.decided_by = this.user.id;
      row.decided_at = new Date().toISOString();
      visitRequests.revision++;
      if (message.decision === "approve") {
        user.active = true;
        user.revision++;
      }
      return structuredClone(row);
    }
    if (command === "visits/request") {
      const user = data.users.find((item) => item.id === message.user_id);
      if (user.revision !== message.revision) throw { code: "revision_conflict" };
      if (user.active) throw { code: "visit_inactive_required" };
      for (const row of visitRequests.items)
        if (row.user_id === user.id && row.status === "pending") row.status = "superseded";
      visitRequests.revision++;
      const row = {
        id: crypto.randomUUID(),
        user_id: user.id,
        user_revision: user.revision,
        revision: 1,
        approver_id: message.approver_id,
        requested_by: this.user.id,
        requested_at: new Date().toISOString(),
        status: "pending",
        decided_by: "",
        decided_at: null,
        snapshot: visitSnapshot(user),
        stale: false,
        user_deleted: false,
      };
      visitRequests.items.unshift(row);
      return structuredClone(row);
    }
    if (command === "guest_templates/upsert" || command === "guest_templates/delete") {
      if (message.revision !== guestTemplates.revision) throw { code: "revision_conflict" };
      if (command.endsWith("delete"))
        guestTemplates.items = guestTemplates.items.filter(
          (item) => item.id !== message.template_id,
        );
      else {
        const id = message.template_id || crypto.randomUUID().replaceAll("-", "");
        guestTemplates.items = guestTemplates.items.filter((item) => item.id !== id);
        guestTemplates.items.push({
          ...structuredClone(message.values),
          id,
          updated_at: new Date().toISOString(),
          updated_by: "admin",
        });
      }
      guestTemplates.revision++;
      return structuredClone(guestTemplates);
    }
    if (command === "stations/inventory")
      return [
        {
          employee_no: "7777",
          display_name: hebrew ? "משתמש קיים" : "Existing resident",
          user_id: null,
          ignored: false,
          review_token: "synthetic-review",
          import_error: null,
          pin_configured: false,
          cards: [{ masked_number: "•••• 7352" }],
        },
      ];
    if (command === "conflicts/review") {
      const user = data.users.find((item) => item.id === message.user_id);
      const central = {
        present: true,
        display_name: user.display_name,
        user_type: "normal",
        validity: { timed: false, from: null, until: null, time_type: null },
        door_rights: [1],
        pin_configured: user.pin_configured,
        cards: user.cards,
        schedule_configured: false,
        privileged: false,
        other_credentials: false,
      };
      const device = {
        ...central,
        display_name: hebrew ? "שם ששונה בתחנה" : "Name changed on station",
        pin_configured: true,
        cards: [{ masked_number: "•••• 4822", card_type: "normalCard" }],
      };
      return {
        user_id: message.user_id,
        station_id: message.station_id,
        employee_no: user.employee_no,
        review_token: "synthetic-review",
        absent: false,
        display_name: device.display_name,
        pin_configured: true,
        cards: device.cards,
        deletion_pending: false,
        revision: user.revision,
        reviewed_at: "2026-09-08T12:30:00Z",
        active: user.active,
        central,
        device,
        affected_stations: Object.keys(user.assignments),
        differences: ["display_name", "pin", "cards"],
        unverified_fields: [],
        plan: { person: "update", pin: "remove", cards_add: 0, cards_remove: 0, cards_update: 0 },
        actions: {
          central: { allowed: true, reason: null },
          device: { allowed: true, reason: null },
          delete: { allowed: false, reason: "deletion_not_pending" },
        },
      };
    }
    if (message.type === "camera/stream") throw { code: "synthetic_no_video" };
    return { accepted: true };
  },
};
window.demoHass = fake;
const panel = document.createElement("hikvision-intercom-panel");
panel.hass = fake;
document.body.append(panel);
