from custom_components.smplwise_access_control.access.models import AccessError
from custom_components.smplwise_access_control.access.operations_report import query


def state():
    sync = {
        "u1/a": {
            "id": "11111111-1111-4111-8111-111111111111",
            "user_id": "11111111-1111-4111-8111-111111111112",
            "station_id": "a",
            "intent": "00" * 32,
            "queued_at": "2026-09-22T10:00:00+00:00",
            "updated_at": "2026-09-22T10:01:00+00:00",
            "state": "verified",
            "verified_at": "2026-09-22T10:01:00+00:00",
        },
        "u2/b": {
            "id": "22222222-2222-4222-8222-222222222222",
            "user_id": "22222222-2222-4222-8222-222222222223",
            "station_id": "b",
            "intent": "11" * 32,
            "queued_at": "2026-09-22T10:00:00+00:00",
            "updated_at": "2026-09-22T10:02:00+00:00",
            "state": "failed",
            "verified_at": None,
        },
    }
    return {
        "users": {},
        "bindings": {},
        "tombstones": {},
        "retired_cards": {},
        "retired_pins": {},
        "sync_operations": sync,
        "operation_receipts": {
            "import-1": {
                "operation_id": "import-1",
                "actor": "admin-a",
                "action": "bulk/csv_import",
                "saved_at": "2026-09-22T09:59:00+00:00",
                "user_ids": [
                    "11111111-1111-4111-8111-111111111112",
                    "22222222-2222-4222-8222-222222222223",
                ],
                "changed": 2,
                "stations": ["a", "b"],
            },
            "private": {
                "operation_id": "private",
                "actor": "admin-b",
                "action": "bulk/sync",
                "saved_at": "2026-09-22T09:59:00+00:00",
                "user_ids": ["11111111-1111-4111-8111-111111111112"],
                "changed": 1,
                "stations": ["a"],
            },
        },
    }


def test_query_groups_receipt_progress_and_hides_other_actors():
    report = query(state(), "admin-a", filters={}, offset=0, limit=50, snapshot="")
    assert report["total"] == 3
    grouped = next(row for row in report["records"] if row["id"] == "import-1")
    assert grouped["kind"] == "csv" and grouped["state"] == "failed"
    assert grouped["progress"] == {
        "total": 2,
        "pending": 0,
        "failed": 1,
        "verified": 1,
        "settled": 0,
    }
    assert "private" not in {row["id"] for row in report["records"]}
    assert "intent" not in str(report)


def test_query_filters_pages_and_marks_changed_snapshot():
    first = query(
        state(),
        "admin-a",
        filters={"kind": "sync", "state": "failed", "station_id": "b"},
        offset=0,
        limit=1,
        snapshot="old",
    )
    assert first["total"] == 1 and first["stale"]
    assert first["records"][0]["station_ids"] == ["b"]
    same = query(
        state(),
        "admin-a",
        filters={"kind": "sync", "state": "failed", "station_id": "b"},
        offset=99,
        limit=1,
        snapshot=first["snapshot"],
    )
    assert same["offset"] == 0 and not same["stale"]


def test_query_rejects_unbounded_or_unknown_filters():
    for filters in ({"kind": "secret"}, {"unknown": "x"}):
        try:
            query(state(), "admin-a", filters=filters, offset=0, limit=50, snapshot="")
        except AccessError as error:
            assert error.code == "invalid_fields"
        else:
            raise AssertionError("invalid operation query was accepted")
