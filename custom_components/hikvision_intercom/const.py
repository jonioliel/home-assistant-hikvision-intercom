"""Shared integration constants."""

DOMAIN = "hikvision_intercom"
VERSION = "0.12.0-alpha.1"
PLATFORMS = ("binary_sensor", "sensor", "camera", "lock", "event")
DEFAULT_IDLE_INTERVAL = 2.0
DEFAULT_ACTIVE_INTERVAL = 0.75
DEFAULT_PULSE_SECONDS = 5.0
CALL_STATES = ("idle", "ringing", "in_call", "ending", "unknown", "unavailable")
