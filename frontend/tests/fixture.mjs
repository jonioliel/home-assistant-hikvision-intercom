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
const data = {
  version: "0.13.0-alpha.1",
  users: [],
  stations: names.map((name, i) => ({
    id: `station-${i}`,
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
if (query.has("empty")) {
  data.users = [];
  data.stations = [];
}
const captures = new Map();
const callbacks = new Set();
window.demoNotify = () => callbacks.forEach((callback) => callback({ kind: "refresh" }));
window.calls = [];
const schedules = [];
window.demoSchedules = schedules;
window.demoData = data;
const fake = {
  language: hebrew ? "he" : "en",
  user: { is_admin: !query.has("reader") },
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
    async subscribeMessage(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  },
  async callWS(message) {
    window.calls.push(structuredClone(message));
    const command = message.type.replace("hikvision_intercom/", "");
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
    if (command === "overview") return structuredClone(data);
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
      const { pin, cards, ...fields } = message.data;
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
      data.users.push(user);
      callbacks.forEach((callback) => callback({ kind: "refresh" }));
      return structuredClone(user);
    }
    if (command === "users/update") {
      const user = data.users.find((item) => item.id === message.user_id);
      if (message.revision !== user.revision) throw { code: "revision_conflict" };
      const { pin, cards, ...fields } = message.data;
      Object.assign(user, fields);
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
