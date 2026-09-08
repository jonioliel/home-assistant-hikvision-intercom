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
}
export interface Person {
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
export interface Station {
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
export interface Review {
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
  language: string;
  user?: { is_admin: boolean };
  states: Record<string, { state: string; attributes: Record<string, any> }>;
  callWS<T>(message: Record<string, unknown>): Promise<T>;
  connection: {
    subscribeMessage<T>(
      callback: (message: T) => void,
      message: Record<string, unknown>,
    ): Promise<() => void>;
  };
}
export interface Draft {
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
