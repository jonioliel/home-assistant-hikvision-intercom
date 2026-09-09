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
  default_zone: { kind: "iana", name: "UTC" },
  version: "0.27.1-alpha.1",
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
