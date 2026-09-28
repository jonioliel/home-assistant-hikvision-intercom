"""The shipped VMS handoff must describe the installed command registry and version."""

import json
from pathlib import Path

from tools.generate_panel_catalog import catalog


def test_vms_command_catalog_is_current():
    root = Path(__file__).resolve().parents[1]
    shipped = json.loads(
        (root / "docs/integrations/WISKEY_VMS_PANEL_COMMANDS.json").read_text(encoding="utf-8")
    )
    assert shipped == catalog(root), "Regenerate the VMS catalog after changing commands or version"
