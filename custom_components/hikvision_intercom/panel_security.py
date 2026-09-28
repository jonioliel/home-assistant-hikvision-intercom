"""Connection-bound idle locks and fresh local-provider authentication, including MFA."""

from __future__ import annotations

import time
from typing import Any

from .access.models import AccessError
from .access.workflows import Workflows
from .const import DOMAIN


class PanelSecurity:
    def __init__(self, hass: Any, workflows: Workflows) -> None:
        self.hass = hass
        self.workflows = workflows
        self.sessions: dict[Any, dict[str, Any]] = {}

    def session(self, connection: Any) -> dict[str, Any]:
        current = self.sessions.get(connection)
        actor = connection.user.id
        if not current or current["actor"] != actor:
            current = {
                "actor": actor,
                "last_activity": time.monotonic(),
                "elevated_until": 0.0,
                "locked": bool(self.workflows.data["settings"]["idle_minutes"]),
                "flow_id": None,
                "flow_until": 0.0,
            }
            self.sessions[connection] = current

            # ActiveConnection uses slots without __weakref__. Its subscription cleanup
            # is the supported connection-lifetime hook; no session survives reconnect.
            def release() -> None:
                session = self.sessions.pop(connection, None)
                if session and session["flow_id"]:
                    try:
                        self.hass.auth.login_flow.async_abort(session["flow_id"])
                    except Exception:
                        pass  # A previously expired authentication flow needs no cleanup.

            connection.subscriptions[f"{DOMAIN}:panel-security"] = release
        minutes = self.workflows.data["settings"]["idle_minutes"]
        if minutes and time.monotonic() - current["last_activity"] >= minutes * 60:
            current["locked"] = True
            current["elevated_until"] = 0.0
        return current

    def public(self, connection: Any) -> dict[str, Any]:
        current = self.session(connection)
        return {
            "locked": current["locked"],
            "idle_minutes": self.workflows.data["settings"]["idle_minutes"],
            "reauth_sensitive": self.workflows.data["settings"]["reauth_sensitive"],
            "elevated": time.monotonic() < current["elevated_until"],
        }

    def guard(self, connection: Any, command: str, sensitive: bool) -> None:
        current = self.session(connection)
        if command.startswith("security/") or command == "authorization/session":
            return
        if current["locked"]:
            raise AccessError("screen_locked")
        if (
            sensitive
            and self.workflows.data["settings"]["reauth_sensitive"]
            and time.monotonic() >= current["elevated_until"]
        ):
            raise AccessError("reauth_required")

    async def dispatch(self, connection: Any, command: str, msg: dict[str, Any]) -> dict[str, Any]:
        current = self.session(connection)
        if command == "security/session":
            return self.public(connection)
        if command == "security/touch":
            if not current["locked"]:
                current["last_activity"] = time.monotonic()
            return self.public(connection)
        if command == "security/lock":
            current.update(locked=True, elevated_until=0.0)
            return self.public(connection)
        if command == "security/reauth_start":
            # Cached browser login, trusted-network bypass and a refresh token are
            # deliberately insufficient proof of a fresh credential check.
            credentials = next(
                (
                    item
                    for item in connection.user.credentials
                    if item.auth_provider_type == "homeassistant" and not item.is_new
                ),
                None,
            )
            if credentials is None:
                raise AccessError("reauth_provider_unavailable")
            await self._abort(current)
            result = await self.hass.auth.login_flow.async_init(
                (credentials.auth_provider_type, credentials.auth_provider_id), context={}
            )
            current["username"] = credentials.data["username"]
            current["flow_until"] = time.monotonic() + 300
        elif command == "security/reauth_step":
            if (
                not current["flow_id"]
                or msg["flow_id"] != current["flow_id"]
                or time.monotonic() >= current["flow_until"]
            ):
                await self._abort(current)
                raise AccessError("reauth_expired")
            values = msg["values"]
            if (
                not isinstance(values, dict)
                or len(values) > 5
                or any(
                    not isinstance(k, str) or not isinstance(v, str) or len(v) > 512
                    for k, v in values.items()
                )
            ):
                raise AccessError("invalid_fields")
            if current.get("step") == "init":
                if set(values) != {"password"}:
                    raise AccessError("invalid_fields")
                values = {"username": current["username"], "password": values["password"]}
            result = await self.hass.auth.login_flow.async_configure(current["flow_id"], values)
        else:
            raise AccessError("unknown_command")
        kind = result["type"]
        if kind == "create_entry":
            credentials = result.get("result")
            owner = (
                await self.hass.auth.async_get_user_by_credentials(credentials)
                if credentials
                else None
            )
            current["flow_id"] = None
            if not owner or owner.id != current["actor"] or not owner.is_active:
                raise AccessError("reauth_failed")
            current.update(
                locked=False, last_activity=time.monotonic(), elevated_until=time.monotonic() + 300
            )
            return {"authenticated": True, **self.public(connection)}
        if kind != "form":
            current["flow_id"] = None
            raise AccessError("reauth_failed")
        current["flow_id"] = result["flow_id"]
        current["step"] = result["step_id"]
        fields = []
        for key, validator in result["data_schema"].schema.items():
            name = getattr(key, "schema", key)
            if name == "username":
                continue
            choices = getattr(validator, "container", None)
            fields.append(
                {"name": name, "choices": dict(choices) if isinstance(choices, dict) else None}
            )
        return {
            "authenticated": False,
            "flow_id": current["flow_id"],
            "fields": fields,
            "errors": list(result.get("errors", {}).values()),
        }

    async def _abort(self, current: dict[str, Any]) -> None:
        if current["flow_id"]:
            self.hass.auth.login_flow.async_abort(current["flow_id"])
            current["flow_id"] = None


def get_security(hass: Any) -> PanelSecurity | None:
    result: PanelSecurity | None = hass.data.get(DOMAIN, {}).get("panel_security")
    return result
