# Phase 0 runbook

The Master Spec was read completely before implementation. Phase 0 remains open until target-device
probes and physical findings are reviewed. Synthetic fixtures are not firmware evidence.

## Bounds and semantics

Inputs: host, username, password, scheme, HTTP port, RTSP port. Password uses a hidden getpass prompt.
Automation may provide HIKVISION_PASSWORD only in its process environment, never in tracked files.

Defaults: 10 seconds per request including Digest negotiation, 4 seconds total for the alert stream,
1 MiB per response, 10 results/page, 3 pages/search. Requests are serial. A page-limit observation
means the scan was bounded; it does not establish a device limit or complete user export.
One generated search ID is reused per search and removed from exported evidence.

Only fixed user/card Search endpoints use POST; other probes use GET.
There is no arbitrary endpoint/body, unlock, configuration or credential-write option.
Use --remote-capabilities-exposed only after independently observing that the station exposes the
door-capabilities endpoint. It reads metadata and never activates a relay.
The CLI does not probe RTSP; an open port or product documentation cannot prove usable live video.
Use --extended for fixed system/access/user/card/stream and PIN-mode metadata reads.
The owner-authorized session separately decoded live RTSP and snapshot frames in memory;
see CAPABILITY_MATRIX.md and the media fixture for results and limitations.

## Output

- capability_report.json: redacted identity, tri-state capabilities, evidence links and manual gates.
- fixtures/*.json: method/path, HTTP status, media type, Allow, namespaces, normalized body,
  timing, bytes, truncation and normalized error.
- share_with_codex.zip: report, fixtures and README only.
- .gitignore: protects output from accidental Git addition.

XML is normalized to JSON: root/child names remain, repeated children become lists, attributes use
@name, and attribute/text nodes use #text. Namespaces are listed separately.
This preserves structural evidence rather than byte-for-byte formatting.
Unknown values are REDACTED. Credential capability min/max bounds remain visible.
No raw bodies, image bytes, cookies, Digest headers, PINs, cards, employee IDs, serials, personal
names or connection credentials are written. Review JSON files locally before sharing.

true means an expected read structure was observed, not verified writes or physical enforcement.
false requires an explicitly unsupported operation. Timeout, 404, malformed response and
permission failure remain unknown. No complete stream event means unknown.
An event proves delivery, not reliable bell/access detection.
Snapshot evidence is a complete response with JPEG framing and matching media type;
visual validity and live video need manual verification.
Unlock, PIN, door rights, RightPlan and RTSP stay null until functional tests establish them.

## Initial commissioning capture

Remote read-only evidence has been collected for the current station. The next missing input is
the physical bell sequence, relay mapping and credential acceptance. For a new station,
run the normal probe and then the 90-second bell capture. Return sanitized
ZIP files and approximate seconds for idle, bell press, answer, end and return to idle.
If missing from the report, transcribe model/firmware from the device UI. Note the current
PIN Mode label and reported capacities if visible. Do not change PIN mode or permissions yet.

## Later physical gate

After reviewing returned evidence, prepare concrete target-specific instructions for:

1. Relay 1 and 2: API ID, physical output operated and sanitized acknowledgement.
2. PIN: set/change/remove, mode, keypad flow, accepted length and duplicates.
3. User/card CRUD: supported fields, multiple cards, format, read-back and deletion.
4. Door rights: grant one relay and physically verify denial at the other.
5. RightPlan, validity, disable and asynchronous deletion status where exposed.
6. Snapshot, live RTSP and event behavior during bell actions.
7. Reboot and repeat; nine-station acceptance and soak testing occur later.

The CLI cannot perform these writes. The assistant must ask the owner to execute the required
physical test, review the result, then continue through the phases in order.

## Packaging references

- [HACS integration layout](https://www.hacs.xyz/docs/publish/integration/)
- [HACS schema and public repository requirement](https://www.hacs.xyz/docs/publish/start/)
- [HACS validation action](https://www.hacs.xyz/docs/publish/action/)
- [HA manifest](https://developers.home-assistant.io/docs/creating_integration_manifest/)
- [HTTPX Digest](https://www.python-httpx.org/advanced/authentication/)

render_readme is omitted because the current HACS schema does not list it.
The spec requires supported keys despite including it in an illustrative example.

## Owner scope and supervised continuation

The owner has specified one active relay per station across this installation. Relay 2 is
excluded from management and tests. Answer/hangup tests are deferred until an answering
screen exists; busy tone plus idle call samples do not establish those transitions.

The second-station session verified API door 1, an existing test card and initial local PIN
acceptance. PIN change failed physically despite success/readback. Continue from the private
owned-test-user ledger, resolve or record the limitation, clear/delete only that temporary
user and verify the original user/card remain. Never promote HTTP success to physical proof.
See VALIDATION.md for current results and open gates.
