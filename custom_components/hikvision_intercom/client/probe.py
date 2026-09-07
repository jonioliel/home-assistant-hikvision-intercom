"""Read-only ISAPI probe, never a general request/command API."""

import asyncio
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from ..exceptions import (
    HikvisionAuthError,
    HikvisionConnectionError,
    HikvisionDeviceError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)
from ..models import CapabilityReport, ProbeRecord
from .parser import check_response_status, find_values, parse_payload
from .redaction import REDACTED, safe_headers, safe_namespaces, sanitize


@dataclass(frozen=True, slots=True)
class ProbeEndpoint:
    """An immutable entry in the fixed reconnaissance allowlist."""

    name: str
    path: str
    method: str = "GET"
    search_root: str | None = None
    mode: str = "structured"


ENDPOINTS = (
    ProbeEndpoint("device_info", "/ISAPI/System/deviceInfo"),
    ProbeEndpoint("video_capabilities", "/ISAPI/VideoIntercom/capabilities"),
    ProbeEndpoint("call_status", "/ISAPI/VideoIntercom/callStatus?format=json"),
    ProbeEndpoint("work_status", "/ISAPI/VideoIntercom/WorkStatus"),
    ProbeEndpoint("send_card_capabilities", "/ISAPI/VideoIntercom/SendCardCfg/capabilities"),
    ProbeEndpoint("user_count", "/ISAPI/AccessControl/UserInfo/Count?format=json"),
    ProbeEndpoint(
        "user_search",
        "/ISAPI/AccessControl/UserInfo/Search?format=json",
        "POST",
        "UserInfoSearchCond",
    ),
    ProbeEndpoint("card_count", "/ISAPI/AccessControl/CardInfo/Count?format=json"),
    ProbeEndpoint(
        "card_search",
        "/ISAPI/AccessControl/CardInfo/Search?format=json",
        "POST",
        "CardInfoSearchCond",
    ),
    ProbeEndpoint(
        "access_event_capabilities",
        "/ISAPI/AccessControl/AcsEventTotalNum/capabilities?format=json",
    ),
    ProbeEndpoint("snapshot", "/ISAPI/Streaming/channels/101/picture", mode="snapshot"),
    ProbeEndpoint("alert_stream", "/ISAPI/Event/notification/alertStream", mode="stream"),
)
READ_CAPABILITIES = (
    ProbeEndpoint("system_capabilities", "/ISAPI/System/capabilities"),
    ProbeEndpoint("access_capabilities", "/ISAPI/AccessControl/capabilities"),
    ProbeEndpoint("user_capabilities", "/ISAPI/AccessControl/UserInfo/capabilities?format=json"),
    ProbeEndpoint("card_capabilities", "/ISAPI/AccessControl/CardInfo/capabilities?format=json"),
    ProbeEndpoint("stream_channel_101", "/ISAPI/Streaming/channels/101"),
    ProbeEndpoint(
        "pin_mode_capabilities",
        "/ISAPI/AccessControl/UserAndRight/PwMgrParams/capabilities?format=json",
    ),
    ProbeEndpoint("pin_mode", "/ISAPI/AccessControl/UserAndRight/PwMgrParams?format=json"),
)
REMOTE_CAPABILITIES = ProbeEndpoint(
    "remote_capabilities", "/ISAPI/AccessControl/RemoteControl/door/capabilities"
)


@dataclass(frozen=True, slots=True)
class ProbeLimits:
    """Hard ceilings apply even to a peer that never stops sending data."""

    request_seconds: float = 10
    stream_seconds: float = 4
    max_bytes: int = 1_048_576
    page_size: int = 10
    max_pages: int = 3

    def __post_init__(self) -> None:
        if not 0 < self.request_seconds <= 60 or not 0 < self.stream_seconds <= 30:
            raise HikvisionValidationError("Invalid request or stream deadline")
        if not 256 <= self.max_bytes <= 4_194_304:
            raise HikvisionValidationError("Invalid response size limit")
        if not 1 <= self.page_size <= 50 or not 1 <= self.max_pages <= 20:
            raise HikvisionValidationError("Invalid pagination limits")


def validate_host(host: str) -> str:
    """Accept a hostname/IP, never userinfo, a path, a query or a complete URL."""
    import ipaddress

    candidate = host.strip().strip("[]")
    try:
        ipaddress.ip_address(candidate)
        return f"[{candidate}]" if ":" in candidate else candidate
    except ValueError:
        if (
            len(candidate) <= 253
            and re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", candidate)
            and ".." not in candidate
        ):
            return candidate
    raise HikvisionValidationError("Host must be an IP address or hostname without a URL")


def _http_error(status: int) -> None:
    if status in {401, 403}:
        raise HikvisionAuthError("Authentication or permission denied")
    if status in {405, 501}:
        raise HikvisionUnsupportedError("HTTP method unsupported")
    if not 200 <= status < 300:
        raise HikvisionDeviceError("Unsuccessful HTTP response")


def _stream_documents(body: bytes) -> list[dict[str, Any]]:
    """Parse complete length-delimited JSON/XML events and legacy XML frames.

    Target firmware emits JSON MIME parts with Content-Length. Rely on that length,
    not a guessed boundary string: captured parts can include extra framing bytes.
    """
    documents: list[dict[str, Any]] = []
    mime_headers = False
    for match in re.finditer(
        rb"(?:^|\n)Content-Type:[ \t]*(application/json|application/xml|text/xml)[^\r\n]*\r?\n",
        body,
        re.IGNORECASE,
    ):
        mime_headers = True
        end = body.find(b"\r\n\r\n", match.start(), match.start() + 2048)
        if end < 0:
            continue
        header = body[match.start() : end]
        length_match = re.search(
            rb"(?:^|\n)Content-Length:[ \t]*([0-9]{1,7})\r?$", header, re.IGNORECASE | re.MULTILINE
        )
        if not length_match:
            continue
        length = int(length_match.group(1))
        start = end + 4
        if not 0 < length <= 1_048_576 or start + length > len(body):
            continue
        try:
            parsed = parse_payload(body[start : start + length])
            check_response_status(parsed.data)
            if "EventNotificationAlert" in parsed.data or isinstance(
                parsed.data.get("eventType"), str
            ):
                documents.append(parsed.data)
        except HikvisionError:
            continue
    if mime_headers:
        return documents
    for match in re.finditer(
        rb"<EventNotificationAlert\b[^>]*>.*?</EventNotificationAlert\s*>", body, re.DOTALL
    ):
        try:
            parsed = parse_payload(match.group())
            check_response_status(parsed.data)
            documents.append(parsed.data)
        except HikvisionError:
            continue
    return documents


class ProbeClient:
    """Use an injected async session; only allowlisted reads can reach the wire."""

    def __init__(
        self,
        session: httpx.AsyncClient,
        *,
        host: str,
        username: str,
        password: str,
        scheme: str = "http",
        port: int = 80,
        limits: ProbeLimits | None = None,
    ) -> None:
        if scheme not in {"http", "https"} or not 1 <= port <= 65535:
            raise HikvisionValidationError("Invalid scheme or port")
        self._base_url = f"{scheme}://{validate_host(host)}:{port}"
        self._session = session
        self._credentials = (username, password)
        self._secrets = tuple(value for value in (host, username, password) if value)
        self.limits = limits or ProbeLimits()

    async def probe(
        self,
        endpoint: ProbeEndpoint,
        *,
        position: int = 0,
        search_id: str = "phase0",
    ) -> ProbeRecord:
        """Record a bounded observation. A Digest challenge is the only auth replay."""
        if endpoint not in (*ENDPOINTS, *READ_CAPABILITIES, REMOTE_CAPABILITIES):
            raise HikvisionValidationError("Endpoint is not in the read-only allowlist")
        if not 0 <= position <= self.limits.page_size * self.limits.max_pages:
            raise HikvisionValidationError("Search position exceeds probe limits")
        record = ProbeRecord(endpoint.name, endpoint.method, endpoint.path)
        started = time.monotonic()
        request_body = None
        if endpoint.search_root:
            request_body = {
                endpoint.search_root: {
                    "searchID": search_id,
                    "searchResultPosition": position,
                    "maxResults": self.limits.page_size,
                }
            }
        duration = (
            self.limits.stream_seconds if endpoint.mode == "stream" else self.limits.request_seconds
        )
        chunks = bytearray()
        try:
            async with asyncio.timeout(duration):
                async with self._session.stream(
                    endpoint.method,
                    self._base_url + endpoint.path,
                    # Target firmware rejects a cached Digest after the stream closes.
                    # Start one fresh challenge flow per read, with no extra auth retry.
                    auth=httpx.DigestAuth(*self._credentials),
                    json=request_body,
                    follow_redirects=False,
                    timeout=httpx.Timeout(duration, connect=min(duration, 5)),
                    headers={"Accept-Encoding": "identity"},
                ) as response:
                    record.http_status = response.status_code
                    record.headers = safe_headers(response.headers)
                    # Read HTTP errors too, so sanitized ResponseStatus evidence is retained.
                    async for chunk in response.aiter_raw():
                        remaining = self.limits.max_bytes - len(chunks)
                        chunks.extend(chunk[:remaining])
                        if len(chunk) >= remaining:
                            record.truncated = True
                            break
                    self._interpret(endpoint, record, bytes(chunks))
        except (TimeoutError, httpx.TimeoutException):
            if endpoint.mode == "stream" and record.http_status is not None:
                try:
                    self._interpret(endpoint, record, bytes(chunks))
                except HikvisionError as error:
                    record.error = type(error).__name__
                    record.outcome = "error"
            else:
                record.error = HikvisionTimeoutError.__name__
                record.outcome = "error"
        except httpx.HTTPError:
            record.error = HikvisionConnectionError.__name__
            record.outcome = "error"
        except HikvisionError as error:
            record.error = type(error).__name__
            record.outcome = (
                "unsupported" if isinstance(error, HikvisionUnsupportedError) else "error"
            )
        finally:
            record.bytes_received = len(chunks)
            record.elapsed_ms = round((time.monotonic() - started) * 1000)
        return record

    def _interpret(self, endpoint: ProbeEndpoint, record: ProbeRecord, body: bytes) -> None:
        if record.http_status is None:
            return
        if endpoint.mode == "stream" and 200 <= record.http_status < 300:
            documents = _stream_documents(body)
            record.payload = sanitize(documents, self._secrets)
            if not documents and body.strip().startswith((b"<", b"{")):
                try:
                    parsed = parse_payload(body)
                except HikvisionValidationError:
                    pass
                else:
                    record.payload = sanitize(parsed.data, self._secrets)
                    record.namespaces = safe_namespaces(parsed.namespaces)
                    check_response_status(parsed.data)
            record.outcome = "observed" if documents else "no_complete_event"
            return
        if endpoint.mode == "snapshot" and 200 <= record.http_status < 300:
            if (
                record.headers.get("content-type") == "image/jpeg"
                and body.startswith(b"\xff\xd8\xff")
                and body.endswith(b"\xff\xd9")
                and not record.truncated
            ):
                record.payload = {"image": "OMITTED"}
                record.outcome = "observed"
                return
        try:
            parsed = parse_payload(body)
        except HikvisionValidationError:
            _http_error(record.http_status)
            raise
        record.payload = sanitize(parsed.data, self._secrets)
        record.namespaces = safe_namespaces(parsed.namespaces)
        _http_error(record.http_status)
        check_response_status(parsed.data)
        record.outcome = "observed" if not record.truncated else "incomplete"

    async def run(
        self, *, remote_capabilities_exposed: bool = False, extended: bool = False
    ) -> CapabilityReport:
        """Read serially, stop on auth failure and never crawl or mutate the station."""
        import uuid

        report = CapabilityReport()
        endpoints = (*ENDPOINTS, *READ_CAPABILITIES) if extended else ENDPOINTS
        if remote_capabilities_exposed:
            endpoints = (*endpoints, REMOTE_CAPABILITIES)
        for endpoint in endpoints:
            position = 0
            search_id = uuid.uuid4().hex
            for page in range(self.limits.max_pages if endpoint.search_root else 1):
                record = await self.probe(endpoint, position=position, search_id=search_id)
                record.name = (
                    f"{endpoint.name}_{page:02d}" if endpoint.search_root else endpoint.name
                )
                report.records.append(record)
                if record.error == HikvisionAuthError.__name__:
                    report.observations["scan_stopped"] = "authentication_or_permission_failure"
                    build_capabilities(report)
                    return report
                if not endpoint.search_root or record.outcome != "observed":
                    break
                matches = find_values(record.payload, "numOfMatches")
                total = find_values(record.payload, "totalMatches")
                status = find_values(record.payload, "responseStatusStrg") or find_values(
                    record.payload, "responseSearchStatusStrg"
                )
                try:
                    count = int(matches[0])
                except (IndexError, TypeError, ValueError):
                    break
                if count <= 0 or count > self.limits.page_size:
                    break
                position += count
                if (status and status[0] in {"OK", "NO MATCH"}) or (
                    total and str(total[0]).isdigit() and position >= int(total[0])
                ):
                    break
                if page + 1 == self.limits.max_pages:
                    report.observations[f"{endpoint.name}_page_limit_reached"] = True
        build_capabilities(report)
        return report


def _read_shape_matches(feature: str, payload: Any, root: str) -> bool:
    """An empty, redacted or incorrectly typed wrapper is not support evidence."""
    values = find_values(payload, root)
    if feature == "call_status":
        values = [value.get("status") if isinstance(value, dict) else value for value in values]
        return any(
            isinstance(value, (str, int))
            and not isinstance(value, bool)
            and value not in {"", REDACTED}
            for value in values
        )
    if feature in {"users", "cards"}:
        return any(
            isinstance(value, dict)
            and "numOfMatches" in value
            and str(value["numOfMatches"]).isdigit()
            and value.get("responseStatusStrg", value.get("responseSearchStatusStrg"))
            in {"OK", "MORE", "NO MATCH"}
            for value in values
        )
    return any(isinstance(value, dict) and bool(value) for value in values)


def build_capabilities(report: CapabilityReport) -> None:
    """Only matching response structures establish read support.

    Write/physical semantics remain unknown even when advertised or returned in reads.
    """
    shapes = {
        "call_status": ("call_status", "callStatus"),
        "work_status": ("work_status", "WorkStatus"),
        "users": ("user_search", "UserInfoSearch"),
        "cards": ("card_search", "CardInfoSearch"),
    }
    for feature, (prefix, root) in shapes.items():
        candidates = [
            r for r in report.records if r.name == prefix or r.name.startswith(prefix + "_")
        ]
        supported = [
            r.name
            for r in candidates
            if r.outcome == "observed" and _read_shape_matches(feature, r.payload, root)
        ]
        if supported:
            setattr(report.features, feature, True)
            report.evidence[feature] = supported
        elif candidates and all(r.outcome == "unsupported" for r in candidates):
            setattr(report.features, feature, False)
    for record in report.records:
        if record.name == "device_info" and record.outcome == "observed":
            for attribute, field in (("model", "model"), ("firmware", "firmwareVersion")):
                values = find_values(record.payload, field)
                if values and isinstance(values[0], str) and values[0] != REDACTED:
                    setattr(report.identity, attribute, values[0])
            release = find_values(record.payload, "firmwareReleasedDate")
            if report.identity.firmware and release and release[0] != REDACTED:
                report.identity.firmware += (
                    f" {release[0]}"
                    if str(release[0]).startswith("build ")
                    else f" build {release[0]}"
                )
        if record.name == "snapshot" and record.payload == {"image": "OMITTED"}:
            report.features.snapshot = True
            report.evidence["snapshot"] = [record.name]
        if record.name == "alert_stream" and record.outcome == "observed":
            report.features.event_stream = True
            report.evidence["event_stream"] = [record.name]
    report.observations["feature_semantics"] = (
        "users/cards prove search reads only; writes, PIN, rights, unlock "
        "and RTSP need manual tests"
    )
