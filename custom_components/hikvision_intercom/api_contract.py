"""Explicit panel API compatibility, independent of product release numbering."""

from .access.models import AccessError

API_VERSION = 1
MIN_CLIENT = 0  # Legacy clients remain compatible with the existing command shapes.
CAPABILITIES = [
    "employee_phone",
    "talk_mode",
    "event_portraits",
    "sync_tracking",
    "user_timing_draft",
    "user_timing_enforcement",
    "whatsapp_templates",
    "panel_permissions",
]


def contract(commands: list[str]) -> dict:
    return {
        "version": API_VERSION,
        "min_client": MIN_CLIENT,
        "capabilities": CAPABILITIES,
        "commands": sorted(commands),
    }


READ_COMMANDS = frozenset(
    {
        "authorization/session",
        "authorization/settings_get",
        "overview",
        "stations/list",
        "stations/get",
        "stations/inventory",
        "users/list",
        "users/get",
        "sync/status",
        "sync/diagnostics",
        "events/list",
        "events/detail",
        "events/support",
        "events/report",
        "events/export",
        "events/print",
        "events/trace_get",
        "users/photo_get",
        "whatsapp/templates_get",
        "media/settings_get",
        "profiles/settings_get",
        "health/get",
        "acceptance/get",
        "conflicts/list",
        "users/bulk_receipt",
        "users/bulk_receipts",
        "audit/list",
        "audit/export",
        "users/csv_export",
        "permissions/directory",
        "schedules/list",
        "schedules/export",
        "schedules/plan_list",
        "schedules/plan_export",
        "schedules/operations_list",
        "schedules/operations_export",
        "cards/capture_status",
        "cards/capture_cancel",
        "events/trace_stop",
    }
)


def validate_client(value: object = 0, *, command: str = "") -> None:
    if command in READ_COMMANDS:
        return
    if type(value) is not int or not MIN_CLIENT <= value <= API_VERSION:
        raise AccessError("api_incompatible")
