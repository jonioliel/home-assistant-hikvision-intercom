"""Approval commands through the real infrastructure auth and WebSocket boundary."""

import json
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.auth.const import GROUP_ID_ADMIN

from custom_components.hikvision_intercom.const import DOMAIN


async def request(client, route, **data):
    await client.send_json_auto_id({"type": f"{DOMAIN}/{route}", **data})
    return await client.receive_json()


async def reviewer_client(hass, hass_ws_client):
    user = await hass.auth.async_create_user("Second operator", group_ids=[GROUP_ID_ADMIN])
    refresh = await hass.auth.async_create_refresh_token(
        user, client_id="https://ordered-tests.invalid"
    )
    token = hass.auth.async_create_access_token(refresh)
    return user, await hass_ws_client(hass, access_token=token)


async def enable_approval(hass):
    await hass.data[DOMAIN]["workflows"].update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )


@pytest.mark.parametrize("revoked", [False, True])
async def test_csv_job_requires_a_current_second_admin_and_an_explicit_resume(
    hass, loaded_entry, hass_ws_client, device_io, revoked
):
    owner = await hass_ws_client(hass)
    await enable_approval(hass)
    raw = "employee_no,display_name,pin\n9821,Approved import,837261\n"
    mapping = {key: key for key in ("employee_no", "display_name", "pin")}
    preview = await request(owner, "users/csv_preview", csv=raw, mode="create", column_map=mapping)
    assert preview["success"], preview
    created = await request(
        owner,
        "jobs/csv_create",
        content=raw,
        mode="create",
        review_token=preview["result"]["review_token"],
        column_map=mapping,
        confirmed=True,
    )
    assert created["success"], created
    job = created["result"]
    denied = await request(
        owner, "jobs/action", job_id=job["id"], revision=job["revision"], action="resume"
    )
    assert denied["error"]["code"] == "approval_required"
    pending = await request(
        owner,
        "jobs/approval_request",
        job_id=job["id"],
        revision=job["revision"],
        action="resume",
        confirmed=True,
    )
    assert pending["success"], pending
    user, second = await reviewer_client(hass, hass_ws_client)
    review = await request(second, "jobs/approval_review", job_id=job["id"])
    assert review["success"] and not review["result"]["own_request"], review
    assert "837261" not in json.dumps(review)
    values = dict(
        job_id=job["id"],
        revision=pending["result"]["revision"],
        review_id=review["result"]["review_id"],
        approve=True,
        confirmed=True,
    )
    self_approve = await request(owner, "jobs/approval_decide", **values)
    assert self_approve["error"]["code"] == "separate_approver_required"
    approved = await request(second, "jobs/approval_decide", **values)
    assert approved["success"], approved
    repo = hass.data[DOMAIN]["access"].repository
    assert not repo.users()
    if revoked:
        await hass.auth.async_update_user(user, is_active=False)
    resumed = await request(
        owner,
        "jobs/action",
        job_id=job["id"],
        revision=approved["result"]["revision"],
        action="resume",
    )
    if revoked:
        assert resumed["error"]["code"] == "approval_required"
        assert not repo.users()
    else:
        assert resumed["success"], resumed
        jobs = hass.data[DOMAIN]["checkpoint_jobs"]
        if task := jobs.tasks.get(job["id"]):
            await task
        assert len(repo.users()) == 1 and repo.users()[0].pin.value == "837261"
    device_io["unlock"].assert_not_called()
    await second.close()
    await owner.close()
    await hass.async_block_till_done()


@pytest.mark.parametrize("revoked", [False, True])
async def test_fleet_approval_is_read_only_then_rechecked_before_write(
    hass, loaded_entry, hass_ws_client, revoked
):
    owner = await hass_ws_client(hass)
    await enable_approval(hass)
    observed = {
        "door": 1,
        "values": {"openDuration": 5},
        "constraints": {"openDuration": {"type": "integer", "min": 1, "max": 255}},
    }
    with (
        patch(
            "custom_components.hikvision_intercom.operations_api.read_configuration",
            AsyncMock(return_value=observed),
        ),
        patch(
            "custom_components.hikvision_intercom.technical_api.dispatch_technical", AsyncMock()
        ) as write,
    ):
        preview = await request(
            owner,
            "platform/config_preview",
            station_ids=[loaded_entry.entry_id],
            door=1,
            changes={"openDuration": 7},
        )
        assert preview["success"], preview
        token = preview["result"]["review_id"]
        user, second = await reviewer_client(hass, hass_ws_client)
        review = await request(second, "platform/config_review", review_id=token)
        assert review["success"], review
        values = dict(
            review_id=token,
            fingerprint=review["result"]["fingerprint"],
            approve=True,
            confirmed=True,
        )
        assert (await request(owner, "platform/config_decide", **values))["error"][
            "code"
        ] == "separate_approver_required"
        assert (await request(second, "platform/config_decide", **values))["success"]
        write.assert_not_called()
        if revoked:
            await hass.auth.async_update_user(user, is_active=False)
        result = await request(owner, "platform/config_apply", review_id=token, confirmed=True)
        if revoked:
            assert result["error"]["code"] == "approval_required"
            write.assert_not_called()
        else:
            assert result["success"], result
            assert result["result"]["receipts"][0]["state"] == "verified"
            write.assert_awaited_once()
            repeated = await request(
                owner, "platform/config_apply", review_id=token, confirmed=True
            )
            assert repeated["error"]["code"] == "approval_required"
            write.assert_awaited_once()
    await second.close()
    await owner.close()
    await hass.async_block_till_done()


async def test_foreground_csv_approval_uses_the_existing_csv_contract(
    hass, loaded_entry, hass_ws_client
):
    owner = await hass_ws_client(hass)
    await enable_approval(hass)
    raw = "employee_no,display_name,pin\n9822,Foreground import,836251\n"
    preview = await request(owner, "users/csv_preview", csv=raw, mode="create")
    assert preview["success"], preview
    submitted = await request(
        owner,
        "workflows/submit",
        command="users/csv_apply",
        values={"csv": raw, "mode": "create", "review_token": preview["result"]["review_token"]},
        label="Reviewed CSV",
    )
    assert submitted["success"], submitted
    assert "836251" not in json.dumps(submitted)
    _, second = await reviewer_client(hass, hass_ws_client)
    assert (
        await request(
            second, "workflows/decide", request_id=submitted["result"]["id"], approve=True
        )
    )["success"]
    result = await request(owner, "workflows/apply", request_id=submitted["result"]["id"])
    assert result["success"], result
    assert len(hass.data[DOMAIN]["access"].repository.users()) == 1
    await second.close()
    await owner.close()
    await hass.async_block_till_done()


@pytest.mark.parametrize(
    "command,values",
    [
        ("jobs/approval_review", {"job_id": "private"}),
        (
            "jobs/approval_request",
            {"job_id": "private", "revision": 1, "action": "resume", "confirmed": True},
        ),
        (
            "jobs/approval_decide",
            {
                "job_id": "private",
                "revision": 1,
                "review_id": "private",
                "approve": True,
                "confirmed": True,
            },
        ),
        ("platform/config_pending", {}),
        ("platform/config_review", {"review_id": "private"}),
        (
            "platform/config_decide",
            {"review_id": "private", "fingerprint": "private", "approve": True, "confirmed": True},
        ),
    ],
)
async def test_reader_cannot_access_approval_content(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, command, values
):
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await request(reader, command, **values)
    assert denied["error"]["code"] == "unauthorized"
