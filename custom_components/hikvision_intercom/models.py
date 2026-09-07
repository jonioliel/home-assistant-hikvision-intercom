"""Evidence model: unknown never implies unsupported or supported."""

from dataclasses import asdict, dataclass, field
from typing import Any

type JsonValue = dict[str, Any] | list[Any] | str | int | float | bool | None


@dataclass(slots=True)
class StationIdentity:
    """Sanitized identity only."""

    model: str | None = None
    serial: str = "REDACTED"
    firmware: str | None = None


@dataclass(slots=True)
class IntercomCapabilities:
    """Read support is distinct from acceptance of credential writes."""

    call_status: bool | None = None
    event_stream: bool | None = None
    users: bool | None = None
    cards: bool | None = None
    pin_password: bool | None = None
    door_right: bool | None = None
    right_plan: bool | None = None
    remote_unlock: bool | None = None
    remote_unlock_ids: list[int] = field(default_factory=list)
    work_status: bool | None = None
    snapshot: bool | None = None
    rtsp: bool | None = None


@dataclass(slots=True)
class ProbeRecord:
    """Sanitized response plus transport evidence; never stores raw bodies."""

    name: str
    method: str
    path: str
    elapsed_ms: int = 0
    http_status: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    payload: JsonValue = None
    namespaces: list[str] = field(default_factory=list)
    outcome: str = "unknown"
    error: str | None = None
    truncated: bool = False
    bytes_received: int = 0


@dataclass(slots=True)
class CapabilityReport:
    """Phase 0 report, not permission to enable unverified production features."""

    schema_version: int = 1
    tool_version: str = "0.1.0-alpha.1"
    evidence_source: str = "device_probe"
    identity: StationIdentity = field(default_factory=StationIdentity)
    features: IntercomCapabilities = field(default_factory=IntercomCapabilities)
    evidence: dict[str, list[str]] = field(default_factory=dict)
    observations: dict[str, JsonValue] = field(default_factory=dict)
    records: list[ProbeRecord] = field(default_factory=list)
    pending_manual_tests: list[str] = field(
        default_factory=lambda: [
            "physical_bell_call_status_sequence",
            "rtsp_live_video",
            "physical_relay_to_api_door_mapping",
            "pin_mode_set_change_remove_and_keypad_authentication",
            "card_add_remove_and_reader_authentication",
            "per_door_rights_enforcement_and_denial",
            "user_card_crud_readback_and_delete_process",
        ]
    )

    def to_dict(self) -> dict[str, Any]:
        """Convert for JSON serialization after all inputs were sanitized."""
        return asdict(self)
