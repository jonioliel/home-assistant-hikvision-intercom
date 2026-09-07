"""Normalized errors; never attach device bodies, URLs, or credentials."""


class HikvisionError(Exception):
    """Base protocol failure."""


class HikvisionAuthError(HikvisionError):
    """Authentication or authorization failed."""


class HikvisionConnectionError(HikvisionError):
    """Transport connection failed."""


class HikvisionTimeoutError(HikvisionError):
    """A bounded request timed out."""


class HikvisionUnsupportedError(HikvisionError):
    """The device explicitly rejected an unsupported operation."""


class HikvisionValidationError(HikvisionError):
    """Input or response was invalid."""


class HikvisionConflictError(HikvisionError):
    """The device reported a conflict."""


class HikvisionCapacityError(HikvisionError):
    """The device reported capacity exhaustion."""


class HikvisionDeviceError(HikvisionError):
    """The device reported an otherwise unclassified failure."""
