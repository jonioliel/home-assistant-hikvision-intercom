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
  version: "0.4.0-alpha.1",
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
const callbacks = new Set();
window.demoNotify = () => callbacks.forEach((callback) => callback({ kind: "refresh" }));
window.calls = [];
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
    if (command === "conflicts/review")
      return {
        user_id: message.user_id,
        station_id: message.station_id,
        employee_no: "1001",
        review_token: "synthetic-review",
        absent: false,
        display_name: hebrew ? "שם ששונה בתחנה" : "Name changed on station",
        pin_configured: true,
        cards: [{ masked_number: "•••• 4822" }],
        deletion_pending: false,
      };
    if (message.type === "camera/stream") throw { code: "synthetic_no_video" };
    return { accepted: true };
  },
};
window.demoHass = fake;
const panel = document.createElement("hikvision-intercom-panel");
panel.hass = fake;
document.body.append(panel);
