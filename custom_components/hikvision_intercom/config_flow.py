"""Connection, identity confirmation and an explicitly supervised relay mapping."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import selector

from .client.client import ConnectionSettings, HikvisionClient, StationProfile, create_session
from .clock import named_zone
from .configuration import managed_locks
from .const import DEFAULT_ACTIVE_INTERVAL, DEFAULT_IDLE_INTERVAL, DEFAULT_PULSE_SECONDS, DOMAIN
from .exceptions import (
    HikvisionAuthError,
    HikvisionError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)


async def async_validate_connection(hass: HomeAssistant, data: Mapping[str, Any]) -> StationProfile:
    settings = ConnectionSettings.from_mapping(data)
    session = await hass.async_add_executor_job(create_session, settings)
    try:
        return await HikvisionClient(session, settings).async_profile()
    finally:
        await session.aclose()


async def async_test_mapping(
    hass: HomeAssistant, data: Mapping[str, Any], unique_id: str, api_id: int
) -> None:
    settings = ConnectionSettings.from_mapping(data)
    session = await hass.async_add_executor_job(create_session, settings)
    try:
        client = HikvisionClient(session, settings, enabled_doors=frozenset({api_id}))
        identity, *_ = await client.async_device_info()
        if identity != unique_id:
            raise HikvisionValidationError("Intercom identity changed")
        await client.async_unlock(api_id)
    finally:
        await session.aclose()


def _connection_schema(data: Mapping[str, Any], *, existing: bool) -> vol.Schema:
    fields: dict[Any, Any] = {
        vol.Required("name", default=data.get("name", "Intercom")): vol.All(
            cv.string, vol.Length(min=1, max=64)
        ),
        vol.Required("host", default=data.get("host", vol.UNDEFINED)): cv.string,
        vol.Required("username", default=data.get("username", "admin")): cv.string,
        (vol.Optional("password") if existing else vol.Required("password")): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
        ),
        vol.Required("scheme", default=data.get("scheme", "http")): vol.In(["http", "https"]),
        vol.Required("port", default=data.get("port", 80)): cv.port,
        vol.Required("verify_ssl", default=data.get("verify_ssl", True)): cv.boolean,
        vol.Required("rtsp_port", default=data.get("rtsp_port", 554)): cv.port,
    }
    return vol.Schema(fields)


def _error_key(err: HikvisionError) -> str:
    if isinstance(err, HikvisionAuthError):
        return "invalid_auth"
    if isinstance(err, HikvisionUnsupportedError):
        return "unsupported_device"
    if isinstance(err, HikvisionValidationError):
        return "invalid_response"
    return "cannot_connect"


class HikvisionConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1
    MINOR_VERSION = 2

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}
        self._profile: StationProfile | None = None
        self._api_id: int | None = None
        self._test_acknowledged = False
        self._lock_name: str | None = None

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> HikvisionOptionsFlow:
        return HikvisionOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        return await self._async_connection("user", user_input)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if not self._data:
            entry = self._get_reconfigure_entry()
            self._data = dict(entry.data)
            self._data["name"] = entry.title
        return await self._async_connection("reconfigure", user_input)

    async def _async_connection(self, step: str, user_input: dict[str, Any] | None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {**self._data, **user_input}
            if step == "reconfigure" and not user_input.get("password"):
                data["password"] = self._get_reconfigure_entry().data["password"]
            try:
                profile = await async_validate_connection(self.hass, data)
            except HikvisionError as err:
                errors["base"] = _error_key(err)
            else:
                await self.async_set_unique_id(profile.unique_id)
                if step == "reconfigure":
                    self._abort_if_unique_id_mismatch()
                else:
                    self._abort_if_unique_id_configured()
                self._data, self._profile = data, profile
                return await self.async_step_confirm_device()
        return self.async_show_form(
            step_id=step,
            data_schema=_connection_schema(self._data, existing=step == "reconfigure"),
            errors=errors,
        )

    async def async_step_confirm_device(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        assert self._profile is not None
        if user_input is not None:
            return await self.async_step_locks()
        return self.async_show_form(
            step_id="confirm_device",
            data_schema=vol.Schema({}),
            description_placeholders={
                "model": self._profile.model,
                "firmware": self._profile.firmware,
                "serial": self._profile.serial or "MAC identity",
            },
        )

    async def async_step_locks(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        assert self._profile is not None
        errors: dict[str, str] = {}
        choices = ["camera_only"]
        if self._profile.api_door_ids:
            choices.append("map_active_relay")
        try:
            previous = managed_locks(self._data)
        except HikvisionValidationError:
            previous = ()
        if previous and previous[0].api_id in self._profile.api_door_ids:
            choices.append("keep_confirmed_mapping")
        if user_input is not None:
            if "lock_name" in user_input:
                self._lock_name = user_input["lock_name"].strip()
            choice = user_input["mode"]
            if choice == "camera_only":
                manager = self.hass.data.get(DOMAIN, {}).get("access")
                entry_id = self.context.get("entry_id")
                if manager is not None and entry_id and manager.has_access(entry_id):
                    errors["base"] = "access_removal_pending"
                else:
                    self._data["locks"] = []
                    return self._finish()
            if choice == "keep_confirmed_mapping" and choice in choices:
                return self._finish()
            if choice == "map_active_relay" and choice in choices:
                return await self.async_step_mapping()
        return self.async_show_form(
            step_id="locks",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Required("mode"): selector.SelectSelector(
                        selector.SelectSelectorConfig(options=choices, translation_key="lock_mode")
                    ),
                    vol.Optional(
                        "lock_name",
                        default=self._lock_name
                        if self._lock_name is not None
                        else (previous[0].name or "")
                        if previous
                        else "",
                    ): vol.All(cv.string, vol.Length(max=64)),
                }
            ),
        )

    async def async_step_mapping(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        assert self._profile is not None
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input.get("test_unlock") is not True:
                errors["base"] = "test_required"
            else:
                api_id = user_input["api_id"]
                if type(api_id) is not int or api_id not in self._profile.api_door_ids:
                    errors["base"] = "invalid_mapping"
                else:
                    self._test_acknowledged = False
                    try:
                        await async_test_mapping(
                            self.hass, self._data, self._profile.unique_id, api_id
                        )
                    except HikvisionError:
                        errors["base"] = "unlock_failed"
                    else:
                        self._api_id = api_id
                        self._test_acknowledged = True
                        return await self.async_step_confirm_mapping()
        return self.async_show_form(
            step_id="mapping",
            data_schema=vol.Schema(
                {
                    vol.Required("api_id"): vol.In(self._profile.api_door_ids),
                    vol.Required("test_unlock", default=False): cv.boolean,
                }
            ),
            errors=errors,
        )

    async def async_step_confirm_mapping(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input["result"] == "choose_again":
                self._test_acknowledged = False
                return await self.async_step_mapping()
            if user_input["result"] == "camera_only":
                return await self.async_step_locks({"mode": "camera_only"})
            if (
                user_input["result"] == "released_and_returned"
                and self._test_acknowledged
                and self._api_id is not None
            ):
                self._data["locks"] = [
                    {"physical_index": 1, "api_id": self._api_id, "confirmed": True}
                ]
                return self._finish()
            errors["base"] = "confirmation_required"
        return self.async_show_form(
            step_id="confirm_mapping",
            data_schema=vol.Schema(
                {
                    vol.Required("result"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=["released_and_returned", "choose_again", "camera_only"],
                            translation_key="mapping_result",
                        )
                    )
                }
            ),
            errors=errors,
        )

    @callback
    def _finish(self) -> FlowResult:
        if self._data.get("locks") and self._lock_name is not None:
            lock = dict(self._data["locks"][0])
            if self._lock_name:
                lock["name"] = self._lock_name
            else:
                lock.pop("name", None)
            self._data["locks"] = [lock]
        managed_locks(self._data)
        if self.source == config_entries.SOURCE_RECONFIGURE:
            return self.async_update_reload_and_abort(
                self._get_reconfigure_entry(), title=self._data["name"], data=self._data
            )
        return self.async_create_entry(title=self._data["name"], data=self._data)

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> FlowResult:
        self._data = dict(entry_data)
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {**self._data, **user_input}
            try:
                profile = await async_validate_connection(self.hass, data)
            except HikvisionError as err:
                errors["base"] = _error_key(err)
            else:
                await self.async_set_unique_id(profile.unique_id)
                self._abort_if_unique_id_mismatch()
                return self.async_update_reload_and_abort(
                    self._get_reauth_entry(), data_updates=user_input
                )
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "username", default=self._data.get("username", "admin")
                    ): cv.string,
                    vol.Required("password"): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )


class HikvisionOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                if user_input.get("display_time_zone", "device") == "manual":
                    await self.hass.async_add_executor_job(
                        named_zone, user_input.get("manual_time_zone")
                    )
            except HikvisionValidationError:
                errors["manual_time_zone"] = "invalid_time_zone"
            else:
                return self.async_create_entry(
                    title="", data={**self.config_entry.options, **user_input}
                )
        options = {**self.config_entry.options, **(user_input or {})}
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "display_time_zone", default=options.get("display_time_zone", "device")
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=["device", "manual"], translation_key="display_time_zone"
                        )
                    ),
                    vol.Optional(
                        "manual_time_zone",
                        default=options.get("manual_time_zone", self.hass.config.time_zone),
                    ): cv.string,
                    vol.Required(
                        "idle_interval", default=options.get("idle_interval", DEFAULT_IDLE_INTERVAL)
                    ): vol.All(vol.Coerce(float), vol.Range(min=1.5, max=30)),
                    vol.Required(
                        "active_interval",
                        default=options.get("active_interval", DEFAULT_ACTIVE_INTERVAL),
                    ): vol.All(vol.Coerce(float), vol.Range(min=0.5, max=1)),
                    vol.Required(
                        "pulse_seconds", default=options.get("pulse_seconds", DEFAULT_PULSE_SECONDS)
                    ): vol.All(vol.Coerce(float), vol.Range(min=1, max=30)),
                }
            ),
            errors=errors,
        )
