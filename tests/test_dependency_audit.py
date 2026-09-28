"""Infrastructure compatibility reviews must never hide unrelated findings."""

import json
from datetime import date
from pathlib import Path

import pytest

from tools.audit_dependencies import ROOT, assess, check_usage


def report(name="cryptography", version="48.0.1", identifier="PYSEC-2026-3552"):
    return {"dependencies": [{"name": name, "version": version, "vulns": [{"id": identifier}]}]}


def test_current_direct_usage_and_scoped_review():
    check_usage(ROOT)
    result = assess(report(), ROOT, date(2026, 9, 28))
    assert result["state"] == "passed_with_reviews"
    assert result["inventory"] == report()
    assert not result["blocking_findings"]


@pytest.mark.parametrize(
    "inventory,today",
    [
        (report(name="other-package"), date(2026, 9, 28)),
        (report(version="48.0.0"), date(2026, 9, 28)),
        (report(identifier="FUTURE-CVE"), date(2026, 9, 28)),
        (report(), date(2026, 11, 1)),
    ],
)
def test_review_fails_closed_for_wrong_package_version_id_or_expiry(inventory, today):
    result = assess(inventory, ROOT, today)
    assert result["state"] == "blocked"
    assert result["blocking_findings"]


def test_unreviewed_api_or_changed_pin_blocks_review(tmp_path):
    component = tmp_path / "custom_components/hikvision_intercom"
    component.mkdir(parents=True)
    manifest = component / "manifest.json"
    manifest.write_text(json.dumps({"requirements": ["cryptography==48.0.1"]}), encoding="utf-8")
    (component / "unsafe.py").write_text("from cryptography import x509", encoding="utf-8")
    with pytest.raises(ValueError, match="API"):
        assess(report(), tmp_path, date(2026, 9, 28))
    manifest.write_text(json.dumps({"requirements": ["cryptography==50.0.1"]}), encoding="utf-8")
    with pytest.raises(ValueError, match="pin"):
        assess(report(), tmp_path, date(2026, 9, 28))


@pytest.mark.parametrize("inventory", [{}, {"dependencies": []}, {"dependencies": [None]}])
def test_empty_or_malformed_scanner_output_is_never_a_pass(inventory):
    with pytest.raises(ValueError):
        assess(inventory, Path("."), date(2026, 9, 28))
