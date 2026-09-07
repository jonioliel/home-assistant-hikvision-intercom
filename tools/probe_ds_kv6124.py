"""Run read-only Phase 0 probes; enter the password at the hidden prompt."""

import argparse
import asyncio
import getpass
import json
import logging
import os
import sys
import time
import warnings
import zipfile
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import httpx

from custom_components.hikvision_intercom.client.probe import (
    ENDPOINTS,
    ProbeClient,
    ProbeLimits,
)
from custom_components.hikvision_intercom.client.transport import LimitedTransport
from custom_components.hikvision_intercom.exceptions import HikvisionError, HikvisionValidationError
from custom_components.hikvision_intercom.models import CapabilityReport


def argument_parser() -> argparse.ArgumentParser:
    """No password argument, arbitrary endpoint, write mode or unlock mode exists."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", help="Station IP or hostname; prompted if omitted")
    parser.add_argument("--username", help="Device login; prompted if omitted")
    parser.add_argument("--scheme", choices=("http", "https"), default="http")
    parser.add_argument("--http-port", type=int, help="Defaults to 80 or 443 for the scheme")
    parser.add_argument("--rtsp-port", type=int, default=554, help="Recorded only; RTSP is manual")
    parser.add_argument(
        "--insecure", action="store_true", help="Disable HTTPS certificate verification"
    )
    parser.add_argument(
        "--timeout", type=float, default=10, help="Total seconds per ordinary request"
    )
    parser.add_argument(
        "--stream-seconds", type=float, default=4, help="Total alert stream seconds"
    )
    parser.add_argument("--page-size", type=int, default=10)
    parser.add_argument("--max-pages", type=int, default=3)
    parser.add_argument(
        "--call-seconds", type=float, default=0, help="Optional bell capture, max 300 s"
    )
    parser.add_argument(
        "--call-interval", type=float, default=1, help="Call polling interval, min 0.5 s"
    )
    parser.add_argument(
        "--remote-capabilities-exposed",
        action="store_true",
        help="Read door capabilities only after the station is known to expose it",
    )
    parser.add_argument(
        "--extended", action="store_true", help="Read system/access/credential/stream capabilities"
    )
    parser.add_argument("--output", type=Path, help="New output directory (never overwrites)")
    return parser


def save_report(report: CapabilityReport, directory: Path) -> None:
    """Write only sanitized objects, in a new directory; called outside the event loop."""
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    (directory / ".gitignore").write_text("*\n", encoding="utf-8")
    fixtures = directory / "fixtures"
    fixtures.mkdir(mode=0o700)
    serialized = json.dumps(report.to_dict(), ensure_ascii=False, indent=2) + "\n"
    (directory / "capability_report.json").write_text(serialized, encoding="utf-8")
    for record in report.records:
        (fixtures / f"{record.name}.json").write_text(
            json.dumps(asdict(record), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    (directory / "README.txt").write_text(
        "Phase 0 device evidence. Response payloads are normalized and sanitized.\n"
        "Unknown values are REDACTED. No image bytes, credentials or raw responses are saved.\n"
        "users/cards mean read support only. RTSP, PIN, rights and relay mapping remain manual.\n"
        "Review the JSON files locally before sharing share_with_codex.zip.\n",
        encoding="utf-8",
    )
    with zipfile.ZipFile(directory / "share_with_codex.zip", "x", zipfile.ZIP_DEFLATED) as archive:
        for path in (
            directory / "capability_report.json",
            directory / "README.txt",
            *fixtures.iterdir(),
        ):
            archive.write(path, path.relative_to(directory))


async def capture_calls(
    client: ProbeClient, report: CapabilityReport, seconds: float, interval: float
) -> None:
    """Capture raw state values; a human correlates the timeline with bell actions."""
    endpoint = next(item for item in ENDPOINTS if item.name == "call_status")
    started = time.monotonic()
    timeline = []
    index = 0
    try:
        async with asyncio.timeout(seconds):
            while True:
                offset = round(time.monotonic() - started, 3)
                record = await client.probe(endpoint)
                record.name = f"call_sample_{index:04d}"
                report.records.append(record)
                timeline.append({"offset_seconds": offset, "fixture": record.name})
                if record.error == "HikvisionAuthError":
                    break
                index += 1
                await asyncio.sleep(interval)
    except TimeoutError:
        pass
    report.observations["call_timeline"] = timeline


async def execute(
    args: argparse.Namespace, host: str, username: str, password: str
) -> CapabilityReport:
    """No environment proxy, redirects, implicit retry or connection to RTSP."""
    limits = ProbeLimits(
        request_seconds=args.timeout,
        stream_seconds=args.stream_seconds,
        page_size=args.page_size,
        max_pages=args.max_pages,
    )
    if not 1 <= args.rtsp_port <= 65535:
        raise HikvisionValidationError("Invalid RTSP port")
    if not 0 <= args.call_seconds <= 300 or not 0.5 <= args.call_interval <= 10:
        raise HikvisionValidationError("Invalid call capture duration or interval")
    transport = LimitedTransport(
        httpx.AsyncHTTPTransport(
            verify=not args.insecure,
            retries=0,
            trust_env=False,
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=1),
        ),
        limits.max_bytes,
    )
    async with httpx.AsyncClient(transport=transport, trust_env=False) as session:
        client = ProbeClient(
            session,
            host=host,
            username=username,
            password=password,
            scheme=args.scheme,
            port=args.http_port or (443 if args.scheme == "https" else 80),
            limits=limits,
        )
        report = await client.run(
            remote_capabilities_exposed=args.remote_capabilities_exposed, extended=args.extended
        )
        report.observations["rtsp_port_not_probed"] = args.rtsp_port
        if args.call_seconds and "scan_stopped" not in report.observations:
            print(
                "Bell capture started: idle, press bell, answer, end; note the timing.", flush=True
            )
            await capture_calls(client, report, args.call_seconds, args.call_interval)
    return report


def main(argv: list[str] | None = None) -> int:
    """Interactive commissioning entrypoint; errors never echo device values."""
    args = argument_parser().parse_args(argv)
    for logger in ("httpx", "httpcore"):
        logging.getLogger(logger).disabled = True
    try:
        host = args.host or input("Station IP/hostname: ").strip()
        username = args.username or input("Device username: ").strip()
        password = os.environ.get("HIKVISION_PASSWORD")
        if password is None:
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                password = getpass.getpass("Device password (hidden): ")
        if not host or not username or not password:
            raise HikvisionValidationError("Host and credentials are required")
        output = args.output or Path("probe-output") / datetime.now(UTC).strftime(
            "%Y%m%dT%H%M%S%fZ"
        )
        if output.exists():
            print("Output directory already exists. Choose a new directory.", file=sys.stderr)
            return 2
        print("Starting bounded read-only probes. No configuration or relay writes.", flush=True)
        report = asyncio.run(execute(args, host, username, password))
        save_report(report, output)
        print(
            "Saved capability_report.json, fixtures/ and share_with_codex.zip in the output folder."
        )
        if "scan_stopped" in report.observations:
            print("Stopped on authentication/permission failure; review the sanitized report.")
            return 2
        identity = next((r for r in report.records if r.name == "device_info"), None)
        return 0 if identity and identity.outcome == "observed" else 2
    except (HikvisionError, OSError, EOFError, getpass.GetPassWarning) as error:
        print(
            f"Probe could not complete ({type(error).__name__}); no raw error details exported.",
            file=sys.stderr,
        )
        return 2
    except KeyboardInterrupt:
        print("Probe cancelled; no device writes were performed.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
