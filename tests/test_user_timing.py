"""User-local timing proposals cannot silently become station access rights."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.csv_transfer import desired_fields
from custom_components.hikvision_intercom.access.models import AccessError, build_user
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.user_timing import timing_draft


def weekly():
    return {
        "mode": "weekly",
        "timezone": "Asia/Jerusalem",
        "days": ["Thursday", "Monday"],
        "dates": [],
        "periods": [{"start": "12:00", "end": "18:00"}],
    }


@pytest.mark.parametrize(
    "patch",
    [
        {"days": []},
        {"days": ["Monday", "Monday"]},
        {"days": [None]},
        {"timezone": "Unknown/Nowhere"},
        {"mode": "enabled"},
        {"periods": []},
        {"periods": [{"start": "18:00", "end": "12:00"}]},
        {"periods": [{"start": "12:00", "end": "18:00"}, {"start": "17:00", "end": "19:00"}]},
        {"dates": ["2026-09-16"]},
        {"enabled": True},
    ],
)
def test_reject_invalid_or_activation_fields(patch):
    with pytest.raises(AccessError):
        timing_draft({**weekly(), **patch})


def test_dates_all_day_are_inclusive_calendar_days_not_utc_offsets():
    result = timing_draft(
        {
            **weekly(),
            "mode": "dates",
            "days": [],
            "dates": ["2026-10-25", "2026-03-27"],
            "periods": [{"start": "00:00", "end": "24:00"}],
        }
    )
    assert result["dates"] == ["2026-03-27", "2026-10-25"]
    assert result["timezone"] == "Asia/Jerusalem"
    for dates in [["2026-02-30"], ["2026-09-16"] * 2]:
        with pytest.raises(AccessError):
            timing_draft({**result, "dates": dates})


async def test_draft_roundtrip_patch_and_clear_do_not_change_enforced_rights():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    user = await repo.async_create(
        {
            "display_name": "Cleaner",
            "employee_no": "103",
            "assignments": {"station": {"allowed_locks": [1]}},
        }
    )
    proposed = await repo.async_update(
        user.id, {"access_timing_draft": weekly()}, expected_revision=user.revision
    )
    assert desired_fields(proposed) == desired_fields(user)
    assert proposed.access_timing_draft["days"] == ["Monday", "Thursday"]
    saved = repo.snapshot()
    restored = AccessRepository(AsyncMock())
    await restored.async_load(deepcopy(saved))
    record = restored.get(user.id)
    assert record.access_timing_draft == proposed.access_timing_draft
    patched = build_user(
        {"display_name": "New name"},
        employee_no=user.employee_no,
        now=user.updated_at,
        previous=record,
    )
    assert patched.access_timing_draft == proposed.access_timing_draft
    cleared = build_user(
        {"access_timing_draft": None},
        employee_no=user.employee_no,
        now=user.updated_at,
        previous=record,
    )
    assert cleared.access_timing_draft is None
    assert desired_fields(cleared) == desired_fields(user)
