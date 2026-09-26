"""Serve the WisKey panel; its API enforces per-user permissions."""

from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION


async def async_setup_panel(hass: HomeAssistant) -> None:
    if hass.data[DOMAIN].get("panel_registered"):
        return
    path = Path(__file__).parent / "frontend" / "panel.js"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig("/smplwise_access_control_static/panel.js", str(path), True),
            StaticPathConfig(
                "/smplwise_access_control_static/Heebo.ttf", str(path.with_name("Heebo.ttf")), True
            ),
            StaticPathConfig(
                "/smplwise_access_control_static/audio-worklet.js",
                str(path.with_name("audio-worklet.js")),
                True,
            ),
        ]
    )
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path="smplwise-access-control",
        webcomponent_name="smplwise-access-control-panel",
        sidebar_title="WisKey",
        sidebar_icon="mdi:doorbell-video",
        module_url=f"/smplwise_access_control_static/panel.js?v={VERSION}",
        require_admin=False,
        embed_iframe=False,
        trust_external=False,
    )
    hass.data[DOMAIN]["panel_registered"] = True
