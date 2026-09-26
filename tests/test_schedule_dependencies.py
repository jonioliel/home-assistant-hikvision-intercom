"""Dependency evidence never implies ownership, free slots or effective access."""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from test_schedule_inventory import SETTINGS

from custom_components.hikvision_intercom.client.client import HikvisionClient
from custom_components.hikvision_intercom.client.schedule_dependencies import (
    inspect_dependencies,
    summarize,
    user_references,
)
from custom_components.hikvision_intercom.exceptions import HikvisionAuthError


def inventory(state="complete"):
    return {
        "checks": [
            {"kind": k, "state": state} for k in ("template", "weekly", "holiday_group", "holiday")
        ]
    }


def test_explicit_chain_includes_disabled_and_keeps_unknown_defaults():
    users = user_references(
        [
            {
                "name": "PRIVATE_NAME",
                "password": "PRIVATE_PIN",
                "employeeNo": "PRIVATE_ID",
                "RightPlan": [{"doorNo": 1, "planTemplateNo": "1,9"}],
            },
            {"RightPlan": []},
            {},
        ]
    )
    users.update(state="complete", error=None)
    rows = {
        "template": [{"id": 1, "enabled": False, "week": 2, "references": [3]}],
        "weekly": [{"id": 2, "enabled": False}],
        "holiday_group": [{"id": 3, "enabled": True, "references": [4]}],
        "holiday": [],
    }
    result = summarize(users, inventory("partial"), rows)
    assert result["users"]["implicit"] == 2 and result["users_checked"]
    assert not result["mapping_complete"] and not result["can_apply"]
    assert not result["ownership_checked"]
    assert result["checks"][0]["not_observed_ids"] == [9]
    assert result["checks"][1]["disabled"] == 1
    assert result["checks"][3]["not_observed_ids"] == [4]
    assert "PRIVATE" not in json.dumps(result)


@pytest.mark.parametrize(
    "plans",
    [
        False,
        {},
        "PRIVATE",
        [None],
        [{"doorNo": True, "planTemplateNo": "1"}],
        [{"doorNo": 1, "planTemplateNo": "1,1"}],
        [{"doorNo": 1, "planTemplateNo": "1,"}],
        [{"doorNo": 1, "planTemplateNo": "０１"}],
        [{"doorNo": 1, "planTemplateNo": "1"}, {"doorNo": 1, "planTemplateNo": "2"}],
        [{"doorNo": 1, "planTemplateNo": "1"}, {"doorNo": 2, "planTemplateNo": "PRIVATE"}],
    ],
)
def test_malformed_assignment_does_not_keep_partial_reference(plans):
    result = user_references([{"RightPlan": plans}])
    assert result["malformed"] == 1 and result["references"] == set()


def test_public_id_lists_are_bounded_without_losing_counts():
    users = user_references(
        [{"RightPlan": [{"doorNo": 1, "planTemplateNo": ",".join(map(str, range(1, 101)))}]}]
    )
    users.update(state="complete", error=None)
    report = summarize(users, inventory(), {})
    assert report["checks"][0]["not_observed"] == 100
    assert len(report["checks"][0]["not_observed_ids"]) == 20


async def test_reads_only_user_search_and_redacts_failed_read():
    with (
        patch(
            "custom_components.hikvision_intercom.client.schedule_dependencies.inspect_inventory",
            AsyncMock(return_value=inventory()),
        ),
        patch(
            "custom_components.hikvision_intercom.client.schedule_dependencies.AccessClient"
        ) as access,
    ):
        access.return_value.async_capabilities = AsyncMock()
        access.return_value._search = AsyncMock(return_value=[{"RightPlan": []}])
        async with httpx.AsyncClient() as session:
            client = HikvisionClient(session, SETTINGS)
            result = await inspect_dependencies(client)
            assert result["users"]["implicit"] == 1
            access.return_value._search.assert_awaited_once_with("UserInfo")
            access.return_value._search.side_effect = HikvisionAuthError("PRIVATE_ERROR")
            result = await inspect_dependencies(client)
            assert not result["users_checked"] and result["users"]["read"] is None
            assert result["users"]["error"] == "authentication_failed"
            assert result["users"]["explicit"] is None
            assert all(c["referenced"] is None for c in result["checks"])
            assert "PRIVATE" not in json.dumps(result)
