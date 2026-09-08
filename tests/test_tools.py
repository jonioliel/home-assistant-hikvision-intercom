import json
import tomllib
import zipfile
from pathlib import Path

import pytest
from awesomeversion import AwesomeVersion

from custom_components.hikvision_intercom.const import VERSION
from custom_components.hikvision_intercom.models import CapabilityReport, ProbeRecord
from tools.prepare_release import release_metadata
from tools.probe_ds_kv6124 import argument_parser, main, save_report

ROOT = Path(__file__).resolve().parents[1]


def test_versions_and_hacs_layout():
    manifest = json.loads((ROOT / "custom_components/hikvision_intercom/manifest.json").read_text())
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert manifest["version"] == project["project"]["version"] == VERSION
    assert AwesomeVersion(VERSION).valid
    assert AwesomeVersion(VERSION).alpha
    assert manifest["codeowners"] == ["@jonioliel"]
    assert manifest["documentation"].endswith("/home-assistant-hikvision-intercom")
    assert json.loads((ROOT / "hacs.json").read_text()) == {
        "name": "Hikvision Intercom Manager",
        "homeassistant": "2026.9.1",
    }
    components = [
        p.name
        for p in (ROOT / "custom_components").iterdir()
        if p.is_dir() and p.name != "__pycache__"
    ]
    assert components == ["hikvision_intercom"]
    assert (
        (ROOT / "custom_components/hikvision_intercom/brand/icon.png")
        .read_bytes()
        .startswith(b"\x89PNG\r\n\x1a\n")
    )


def test_report_and_archive_round_trip(tmp_path):
    output = tmp_path / "capture"
    report = CapabilityReport(
        records=[
            ProbeRecord(
                "call_status",
                "GET",
                "/ISAPI/VideoIntercom/callStatus?format=json",
                payload={"CallStatus": {"callStatus": "synthetic_idle"}},
            )
        ]
    )
    save_report(report, output)
    data = json.loads((output / "capability_report.json").read_text())
    assert data["features"]["remote_unlock"] is None
    assert data["identity"]["serial"] == "REDACTED"
    with zipfile.ZipFile(output / "share_with_codex.zip") as archive:
        assert set(archive.namelist()) == {
            "capability_report.json",
            "README.txt",
            "fixtures/call_status.json",
        }
        assert json.loads(archive.read("capability_report.json")) == data
    with pytest.raises(FileExistsError):
        save_report(report, output)


def test_release_gate_requires_dedicated_version_notes(tmp_path):
    integration = tmp_path / "custom_components/hikvision_intercom"
    integration.mkdir(parents=True)
    (integration / "manifest.json").write_text('{"version":"0.1.0-alpha.1"}')
    (tmp_path / "pyproject.toml").write_text('[project]\nversion = "0.1.0-alpha.1"\n')
    (tmp_path / "CHANGELOG.md").write_text("## [Unreleased]\nWork in progress.\n")
    with pytest.raises(ValueError, match="changelog"):
        release_metadata(tmp_path)
    (tmp_path / "CHANGELOG.md").write_text(
        "## [Unreleased]\n\n## [0.1.0-alpha.1] - 2026-09-07\n### Added\n- Probe.\n"
    )
    assert release_metadata(tmp_path) == ("0.1.0-alpha.1", "### Added\n- Probe.\n")
    (integration / "manifest.json").write_text('{"version":"0.1.1"}')
    with pytest.raises(ValueError, match="differ"):
        release_metadata(tmp_path)


def test_no_password_or_mutation_cli_option():
    parser = argument_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--password", "do-not-accept"])
    with pytest.raises(SystemExit):
        parser.parse_args(["--unlock", "1"])


def test_cli_reports_sanitized_failure(monkeypatch, tmp_path, capsys):
    async def fake_execute(*_):
        report = CapabilityReport()
        report.observations["scan_stopped"] = "authentication_or_permission_failure"
        return report

    monkeypatch.setenv("HIKVISION_PASSWORD", "PRIVATE-PASSWORD")
    monkeypatch.setattr("tools.probe_ds_kv6124.execute", fake_execute)
    result = main(
        ["--host", "example.test", "--username", "admin", "--output", str(tmp_path / "capture")]
    )
    assert result == 2
    assert "PRIVATE-PASSWORD" not in capsys.readouterr().out
    assert (tmp_path / "capture/share_with_codex.zip").exists()


def test_cli_success_and_output_no_overwrite(monkeypatch, tmp_path):
    async def fake_execute(*_):
        return CapabilityReport(
            records=[
                ProbeRecord(
                    "device_info",
                    "GET",
                    "/ISAPI/System/deviceInfo",
                    outcome="observed",
                    payload={"DeviceInfo": {"model": "DS-KV6124-E1"}},
                )
            ]
        )

    monkeypatch.setenv("HIKVISION_PASSWORD", "PRIVATE-PASSWORD")
    monkeypatch.setattr("tools.probe_ds_kv6124.execute", fake_execute)
    args = ["--host", "example.test", "--username", "admin", "--output", str(tmp_path / "capture")]
    assert main(args) == 0
    assert main(args) == 2


@pytest.mark.parametrize("failure", [OSError("PRIVATE"), EOFError("PRIVATE")])
def test_cli_never_echoes_raw_exception(monkeypatch, capsys, failure):
    def fail(_):
        raise failure

    monkeypatch.setattr("builtins.input", fail)
    assert main([]) == 2
    assert "PRIVATE" not in capsys.readouterr().err
