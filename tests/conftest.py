"""HA adapter tests run in the dedicated Linux/Python 3.14 environment."""

import importlib.util

collect_ignore = ["ha"] if importlib.util.find_spec("homeassistant") is None else []
