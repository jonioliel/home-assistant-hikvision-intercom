import type { MediaPolicy } from "./media-settings";
import type { DisplayZone } from "./time";
export interface Card {
  id?: string;
  masked_number?: string;
  card_no?: string;
  label: string;
  card_type: string;
  enabled: boolean;
}
export interface Assignment {
  enabled: boolean;
  allowed_locks: number[];
  sync_state?: string;
  last_error?: string | null;
  desired_revision?: number;
  applied_revision?: number | null;
  last_sync_at?: string | null;
}
export interface Person {
  profile?: Record<string, string>;
  group_ids?: string[];
  permission_overrides?: Record<string, "allow" | "deny">;
  photo_configured?: boolean;
  id: string;
  sync_reference?: string;
  employee_no: string;
  display_name: string;
  active: boolean;
  pin_configured: boolean;
  cards: Card[];
  assignments: Record<string, Assignment>;
  revision: number;
  identity_locked: boolean;
  valid_from: string | null;
  valid_until: string | null;
}
export interface LastAccess {
  timestamp: string;
  time_source: "device" | "received";
  person_name: string | null;
  employee_no: string | null;
  authentication: string;
  result: string;
  event_type: string;
  recovered: boolean;
  door: number | null;
}
export interface StationClock {
  source: "device" | "manual" | "fallback";
  zone: DisplayZone;
  device_zone: DisplayZone | null;
  device_time: string | null;
  checked_at: string | null;
  status: string;
  error: string | null;
  skew_seconds: number | null;
  time_mode: string | null;
}
export interface Station {
  clock?: StationClock | null;
  id: string;
  sync_reference?: string;
  name: string;
  lock_enabled: boolean;
  loaded: boolean;
  online: boolean;
  call_state: string;
  sync_state: string;
  last_error: string | null;
  scanned_at: string | null;
  scanning: boolean;
  scan_error: string | null;
  observations: Record<string, boolean>;
  integrated_locks: { physical_index: number; api_id: number; name?: string }[];
  event_status: {
    stream: string;
    history: string;
    reconnects: number;
    recovered_until: string | null;
  } | null;
  reconciled_at: string | null;
  managed_user_count: number | null;
  pending_user_count: number;
  last_seen: string | null;
  last_poll_ms: number | null;
  last_access: LastAccess | null;
  user_count: number | null;
  card_count: number | null;
  unmanaged_count: number | null;
  model: string | null;
  firmware: string | null;
  host: string | null;
  entities: Record<string, string>;
  capabilities: {
    max_users: number;
    max_cards: number;
    cards_per_person: number;
    pin_writable: boolean;
    pin_min: number;
    pin_max: number;
    name_max: number;
    schedules: boolean;
  } | null;
}
export interface Tombstone {
  user_id: string;
  employee_no: string;
  targets: string[];
  confirmed: string[];
  stations?: Record<string, { sync_state: string; last_error: string | null }>;
}
export interface Overview {
  media_settings?: MediaPolicy | null;
  profile_settings?: import("./profile-settings").ProfilePolicy | null;
  default_zone?: DisplayZone;
  version: string;
  users: Person[];
  stations: Station[];
  tombstones: Tombstone[];
  revocations: {
    station_id: string;
    user_id: string;
    sync_state: string;
    last_error: string | null;
  }[];
  card_removals: { id: string; user_id: string; targets: string[]; confirmed: string[] }[];
  pin_removals: { id: string; user_id: string; targets: string[]; confirmed: string[] }[];
}
export interface Inventory {
  employee_no: string;
  display_name: string;
  user_id: string | null;
  ignored: boolean;
  review_token: string | null;
  import_error: string | null;
  pin_configured: boolean;
  cards: Card[];
}
export interface ReviewState {
  present: boolean;
  display_name: string | null;
  user_type: string | null;
  validity: {
    timed: boolean | null;
    from: string | null;
    until: string | null;
    time_type: string | null;
  };
  door_rights: number[];
  pin_configured: boolean | null;
  cards: Card[];
  schedule_configured: boolean;
  privileged: boolean;
  other_credentials: boolean;
}
export interface Review {
  invalidated?: boolean;
  revision: number | null;
  reviewed_at: string;
  central: ReviewState | null;
  device: ReviewState;
  active: boolean;
  affected_stations: string[];
  differences: string[];
  unverified_fields: string[];
  plan: {
    person: string;
    pin: string;
    cards_add: number;
    cards_remove: number;
    cards_update: number;
  } | null;
  actions: Record<string, { allowed: boolean; reason: string | null }>;
  user_id: string;
  station_id: string;
  employee_no: string;
  review_token: string;
  absent: boolean;
  display_name: string | null;
  pin_configured: boolean | null;
  cards: Card[];
  deletion_pending: boolean;
}
export interface Hass {
  themes?: { darkMode: boolean };
  language: string;
  user?: { is_admin: boolean; id?: string };
  states: Record<string, { state: string; attributes: Record<string, any> }>;
  callWS<T>(message: Record<string, unknown>): Promise<T>;
  connection: {
    connected?: boolean;
    addEventListener?(event: "disconnected" | "ready", callback: () => void): void;
    removeEventListener?(event: "disconnected" | "ready", callback: () => void): void;
    subscribeMessage<T>(
      callback: (message: T) => void,
      message: Record<string, unknown>,
      options?: { resubscribe?: boolean; preCheck?: () => boolean },
    ): Promise<() => void>;
  };
}
export interface Draft {
  profile?: Record<string, string>;
  group_ids?: string[];
  permission_overrides?: Record<string, "allow" | "deny">;
  photo?: string | null;
  photo_configured?: boolean;
  id?: string;
  revision?: number;
  employee_no: string;
  display_name: string;
  active: boolean;
  pin_configured: boolean;
  pin?: string | null;
  confirm_pin: string;
  cards: Card[];
  assignments: Record<string, Assignment>;
  identity_locked: boolean;
  valid_from: string | null;
  valid_until: string | null;
  timed: boolean;
}

export interface CsvPreview {
  review_token: string | null;
  counts: { create: number; update: number; unchanged: number };
  errors: { line: number | null; code: string }[];
  rows: {
    line: number;
    employee_no: string;
    display_name: string;
    operation: string;
    changed_fields: string[];
    active: boolean;
    pin_configured: boolean;
    card_count: number;
    stations: string[];
    access_removed: boolean;
  }[];
}
