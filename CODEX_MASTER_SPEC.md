# Hikvision DS-KV6124-E1 — Full Home Assistant Integration
## Master Development Specification for Codex
### Version 1.2 — 2026-09-07

**Project domain:** `hikvision_intercom`  
**Target:** Home Assistant 2026.9+ custom integration / HACS  
**Target fleet:** 9 × Hikvision DS-KV6124-E1  
**Observed target firmware:** V3.9.0 build 260115  
**Design:** Local-first ISAPI integration + centralized access-control administration panel

**Mandatory product requirements added in v1.1:**
- Every intercom camera must be viewable both as a standard Home Assistant `camera` entity and inside the dedicated Intercom Manager sidebar panel.
- During setup/reconfigure of every intercom, the administrator must explicitly choose which physical lock outputs are imported and managed: Relay 1 only, Relay 2 only, or both.
- An unselected relay must not create an entity, appear in the panel, be targetable by services/actions, or appear in user door-permission controls.


---

# 1. Goal

Create a production-quality Home Assistant integration that replaces the day-to-day role of iVMS for this installation.

The product has two layers:

## A. Native Home Assistant device integration
Each physical intercom appears as its own Home Assistant Device and exposes:
- availability / online status
- live camera
- current call status
- ringing state
- remote door unlock
- configurable inclusion of Lock/Relay 1, Lock/Relay 2, or both
- optional door/contact/tamper/access-event entities where confirmed by firmware
- automation triggers/events

## B. Central Access Control Manager
A dedicated administrator-only Home Assistant sidebar panel provides:
- global people/users database
- PIN management
- multiple cards per person
- assign each person to any subset of the 9 intercoms
- optional per-lock rights on each selected intercom
- validity periods
- active/inactive state
- add/edit/delete people
- import/adopt users already present on devices
- synchronization status per person × intercom
- conflict resolution
- pending work for offline devices
- audit/events view

Home Assistant is the **management plane**. Credential authentication and the actual door decision remain local on each Hikvision station whenever possible. Therefore normal card/PIN access should continue even while HA is offline.

---

# 2. Research conclusions that define the architecture

## DS-KV6124-E1 hardware/product facts
The current official Hikvision datasheet documents:
- Linux platform
- 4 MP camera
- 2 physical lock relays
- relay rating up to 30 VDC / 2 A
- 4 alarm/input channels
- 1 door-contact input
- 1 exit-button input
- RS-485
- 2,000 users
- 6,000 cards in the current 2026-06-03 datasheet
- card/PIN/Hik-Connect/indoor-station authentication
- 13.56 MHz M1 card reader
- RTSP and ONVIF

Important:
The older 2025 datasheet listed a higher card capacity. Use the value reported by the actual device capability/UI rather than hard-coding capacity.

## Hikvision villa station manual
The current Linux Villa Door Station manual for the same platform family documents:
- Person Management from PC Web
- employee ID
- validity period
- cards
- PIN configuration
- up to 5 cards for a person in this manual
- door permissions and access schedules
- event search by employee/card/time
- two-lock behavior, with the two locks separately unlockable after appropriate PIN/card configuration
- M1 card enablement and NFC-card handling
- PIN Mode choices such as platform-applied personal PIN vs device-set personal PIN

## Official Hikvision ISAPI Access Control family
The official Open Hardware documentation provides API structures for:
- user count/search/create/modify/delete
- card count/search/create/modify/delete
- `employeeNo`
- `password`
- `doorRight`
- `RightPlan`
- `planTemplateNo`
- access-control event searches

This is strong evidence that the desired data model maps naturally to ISAPI.

However, the public ISAPI catalog covers a broad Hikvision product family. The exact DS-KV6124-E1 V3.9.0 firmware implementation must be probed and tested before a capability is treated as supported.

## Hikvision Video Intercom ISAPI family
The official VideoIntercom API documents:
- `GET /ISAPI/VideoIntercom/capabilities`
- capability for `callStatus`
- `GET /ISAPI/VideoIntercom/WorkStatus`
- lock-status list in WorkStatus on supporting devices
- card issuing configuration APIs

Community projects have independently validated on related Hikvision intercoms:
- `GET /ISAPI/VideoIntercom/callStatus?format=json`
- `PUT /ISAPI/AccessControl/RemoteControl/door/{id}`
- XML `<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>`

The remote-unlock endpoint and numbering must be verified against the actual DS-KV6124-E1 because generic examples and firmware variants can differ.

---

# 3. Chosen Home Assistant architecture

## 3.1 One ConfigEntry per physical intercom

Use one normal Home Assistant ConfigEntry for every DS-KV6124-E1.

Reasons:
- independent authentication and reauthentication
- independent network failure handling
- independent removal/reconfiguration
- clean Home Assistant Device ownership under the 2026.8+ device-registry rules
- one failed station does not block all stations
- easier diagnostics

The integration also initializes one domain-level `IntercomFleetManager` which aggregates all loaded entries.

Do **not** put all nine stations into one ConfigEntry.

## 3.2 Global manager

```text
Home Assistant
│
├── ConfigEntry: Front Gate
│   └── Device: DS-KV6124-E1
│       └── HikvisionClient
│
├── ConfigEntry: Lobby
│   └── Device: DS-KV6124-E1
│       └── HikvisionClient
│
├── ... × 9
│
└── IntercomFleetManager
    ├── ManagedUserStore
    ├── AssignmentStore
    ├── SyncEngine
    ├── EventAggregator
    └── Admin WebSocket API
            │
            └── Home Assistant Sidebar Panel
```

Each ConfigEntry stores only connection/configuration data for that station.

The central user database is integration-level storage.

---


# 3A. Mandatory distribution, Git and release workflow

The entire project must be developed as a **GitHub-hosted Home Assistant custom integration designed for installation and updates through HACS**.

This is a product requirement, not an optional packaging task at the end.

## HACS distribution requirements

The repository must be structured so the user can add it to HACS as a Custom Repository and install/update the integration without manually copying files.

Repository root should include at minimum:

```text
/
├── custom_components/
│   └── hikvision_intercom/
│       ├── __init__.py
│       ├── manifest.json
│       ├── config_flow.py
│       ├── ...
│       └── frontend/dist/...
├── hacs.json
├── README.md
├── CHANGELOG.md
├── LICENSE
├── pyproject.toml
├── tests/
├── tools/
└── .github/
    └── workflows/
        ├── hacs.yml
        ├── hassfest.yml
        └── tests.yml
```

Rules:
- There must be only one Home Assistant integration under `custom_components/`.
- Every file required at runtime must be distributed inside `custom_components/hikvision_intercom/`.
- Frontend source may live outside the integration directory, but compiled production frontend assets required at runtime must be packaged inside the integration directory.
- Root `hacs.json` is required and must describe the integration.
- `manifest.json` must contain the custom integration `version`.
- Installation through HACS must be the normal supported installation method.
- Manual copy to `custom_components` may be documented only as a fallback/development method.
- The project must be testable by adding its GitHub URL in:
  `HACS → Integrations → Custom repositories`
- Every release intended for use must be installable/upgradable from HACS without SSH/File Editor/manual file replacement.

Example `hacs.json`:

```json
{
  "name": "Hikvision Intercom Manager",
  "render_readme": true
}
```

Use only keys supported by the current HACS schema when implementing.

## GitHub repository

The project must be maintained in a dedicated GitHub repository.

Recommended repository name:

```text
home-assistant-hikvision-intercom
```

The Git repository is the authoritative source for:
- source code
- frontend source
- compiled release assets when required by HACS
- tests
- protocol fixtures after sanitization
- documentation
- changelog
- release history

Never commit:
- real device usernames/passwords
- PINs
- card numbers
- unredacted serial numbers if the owner chooses to keep them private
- private IPs in public test fixtures unless intentionally sanitized
- authentication headers
- `.storage` production data
- secrets files

Provide a suitable `.gitignore`.

## Branch workflow

Use:

```text
main
```

as the stable/releasable branch.

Development work should occur on focused branches such as:

```text
phase/0-protocol-probe
phase/1-core-integration
phase/2-access-manager
phase/3-admin-panel
feature/event-stream
fix/call-status-timeout
```

For Codex autonomous development:
- create/use a dedicated branch for the current phase
- do not mix unrelated phases in one commit
- keep commits small enough to review
- merge to `main` only after the phase tests pass
- do not rewrite published release history

If the development environment does not permit pull requests, still keep the same logical branch/commit discipline.

## Commit requirements

Every meaningful completed unit of work must be committed.

Use descriptive commit messages, for example:

```text
feat(probe): add non-destructive DS-KV6124 capability scanner
feat(config): add per-station relay selection
feat(camera): expose native HA camera entity
feat(access): add central managed-user storage
feat(sync): persist offline deletion tombstones
feat(panel): add RTL user assignment editor
fix(call): recover polling after station reconnect
test(access): cover card collision reconciliation
```

At the end of every development phase Codex must:
1. run the relevant tests and validation tools;
2. summarize the changes;
3. commit the phase;
4. report the commit hash;
5. report remaining known issues/blockers;
6. only then move to the next phase if no real-device input is required.

## Versioning

Use Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

Examples:

```text
0.1.0  Phase 0/protocol tooling and first development package
0.2.0  Core device entities
0.3.0  User/card/PIN backend
0.4.0  Administrative panel
0.5.0  Events and synchronization hardening
1.0.0  First production-ready release
1.0.1  Backward-compatible bug fix
1.1.0  Backward-compatible feature
2.0.0  Breaking configuration/storage/API change
```

Pre-1.0 versions may evolve more quickly, but migrations must still be implemented for persisted Home Assistant data once real users depend on the integration.

The same release version must be consistent between:
- Git tag / GitHub Release
- `custom_components/hikvision_intercom/manifest.json`
- release notes / changelog

Tags should use:

```text
v0.1.0
v0.2.0
v1.0.0
```

## CHANGELOG

Maintain `CHANGELOG.md`.

For every release include:
- Added
- Changed
- Fixed
- Security, when applicable
- Breaking Changes / Migration Notes, when applicable

Do not create a release with undocumented breaking behavior.

## GitHub Releases

Use real GitHub Releases, not only tags, for user-facing versions.

Each release should:
- be based on a tested commit from `main`
- have matching manifest version
- include release notes
- be installable via HACS
- clearly mark pre-release/beta versions when appropriate

Recommended early release path:

```text
v0.1.0-alpha.1
v0.1.0-alpha.2
v0.1.0-beta.1
v0.1.0
...
v1.0.0
```

Only use pre-release identifiers accepted by Home Assistant's version parser.

## Continuous Integration

Create GitHub Actions that run on pull requests and pushes to `main`.

Required:
- HACS validation action
- Hassfest
- Python tests (`pytest`)
- lint/format/type checks chosen for the project
- frontend TypeScript build/test when frontend exists

A release must not be published while required CI checks fail.

## HACS validation milestone

Before declaring v1 complete:
1. GitHub repository passes HACS validation.
2. Hassfest passes.
3. A clean Home Assistant instance can add the repository as a HACS Custom Repository.
4. HACS installs the integration.
5. Home Assistant restarts/reloads cleanly.
6. New releases are detected by HACS and upgrade correctly.
7. Upgrade preserves ConfigEntries, users, assignments and pending sync/tombstone state.

It is not necessary to wait for inclusion in HACS's default repository list to use the integration. Custom Repository installation is sufficient for this project.

---

# 4. Repository layout

```text
custom_components/hikvision_intercom/
├── __init__.py
├── manifest.json
├── const.py
├── config_flow.py
├── entity.py
├── models.py
├── exceptions.py
│
├── client/
│   ├── __init__.py
│   ├── client.py
│   ├── auth.py
│   ├── parser.py
│   ├── capabilities.py
│   ├── access_control.py
│   ├── video_intercom.py
│   └── events.py
│
├── coordinator.py
├── manager.py
├── storage.py
├── sync_engine.py
├── event_manager.py
├── websocket.py
├── diagnostics.py
├── repairs.py
│
├── binary_sensor.py
├── sensor.py
├── camera.py
├── lock.py
├── event.py
├── button.py
│
├── services.yaml
├── strings.json
├── translations/
│   ├── en.json
│   └── he.json
│
└── frontend/
    └── dist/
        ├── hikvision-intercom-panel.js
        └── assets/...

frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── panel.ts
    ├── api.ts
    ├── types.ts
    ├── styles.ts
    ├── views/
    │   ├── overview.ts
    │   ├── users.ts
    │   ├── user-editor.ts
    │   ├── devices.ts
    │   ├── events.ts
    │   └── sync.ts
    └── components/
        ├── station-card.ts
        ├── user-row.ts
        ├── credential-editor.ts
        ├── assignment-matrix.ts
        ├── sync-badge.ts
        └── conflict-dialog.ts

tools/
└── probe_ds_kv6124.py

tests/
├── fixtures/
│   └── ds_kv6124_e1_fw_3_9_0/
├── test_client.py
├── test_config_flow.py
├── test_capabilities.py
├── test_call_state.py
├── test_lock.py
├── test_users.py
├── test_cards.py
├── test_sync_engine.py
├── test_events.py
├── test_websocket.py
├── test_diagnostics.py
├── test_security.py
└── test_reload.py
```

---

# 5. Phase 0 — protocol reconnaissance MUST be first

Do not begin the production implementation with guessed APIs.

Build `tools/probe_ds_kv6124.py`.

## Input
```text
host
username
password
scheme
http_port
rtsp_port
```

## Non-destructive probes

At minimum:

```text
GET /ISAPI/System/deviceInfo

GET /ISAPI/VideoIntercom/capabilities
GET /ISAPI/VideoIntercom/callStatus?format=json
GET /ISAPI/VideoIntercom/WorkStatus
GET /ISAPI/VideoIntercom/SendCardCfg/capabilities

GET /ISAPI/AccessControl/UserInfo/Count?format=json
POST /ISAPI/AccessControl/UserInfo/Search?format=json

GET /ISAPI/AccessControl/CardInfo/Count?format=json
POST /ISAPI/AccessControl/CardInfo/Search?format=json

GET /ISAPI/AccessControl/AcsEventTotalNum/capabilities?format=json

GET /ISAPI/AccessControl/RemoteControl/door/capabilities
    # probe only if the station exposes it

GET /ISAPI/Streaming/channels/101/picture

GET /ISAPI/Event/notification/alertStream
    # controlled short read to establish support;
    # never leave the reconnaissance CLI hanging indefinitely
```

Also inspect:
- HTTP Allow responses
- supported content type
- ResponseStatus statusCode/subStatusCode
- XML namespaces
- pagination constraints
- credential/PIN capability fields
- maximum employeeNo length
- maximum name length
- door numbering
- card number format

## Output

Create:

```json
{
  "identity": {
    "model": "DS-KV6124-E1",
    "serial": "REDACTED",
    "firmware": "V3.9.0 build 260115"
  },
  "features": {
    "call_status": true,
    "event_stream": null,
    "users": true,
    "cards": true,
    "pin_password": null,
    "door_right": null,
    "right_plan": null,
    "remote_unlock": null,
    "remote_unlock_ids": [],
    "work_status": null,
    "snapshot": true,
    "rtsp": true
  }
}
```

`null` means not yet verified.
Never turn a generic-document capability into `true`.

Save sanitized responses into fixtures.

---

# 6. Config Flow

Home Assistant:
`Settings → Devices & services → Add Integration → Hikvision Intercom`

## Page 1 — Connection
Fields:
- Host/IP
- Username
- Password
- HTTP / HTTPS
- HTTP port
- TLS verification
- RTSP port, default 554
- Friendly name

Use Digest authentication.

Test the connection before creating the ConfigEntry.

Use device serial as unique ID when available.

Prevent duplicate registration of the same station.

## Page 2 — Detected device
Show:
```text
Model       DS-KV6124-E1
Firmware    V3.9.0 build 260115
Serial      ...
Camera      Yes
Lock outputs 2
```

## Page 3 — Locks / relays to import into Home Assistant

This is a **mandatory commissioning choice for every intercom**.

The DS-KV6124-E1 normally exposes two physical lock outputs, while many installations use only one. Therefore the integration must **never automatically import both relays merely because the hardware exposes both**.

The setup UI must explicitly ask:

```text
Which lock outputs should Home Assistant manage?

[x] Relay 1
    Friendly name: Main Door

[ ] Relay 2
    Friendly name: Vehicle Gate
```

Allowed configurations:
- Relay 1 only
- Relay 2 only
- Relay 1 + Relay 2
- optional camera/ring-only mode if deliberately selected by the administrator

Rules:
- Only selected relays create `lock` entities.
- Only selected relays appear on the dedicated Intercom Manager screens.
- Only selected relays appear in unlock actions/services.
- Only selected relays are available in per-user door-permission assignment.
- Backend validation rejects unlock or access-right requests for an unselected relay.
- The selection is stored per ConfigEntry.
- The selection can be changed later via Reconfigure/Options without deleting and re-adding the intercom.
- Enabling a previously disabled relay later should create/expose it cleanly.
- Disabling a relay later must remove/disable all UI and service targeting for it without leaving stale controls.

Example:
```text
Intercom 1 → Relay 1 only
Intercom 2 → Relay 1 only
Intercom 3 → Relay 2 only
Intercom 4 → Relay 1 + Relay 2
```

This selection means **which outputs Home Assistant manages**, not which relays physically exist in the Hikvision hardware.

## Door-number mapping wizard

Because Hikvision firmware families sometimes expose differing logical IDs, do not assume physical Relay 1 == API `/door/1` without validation.

Provide a commissioning screen:
```text
Physical output: Main Door
API door id: 1
[Test unlock]

Did the expected lock operate?
[Yes] [No]
```

Repeat for the second relay if selected.

Store the confirmed mapping:

```json
{
  "locks": [
    {
      "physical_index": 1,
      "api_door_id": 1,
      "name": "Main Door",
      "enabled": true
    }
  ]
}
```

## Reconfigure
Allow changing:
- host
- TLS
- port
- relay selection
- friendly names
- relay API mapping
- polling fallback interval

Implement reauthentication for changed/invalid login credentials.

---

# 7. HTTP client requirements

Use a fully asynchronous client.

Preferred:
- Home Assistant injected `aiohttp` session, or
- injected shared `httpx.AsyncClient`

Do not use `requests`.

Requirements:
- Digest authentication
- HTTP/HTTPS
- connection pooling
- explicit connect/read timeouts
- normalized exceptions
- redacted logs
- XML + JSON parser
- ResponseStatus parser even when HTTP status is 200
- per-device write lock

Typed exception hierarchy:

```text
HikvisionError
├── HikvisionAuthError
├── HikvisionConnectionError
├── HikvisionTimeoutError
├── HikvisionUnsupportedError
├── HikvisionValidationError
├── HikvisionConflictError
├── HikvisionCapacityError
└── HikvisionDeviceError
```

A Hikvision HTTP 200 with `statusCode != success` is still an error.

---

# 8. Runtime architecture per ConfigEntry

Use typed `ConfigEntry.runtime_data`.

```python
@dataclass
class IntercomRuntime:
    client: HikvisionClient
    coordinator: IntercomCoordinator
    event_client: HikvisionEventClient | None
    capabilities: IntercomCapabilities
    station: StationInfo
```

No raw client object in `hass.data` for entry-specific state.

The fleet manager itself may live once under the domain runtime.

---

# 9. Native Home Assistant entities

## Core entities

Per station:

```text
binary_sensor.<station>_online
binary_sensor.<station>_ringing
sensor.<station>_call_status
camera.<station>
```

For enabled lock outputs only:

```text
lock.<station>_door_1
lock.<station>_door_2
```

## Optional entities when supported

```text
binary_sensor.<station>_door_contact
binary_sensor.<station>_tamper
sensor.<station>_last_access_user
sensor.<station>_last_access_result
sensor.<station>_managed_users
sensor.<station>_sync_health
event.<station>_access
event.<station>_doorbell
```

Low-value diagnostic entities should be disabled by default.

Use translated names and `_attr_has_entity_name = True`.

---

# 10. Ring / call-state engine

This is one of the highest-priority functions.

## Source order

### Preferred
Push event / alert stream if the actual station emits a reliable ring/call event.

### Fallback
```text
GET /ISAPI/VideoIntercom/callStatus?format=json
```

The official VideoIntercom capability set includes `isSupportCallStatus`.

Do not assume a fixed enum until captured from the real DS-KV6124-E1.

Preserve unknown values.

Normalized states:

```text
idle
ringing
in_call
ending
unknown
unavailable
```

Map raw firmware values to those normalized states.

## Poll fallback cadence

Suggested:
- idle: 1.5–2 seconds
- ringing/in_call: 0.5–1 second
- offline: exponential backoff
- recovered: immediate refresh

For 9 local stations this is a manageable load.

Stagger station polling so all nine do not request simultaneously.

## State machine

```text
UNKNOWN
   │
   ├── successful status ─────> IDLE
   │
   └── error ─────────────────> UNAVAILABLE

IDLE
   └── incoming call ─────────> RINGING

RINGING
   ├── answered ──────────────> IN_CALL
   ├── rejected/ended ────────> IDLE
   └── connection loss ───────> UNAVAILABLE

IN_CALL
   ├── ended ─────────────────> IDLE
   └── connection loss ───────> UNAVAILABLE
```

## HA representations

`binary_sensor.ringing`
- `on` only for the actual ringing duration

`sensor.call_status`
- string normalized call state

`event.doorbell`
- fires once on edge transition into ringing

This gives both a persistent visible state and a clean automation event.

---

# 11. Remote unlock

Candidate API to verify:

```http
PUT /ISAPI/AccessControl/RemoteControl/door/{door_id}
Content-Type: application/xml

<RemoteControlDoor version="2.0"
 xmlns="http://www.isapi.org/ver20/XMLSchema">
  <cmd>open</cmd>
</RemoteControlDoor>
```

The protocol client must not report success based solely on HTTP 200.
Parse ResponseStatus.

## Entity semantic choice

This is a momentary door-release output, not necessarily a physical lock-state sensor.

Preferred HA implementation:
- `lock` entity because this is intuitive in dashboards.
- `async_unlock()` sends the momentary open command.
- if no authoritative lock state is available, do **not** pretend that we know the physical deadbolt state.

Possible state behavior:
- configured lock defaults to locked/secured representation
- show `unlocking` while request is active
- return to secured after the configured pulse period
- diagnostic attribute: `state_source = optimistic`

If reliable magnetic/contact state is available:
- expose it separately as `binary_sensor` door contact.
- do not conflate "door is open" with "relay is activated".

Important: the datasheet documents two lock relays but only one native door-contact input. Therefore two physical door open/closed states cannot be assumed.

## HA action
```yaml
action: hikvision_intercom.unlock_door
target:
  device_id: ...
data:
  lock: 1
```

The action must reject any lock not enabled in the integration settings.

---

# 12. Camera

Camera viewing is a **mandatory v1 feature in two separate surfaces**.

## 12.1 Native Home Assistant camera entity

Every configured intercom with a usable video stream must expose a standard HA entity:

```text
camera.<station>
```

Requirements:
- usable in ordinary Home Assistant dashboards/Lovelace
- usable in popup cards and automations
- independent of the custom Intercom Manager panel
- local video with no cloud dependency
- RTSP preferred for live video
- snapshot support where available

Expected Hikvision RTSP convention:

```text
rtsp://HOST:554/Streaming/Channels/101
```

Never log or expose a credential-containing RTSP URL.

Snapshot candidate:

```text
GET /ISAPI/Streaming/channels/101/picture
```

A substream can be exposed as an optional, disabled-by-default secondary camera entity if confirmed useful.

## 12.2 Camera inside the dedicated Intercom Manager panel

The same intercom video must also be viewable from the dedicated Home Assistant sidebar panel.

Required locations:
1. Overview station card — live preview or responsive camera preview.
2. Station detail screen — larger live camera view.
3. Ringing state — the relevant camera becomes visually prominent when that intercom rings.
4. Optional fullscreen view.

The custom frontend must **not connect directly to the Hikvision device using browser-visible credentials**.

Preferred implementation order:
1. Reuse the Home Assistant `camera` entity and HA camera-stream/media path in the custom panel.
2. If lower latency is needed, support an HA-compatible WebRTC/go2rtc path without exposing Hikvision credentials to the browser.
3. Fall back to periodically refreshed snapshots only when live streaming is unavailable.

The panel should provide:

```text
[ Live camera ]
[ Open large view ]
[ Unlock enabled relay(s) ]
```

If a station is ringing, the UI should surface its camera immediately without forcing the administrator to navigate to another page.

Two-way audio is **not v1 scope**.

# 13. Central managed-user model

The global HA database is the desired state.

```python
@dataclass(slots=True)
class ManagedUser:
    id: str  # UUID in HA
    employee_no: str  # canonical Hikvision ID across all stations
    display_name: str
    active: bool
    user_type: str
    valid_from: datetime | None
    valid_until: datetime | None

    pin: SecretValue | None
    cards: list[ManagedCard]
    assignments: dict[str, StationAssignment]

    revision: int
    created_at: datetime
    updated_at: datetime
```

```python
@dataclass(slots=True)
class ManagedCard:
    id: str
    card_no: SecretValue
    label: str | None
    card_type: str
    enabled: bool
```

```python
@dataclass(slots=True)
class StationAssignment:
    config_entry_id: str
    enabled: bool
    allowed_locks: frozenset[int]
    schedule_template: str | None

    desired_revision: int
    applied_revision: int | None
    sync_state: SyncState
    last_sync_at: datetime | None
    last_error: str | None
```

Possible `SyncState`:
```text
synced
pending
syncing
offline
conflict
error
delete_pending
```

---

# 14. Employee ID strategy

Use the **same** `employeeNo` for the same person on all 9 stations.

This is essential for:
- card association
- log correlation
- deletion
- reconciliation
- conflict detection

Do not create a different employee number per station.

Recommended:
- auto-generated numeric/string ID within confirmed device constraints
- editable by administrator before first synchronization
- once synchronized, changing employeeNo should be treated as an identity migration, not an ordinary field edit

---

# 15. PIN management

The official Hikvision UserInfo schema includes the `password` field and the villa-station manual explicitly documents personal PIN configuration.

But exact DS-KV6124-E1 behavior must be tested because the manual also documents different `PIN Mode` configurations.

## UI behavior

Never display the current PIN back to the browser after save.

Show:
```text
PIN
●●●●●●    Configured
[Change PIN] [Remove PIN]
```

When changing:
```text
New PIN: ______
Confirm: ______
```

Validation must come from capabilities/real-device testing.

Do not hard-code "6 digits" until confirmed by the device.

## PIN mode detection

During protocol reconnaissance determine:
- Platform-Applied Personal PIN support
- Device-Set Personal PIN behavior
- whether ISAPI `UserInfo.password` is accepted
- whether the keypad expects personal PIN only or another identification flow
- duplicate PIN behavior
- accepted PIN length

If the device is configured to a mode where remote PIN management is unavailable:
- panel must clearly show that PIN is device-managed
- disable PIN write controls rather than pretending synchronization succeeded

---

# 16. Card management

The official CardInfo API maps:
```text
employeeNo ←→ cardNo
```

Support multiple cards per person.

The villa-family manual states up to 5 cards per person; device capabilities must remain authoritative.

UI:
```text
Cards
Office M1           •••• 4821   Active   [Remove]
Backup card         •••• 9104   Active   [Remove]

[+ Add card]
```

Card creation options:
1. Manual entry of card number
2. Future enhancement: card enrollment mode using the station reader if confirmed
3. Future enhancement: USB/card enrollment device

Never expose raw full card numbers in:
- entity states
- entity attributes
- logs
- diagnostics
- Home Assistant event bus

---

# 17. Official ISAPI user operations to support

## Count
```text
GET /ISAPI/AccessControl/UserInfo/Count?format=json
```

## Search
```text
POST /ISAPI/AccessControl/UserInfo/Search?format=json
```

Must implement pagination:
```json
{
  "UserInfoSearchCond": {
    "searchID": "...",
    "searchResultPosition": 0,
    "maxResults": 50
  }
}
```

Continue until responseStatus indicates no more records.

## Create
```text
POST /ISAPI/AccessControl/UserInfo/Record?format=json
```

## Modify
Verify actual target firmware support:
```text
PUT /ISAPI/AccessControl/UserInfo/Modify?format=json
```

## SetUp / replace
Capability-gated:
```text
PUT /ISAPI/AccessControl/UserInfo/SetUp?format=json
```

## Delete
```text
PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json
```

Use:
```json
{
  "UserInfoDetail": {
    "mode": "byEmployeeNo",
    "EmployeeNoList": [
      {"employeeNo": "1001"}
    ]
  }
}
```

If the device processes deletion asynchronously, poll:
```text
GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json
```

Verify absence after deletion.

---

# 18. Official ISAPI Card operations to support

## Count
```text
GET /ISAPI/AccessControl/CardInfo/Count?format=json
```

## Search
```text
POST /ISAPI/AccessControl/CardInfo/Search?format=json
```

## Create
```text
POST /ISAPI/AccessControl/CardInfo/Record?format=json
```

Example structure:
```json
{
  "CardInfo": {
    "employeeNo": "1001",
    "cardNo": "...",
    "cardType": "normalCard",
    "checkCardNo": true,
    "checkEmployeeNo": true
  }
}
```

## Modify
```text
PUT /ISAPI/AccessControl/CardInfo/Modify?format=json
```

## Delete
```text
PUT /ISAPI/AccessControl/CardInfo/Delete?format=json
```

Deletion can target employee number or card number depending device implementation.

---

# 19. Per-door permission

The official UserInfo schema includes:

```json
{
  "doorRight": "1,2",
  "RightPlan": [
    {
      "doorNo": 1,
      "planTemplateNo": "1"
    },
    {
      "doorNo": 2,
      "planTemplateNo": "1"
    }
  ]
}
```

This means the backend must be designed for per-door rights.

However, do not expose the nested Door 1 / Door 2 authorization controls until the actual DS-KV6124-E1 accepts and enforces them.

Three capability levels:

```text
Level A:
Station user synchronization only.

Level B:
Station user + lock-specific rights.

Level C:
Station user + lock-specific rights + schedule templates.
```

The UI dynamically enables the appropriate controls.

---

# 20. Assignment UI

Example:

```text
User: Yoni

Intercom access

[x] Main Entrance
    [x] Main Door
    [ ] Vehicle Relay

[x] Lobby
    [x] Lobby Door

[ ] Parking

[x] Warehouse
    [x] Door 1
    [x] Door 2

[ ] Roof
...
```

The user can be assigned to:
- 1 station
- several selected stations
- all 9 stations

`Select all` is useful but must remain a deliberate admin action.

---

# 21. User lifecycle

## Create
1. Validate local central record.
2. Persist desired state.
3. Generate/increment revision.
4. Queue reconciliation for assigned stations.
5. Return immediately to UI with progress.
6. Synchronize in background.
7. Verify each device.

## Edit
Compare desired user revision to last applied revision for every target station.

Only perform necessary writes.

## Disable
Preferred semantic:
- retain the central person
- revoke authentication at assigned stations
- use a supported `Valid`/access-right mechanism where possible
- otherwise remove the person from stations while retaining central metadata

The exact strategy is capability-gated.

## Delete
Deletion is permanent:
- create deletion tombstone
- remove cards/user from every managed target station
- keep tombstone until every station confirms absence
- then remove secret material and tombstone

---

# 22. Existing users on devices — critical safety feature

Never assume HA owns every person already stored on the intercoms.

On first setup:
- read existing users
- read cards
- do not overwrite/delete them
- mark them as `Unmanaged`

Panel:
```text
Existing unmanaged users found: 34
[Review / Import]
```

For each:
```text
Employee 1021 — David Cohen
Device: Main Gate

[Adopt as new central user]
[Map to existing central user]
[Ignore]
[Delete from device...]
```

Automatic reconciliation operates only on records explicitly managed/adopted by the integration.

This prevents destructive first-run synchronization.

---

# 23. Synchronization engine

The synchronization engine is desired-state based, not a simplistic "push all users every time" loop.

## Per station
Only one state-changing transaction may execute at a time.

Reads can be concurrent within sensible limits.

## Global concurrency
Suggested:
- max 3 stations performing write reconciliation concurrently
- each station serialized

## User upsert algorithm

For `ManagedUser U` assigned to station `S`:

```text
1. Ensure S is online.
2. Search U.employee_no.
3. If absent:
      create user
   else:
      normalize fields
      update only differing supported fields
4. Read user's current cards.
5. Add centrally-required missing cards.
6. Update differing supported card metadata.
7. Remove cards deleted centrally.
8. Read user/cards back.
9. Compare with desired normalized state.
10. Mark applied_revision = desired_revision.
11. sync_state = synced.
```

## User removed from one station

```text
1. desired state for U × S = absent
2. delete relevant cards
3. delete UserInfo
4. wait for DeleteProcess if applicable
5. read-back verification
6. mark synced
```

## Offline station

Do not fail the global operation.

Example:
```text
Main Gate     ✓ Synced
Lobby         ✓ Synced
Parking       ⏳ Pending — offline
Warehouse     ✓ Synced
```

When Parking reconnects:
- automatic reconciliation runs
- pending desired revision is applied

---

# 24. Tombstones

A delete must survive:
- Home Assistant restart
- station offline
- network outage

Persist:

```python
@dataclass
class UserTombstone:
    user_id: str
    employee_no: str
    target_entries: set[str]
    confirmed_entries: set[str]
    created_at: datetime
```

Do not erase raw credential information needed for deletion until the deletion plan no longer requires it.

When every target confirms absence:
- remove tombstone
- securely discard credential material

---

# 25. Conflict detection

Conflict examples:
- same employeeNo but different person/name
- same cardNo belongs to another employee
- record changed manually on station
- central user changed while old revision is syncing
- capacity reached
- per-door rights rejected
- PIN field rejected due current PIN mode

Never silently overwrite identity ambiguity.

Show:

```text
Conflict — Main Gate

Employee ID 1042
Central:  Yoni Oliel
Device:   Daniel Cohen

[Use Central]
[Import Device]
[Change Employee ID]
[Ignore device record]
```

---

# 26. Revision strategy

Every central user has a monotonically increasing `revision`.

Each assignment stores:
```text
desired_revision
applied_revision
```

Sync job captures a revision number.

Before marking success:
- if desired revision changed while job was running, schedule another reconciliation

This prevents lost updates.

---

# 27. Event handling

## Doorbell event
Prefer event stream if real firmware exposes it.
Otherwise derive from callStatus transition.

## Access events
Probe:
```text
/ISAPI/Event/notification/alertStream
```

and access-control event search APIs.

Optional historical recovery:
```text
POST /ISAPI/AccessControl/AcsEventTotalNum?format=json
```
and the matching event query supported by actual firmware.

Normalize:

```python
@dataclass(slots=True)
class AccessEvent:
    station_entry_id: str
    timestamp: datetime
    employee_no: str | None
    person_name: str | None
    door_no: int | None
    authentication: str | None
    result: str
    event_type: str
```

Never carry raw PIN into events.

Mask/hash raw card numbers before they can reach HA recorder/event state.

---

# 28. Home Assistant event entities and triggers

Because current HA guidance prefers event entities for momentary events:

```text
event.<station>_doorbell
event.<station>_access
```

The event entity may provide non-sensitive attributes:
```text
event_type: access_granted
person: Yoni
employee_no: 1001
door: 1
authentication: card
```

Also keep:
```text
binary_sensor.<station>_ringing
```
because ringing is a duration/state, not merely a momentary edge.

Automation trigger support should follow current Home Assistant trigger APIs rather than relying only on legacy custom device automation.

---

# 29. Access event history panel

Do not depend on entity attributes for the administrative audit list.

Keep a bounded internal event cache/database.

UI:
```text
20:31  Main Gate   Yoni Oliel   Door 1   Card   Granted
20:29  Lobby       Unknown      Door 1   Card   Denied
20:20  Warehouse   Dana Levi    Door 2   PIN    Granted
```

Filters:
- time range
- station
- person
- granted/denied
- authentication method
- door

Optional: click an event to show the associated snapshot if the device supplied one and retention/privacy configuration allows it.

---

# 30. Sidebar panel

Register an administrator-only custom panel.

Suggested route:
```text
/hikvision-intercom
```

Hebrew title:
```text
ניהול אינטרקומים
```

English:
```text
Intercom Manager
```

Use:
- TypeScript
- Lit/Web Components
- current HA visual primitives where feasible
- responsive layout
- RTL support
- dark/light theme variables
- HA accent/theme variables
- no external CDN runtime dependency

Frontend must never connect directly to a door station.

Frontend communicates with Home Assistant backend only.

---

# 31. Sidebar sections

```text
סקירה
משתמשים
אינטרקומים
אירועים
סנכרון
```

English:
```text
Overview
Users
Intercoms
Events
Sync
```

---

# 32. Overview screen

Top summary:

```text
Intercom Manager

8/9 Online       1 Ringing       3 Pending sync
```

9 station cards.

Each card:
- station name
- **camera preview sourced through Home Assistant**
- control to open a larger station camera view
- online/offline
- call state
- ringing banner
- **only lock buttons explicitly enabled for that ConfigEntry**
- last access
- synchronization health

When a station is ringing:
- prominently highlight its camera
- optionally prioritize/move that station card to the top
- show the enabled unlock buttons directly next to/below the video

Example:

```text
┌────────────────────────────────────────┐
│ MAIN GATE                  ● ONLINE    │
│ ┌────────────────────────────────────┐ │
│ │             CAMERA                 │ │
│ └────────────────────────────────────┘ │
│ 🔔 RINGING                            │
│                                        │
│ [ 🔓 Open Main Door ]                  │
│ [ 🔓 Open Vehicle Gate ]               │
│                                        │
│ Last access: Yoni · 20:31              │
│ Sync: ✓                                │
└────────────────────────────────────────┘
```

If only Relay 1 was selected:
- only one unlock button appears

If Relay 2 only:
- only Relay 2 appears

If station is offline:
- buttons are disabled
- display last seen
- display pending sync count

---

# 33. Users screen

Toolbar:
```text
Search...
[+ Add user] [Import existing] [Sync all]
```

Table desktop:
```text
Name        ID       PIN      Cards   Intercoms   Status    Sync
Yoni        1001     ✓        2       6 / 9       Active    ✓
Dana        1002     ✓        1       3 / 9       Active    ⚠ 1
Visitor A   2001     —        1       1 / 9       Expires   ✓
```

Mobile:
Use cards rather than a wide table.

Actions:
- Edit
- Disable
- Sync now
- Delete

Delete requires a confirmation dialog that explains the number of target stations.

---

# 34. Add/Edit User screen

## Section A — Basic
- Name
- Employee ID
- Active
- Long-term or start/end validity

## Section B — PIN
- configured/not configured
- Set new PIN
- Remove PIN
- never reveal saved PIN

## Section C — Cards
- card label
- masked card number
- type
- status
- remove
- Add Card

## Section D — Intercom assignment
Show all 9 stations.

Example:
```text
☑ Main Gate
    ☑ Lock 1 — Main Door
    ☐ Lock 2 — Vehicle Gate
    Sync: ✓

☑ Lobby
    ☑ Lock 1
    Sync: ✓

☐ Parking

☑ Warehouse
    ☑ Lock 1
    ☑ Lock 2
    Sync: Pending
```

If firmware does not support lock-specific user rights, nested lock choices are disabled and explain:
```text
This firmware supports station-level permission only.
```

Footer:
```text
[Cancel] [Save] [Save & Sync]
```

The central desired state must be persisted before background device synchronization starts.

Do not make the user wait for all nine HTTP writes before closing the editor.

---

# 35. Intercom Devices screen

For every station:

```text
Name: Main Gate
Model: DS-KV6124-E1
Firmware: V3.9.0 build 260115
Host: 192.168...
Online: Yes
RTT: 18 ms

Capabilities
✓ Call status
✓ Camera
✓ UserInfo
✓ CardInfo
? Remote unlock door 2
✓ Access event query
✕ Alert stream

Integrated locks
✓ Main Door → API ID 1
✓ Vehicle Gate → API ID 2

Managed users: 128
Pending operations: 0
Last reconciliation: 20:32

[Test lock] [Sync now] [Rescan capabilities] [Configure]
```

---

# 36. Sync screen

The synchronization screen must be useful for debugging.

Matrix:

```text
              Gate   Lobby   Park   Office   WH...
Yoni          ✓      ✓       —      ✓        ⚠
Dana          ✓      —       —      ✓        ✓
Visitor       —      ✓       —      —        —
```

Click cell:
```text
Warehouse / Yoni
Desired revision: 14
Applied revision: 13
Status: Conflict
Last error: card already assigned to employee 1044
```

Buttons:
- retry
- resolve
- inspect device record
- use central state
- adopt device state

---

# 37. WebSocket backend API

Panel commands:

```text
hikvision_intercom/overview
hikvision_intercom/users/list
hikvision_intercom/users/get
hikvision_intercom/users/create
hikvision_intercom/users/update
hikvision_intercom/users/delete
hikvision_intercom/users/set_active

hikvision_intercom/cards/add
hikvision_intercom/cards/remove

hikvision_intercom/stations/list
hikvision_intercom/stations/get
hikvision_intercom/stations/test_unlock
hikvision_intercom/stations/rescan

hikvision_intercom/sync/user
hikvision_intercom/sync/station
hikvision_intercom/sync/all
hikvision_intercom/sync/status

hikvision_intercom/conflicts/list
hikvision_intercom/conflicts/resolve

hikvision_intercom/events/list
hikvision_intercom/subscribe
```

Every mutating WebSocket command:
- `@websocket_api.require_admin`
- schema validation
- translated errors
- no secret echo

Read-only user/access administrative data should also be admin-only by default due to privacy.

---

# 38. Subscription events to frontend

One WebSocket subscription channel can send:

```json
{
  "kind": "ring_state_changed",
  "station_id": "...",
  "state": "ringing"
}
```

```json
{
  "kind": "sync_state_changed",
  "user_id": "...",
  "station_id": "...",
  "state": "synced"
}
```

```json
{
  "kind": "access_event",
  "station_id": "...",
  "employee_no": "1001",
  "person_name": "Yoni",
  "result": "granted"
}
```

Never send raw cardNo or PIN unless a one-time admin write operation absolutely requires it.

---

# 39. HA service actions

Register in `async_setup`, not per-entry.

```text
hikvision_intercom.unlock_door
hikvision_intercom.sync_user
hikvision_intercom.sync_station
hikvision_intercom.sync_all
hikvision_intercom.rescan_station
```

Optional capability-gated later:
```text
hikvision_intercom.reject_call
hikvision_intercom.hangup_call
```

Use translated `ServiceValidationError` / `HomeAssistantError`.

---

# 40. Storage

Use `homeassistant.helpers.storage.Store`.

Suggested files:

```text
.storage/hikvision_intercom.users
.storage/hikvision_intercom.sync
.storage/hikvision_intercom.events
```

Schema version every Store.

## Sensitive data

Full PINs/cards may need to be recoverable to synchronize a replacement/offline station.

Rules:
- never put secrets in entity state
- never put secrets in event bus
- never put secrets in diagnostics
- never log request bodies for credential endpoints
- never return existing PIN plaintext to panel

Optional envelope encryption may be implemented, but it must be documented that a key stored on the same HA host does not protect against complete host compromise.

The main practical security boundary is keeping credential data confined to private HA storage and out of observable subsystems.

---

# 41. Logging and diagnostics

Diagnostics:
- model
- firmware
- capability matrix
- response timing
- queue depth
- sync state
- sanitized last errors

Redact:
- password
- PIN
- full card number
- authorization headers
- cookies
- RTSP password
- personally identifying data where not necessary

Create explicit automated redaction tests.

---

# 42. Network robustness

For every station:
- connection timeout
- read timeout
- offline detection
- exponential backoff
- recovery
- request jitter
- independent circuit behavior

A dead station must never delay the other eight.

Only safe/idempotent GETs may be automatically retried freely.

For a state-changing operation whose HTTP reply times out:
1. do not blindly repeat
2. query resulting state first
3. retry only if needed and safe

For remote unlock, if acknowledgement is lost:
```text
Outcome unknown — station did not acknowledge.
```
Do not falsely report success.

---

# 43. Home Assistant current development requirements

Target current best practices:
- ConfigFlow UI setup
- test connection before configure
- reauthentication
- reconfiguration
- typed `ConfigEntry.runtime_data`
- `DataUpdateCoordinator` where appropriate
- async HTTP dependency
- injected HA web session
- `async_register_static_paths`
- admin-only panel
- admin-required WebSocket mutation APIs
- diagnostics with redaction
- unload/reload support
- translated entities/errors
- strict typing
- full tests
- no deprecated `hass.helpers`
- account for 2026.8+ single-config-entry device ownership
- account for current frontend/device registry APIs

Aim internally for Home Assistant Gold/Platinum quality even though this is initially a HACS custom integration.

---

# 44. Event loop / concurrency rules

Do not block the HA event loop.

Do not use:
- `requests`
- synchronous filesystem I/O in async paths
- blocking card/user bulk loops

Use:
- async HTTP
- batched/paginated reads
- `asyncio` locks/semaphores
- executor only for unavoidable CPU/blocking work

Per station:
```python
self.write_lock = asyncio.Lock()
```

Fleet:
```python
self.sync_semaphore = asyncio.Semaphore(3)
```

---

# 45. Capacity management

Read actual count/capability from station.

Before creating:
- compare user count vs capacity
- compare card count vs capacity

If full:
- stop writing that record
- surface a clear sync error
- do not leave UI in generic "failed" state

Example:
```text
Main Gate: Cannot add user — person capacity reached (2000/2000)
```

---

# 46. Card collision behavior

Before assigning a new card:
1. search central store
2. search target stations if required
3. if card belongs to another employee:
   - mark conflict
   - never silently steal/reassign

Admin must explicitly resolve.

---

# 47. Access schedules

The device/manual supports door permission schedules.

Design the data model now but make advanced schedule UI Phase 2/3.

Start v1 with:
- Always
- Validity start/end

Later:
- named templates
- weekdays
- time windows
- holidays

Translate central schedule to `RightPlan.planTemplateNo` only after capability testing.

---

# 48. Repair issues

Create HA Repairs issues for:
- station auth expired
- unsupported firmware regression after firmware upgrade
- invalid/missing lock mapping
- persistent sync conflict
- local storage migration failure

Do not create a Repair for transient network downtime.

---

# 49. Discovery

Optional after stable v1:
- UPnP/SSDP if Hikvision advertises something usable
- network discovery if there is a safe mechanism

Do not rely on SADP proprietary broadcast for v1 unless implementing it is worthwhile.

Manual IP setup is acceptable for first release.

---

# 50. Testing strategy

## Protocol fixtures
All actual-device responses must be sanitized and stored.

## Unit tests — client
- digest auth
- XML namespace
- JSON parsing
- ResponseStatus error despite HTTP 200
- 401
- 403
- timeout
- malformed payload
- unsupported endpoint
- pagination

## Config flow
100% flow coverage:
- valid
- invalid auth
- offline
- duplicate serial
- TLS
- reauth
- reconfigure
- lock selection
- mapping update

## Ring
- idle → ringing
- ringing → in_call
- ringing → idle
- offline during ringing
- unknown raw state
- fallback poll
- push event

## Unlock
- lock 1
- lock 2
- disabled lock rejected
- wrong mapping
- ResponseStatus failure
- timeout ambiguous
- no false success

## Users
- list pagination
- create
- modify
- validity
- PIN set
- PIN remove
- door rights
- delete process
- read-back verify

## Cards
- add
- remove
- multiple cards
- collision
- capacity
- card read-back

## Sync
- no-op idempotency
- new user → 9 stations
- selected subset only
- deselect station
- station offline
- station recovers
- HA restart mid-sync
- delete with offline station
- tombstone recovery
- update revision while previous update running
- external modification conflict

## Security
Assert PIN/card never occur in:
- entity state
- event data
- diagnostics
- logs
- exception message
- websocket normal read APIs

## Lifecycle
- setup
- unload
- reload
- reauth
- HA shutdown
- event stream cleanup

---

# 51. Real-device acceptance test

Use one test DS-KV6124-E1 first.

1. Connect with production client.
2. Verify device information.
3. Verify camera snapshot/RTSP.
4. Press physical bell and capture exact callStatus sequence.
5. Verify event-stream behavior.
6. Test physical relay 1 and confirm API mapping.
7. Test physical relay 2 and confirm API mapping.
8. Create employee `HA_TEST_001`.
9. Set a temporary PIN.
10. Test physical keypad authentication.
11. Add an M1 test card.
12. Verify the card opens the configured lock.
13. Give that test person only one lock permission if supported.
14. Verify denial on other lock.
15. Query event record.
16. Remove card.
17. Delete person.
18. Verify absence.
19. Reboot intercom.
20. Repeat core status/unlock checks.

Only then expand to all nine stations.

---

# 52. Nine-station end-to-end acceptance scenario

1. Add all nine intercoms to HA.
2. Configure stations 1–5 with Relay 1 only.
3. Configure stations 6–8 with both relays.
4. Configure station 9 with Relay 2 only.
5. Verify unwanted lock entities do not exist.
6. Press the bell on station 4.
7. `binary_sensor` changes to ringing within target latency.
8. Overview card highlights station 4.
9. Unlock the configured relay and verify physical operation.
10. Add user `TEST-1001`.
11. Add one PIN and two cards.
12. Assign user only to 1, 3, 6, 7 and 9.
13. Synchronize.
14. Physically verify credentials fail at unassigned stations.
15. If per-lock permission is confirmed, grant only Relay 2 at station 9.
16. Verify Relay 1 access is denied and Relay 2 succeeds.
17. Disconnect station 7 from Ethernet.
18. Delete user globally.
19. Verify successful delete on online targets.
20. UI shows deletion pending on station 7.
21. Reconnect station 7.
22. Automatic reconcile removes the user.
23. Restart Home Assistant.
24. Verify central data and sync/tombstone state persist.
25. Download diagnostics and confirm no PIN/card secret exists.

---

# 53. UI visual design requirements

The panel should feel like native Home Assistant:
- rounded HA-style cards
- clean spacing
- theme variables
- dark/light support
- Material Design icons
- RTL Hebrew
- desktop/tablet/mobile
- status conveyed by text + icon + color
- large unlock controls suitable for wall tablet
- strong but not distracting ringing indication

Important:
A door unlock button should be deliberately separated from harmless controls to reduce accidental taps.

Optional configurable safety:
- normal one-tap unlock
- or "hold to unlock" for selected stations

Default recommendation for wall dashboards: hold/confirm for remotely opening a vehicle gate; one-tap can remain available in normal HA lock entity controls if the user wants it.

---

# 54. Screen mockup — Overview

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ניהול אינטרקומים                    8/9 מחוברים   🔔 1 מצלצל   ⟳ 3 ממתינים │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ סקירה ] [ משתמשים ] [ אינטרקומים ] [ אירועים ] [ סנכרון ]               │
│                                                                              │
│ ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐   │
│ │ שער ראשי     ● מחובר│  │ לובי         ● מחובר│  │ חניה         ○ לא זמין│ │
│ │ ┌─────────────────┐ │  │ ┌─────────────────┐ │  │                     │   │
│ │ │   LIVE CAMERA   │ │  │ │   LIVE CAMERA   │ │  │    OFFLINE          │   │
│ │ └─────────────────┘ │  │ └─────────────────┘ │  │                     │   │
│ │ 🔔 מצלצל עכשיו       │  │ פנוי                │  │ נראה לאחרונה 20:22   │   │
│ │                     │  │                     │  │                     │   │
│ │ [ פתח דלת ראשית ]   │  │ [ פתח דלת ]        │  │ [ Disabled ]        │   │
│ │ [ פתח שער רכב ]     │  │                     │  │ ⟳ 2 סנכרונים ממתינים │   │
│ │                     │  │                     │  │                     │   │
│ │ כניסה: יוני 20:31 ✓ │  │ כניסה: דנה 20:28 ✓ │  │                     │   │
│ └─────────────────────┘  └─────────────────────┘  └─────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

# 55. Screen mockup — Users

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ משתמשים                                      [+ הוסף משתמש] [ייבוא] [סנכרן]│
│ [ חיפוש שם / מזהה / 4 ספרות אחרונות של כרטיס...                          ]│
├──────────────────────────────────────────────────────────────────────────────┤
│ שם             מזהה      PIN    כרטיסים   אינטרקומים    סטטוס    סנכרון   │
│ יוני אוליאל    1001       ✓       2          6/9          פעיל      ✓       │
│ דנה לוי        1002       ✓       1          3/9          פעיל      ⚠ 1     │
│ אורח זמני      2001       —       1          1/9          עד 12/9   ✓       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

# 56. Screen mockup — User editor

```text
┌──────────────────────── עריכת משתמש — יוני אוליאל ──────────────────────────┐
│ שם: [ יוני אוליאל      ]      מזהה: [1001]      [✓] משתמש פעיל             │
│ תוקף: [● ללא הגבלה]  [○ מתאריך ____ עד ____]                               │
│                                                                              │
│ PIN                                                                          │
│ ●●●●●●  מוגדר                       [שנה PIN] [הסר PIN]                      │
│                                                                              │
│ כרטיסים                                                                      │
│ כרטיס משרד       ••••4821     M1       פעיל             [הסר]               │
│ כרטיס גיבוי       ••••9104     M1       פעיל             [הסר]               │
│ [+ הוסף כרטיס]                                                               │
│                                                                              │
│ הרשאות אינטרקום                                                             │
│ ☑ שער ראשי       ☑ דלת ראשית    ☐ שער רכב                  ✓ מסונכרן       │
│ ☑ לובי           ☑ דלת                                         ✓ מסונכרן   │
│ ☐ חניה                                                                       │
│ ☑ מחסן           ☑ דלת 1        ☑ דלת 2                     ⟳ ממתין        │
│ ☐ גג                                                                         │
│                                                                              │
│                                              [ביטול] [שמור] [שמור וסנכרן]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

# 57. Screen mockup — station configuration

```text
┌──────────────────────── הגדרת אינטרקום — שער ראשי ──────────────────────────┐
│ DS-KV6124-E1 · V3.9.0 build 260115 · ● מחובר                                │
│                                                                              │
│ מצלמה                                                                        │
│ [ תצוגה חיה ]                         [פתח תצוגת מצלמה גדולה]               │
│                                                                              │
│ אילו מנעולים לייבא ל-Home Assistant?                                        │
│ ☑ Relay 1     שם: [דלת ראשית   ]     API Door ID [1]   [בדיקת פתיחה]       │
│ ☐ Relay 2     שם: [שער רכב      ]     API Door ID [2]   [בדיקת פתיחה]       │
│                                                                              │
│ Relay 2 קיים בחומרה אך אינו מיובא ולכן לא ייצור Entity/כפתור/הרשאה.         │
│                                                                              │
│ יכולות                                                                       │
│ ✓ Call Status       ✓ Camera       ✓ UserInfo       ✓ CardInfo               │
│ ✓ PIN               ? AlertStream  ✓ Door Rights    ✓ Access Events          │
│                                                                              │
│ מצב סנכרון                                                                   │
│ משתמשים מנוהלים: 128      פעולות ממתינות: 0      עדכון אחרון: 20:32       │
│                                                                              │
│ [סרוק יכולות מחדש] [סנכרן עכשיו]                              [שמור]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

# 58. Implementation phases for Codex

## Phase 0 — Protocol reconnaissance
Deliver:
- safe probe utility
- exact sanitized responses from the target firmware
- capability matrix
- fixture set
- door mapping results
- callStatus state sequence
- PIN-mode findings

**No production UI yet.**

## Phase 1 — Core device integration
Deliver:
- HACS package
- ConfigFlow
- Digest client
- reauth/reconfigure
- DeviceInfo
- coordinator
- online
- call status
- ringing
- camera
- selected locks
- options/reconfigure
- unload/reload
- tests

## Phase 2 — Central access-control backend
Deliver:
- Store schemas
- users
- PIN
- cards
- assignments
- user CRUD
- import/adopt
- sync engine
- tombstones
- conflict engine
- tests

## Phase 3 — Administrator panel
Deliver:
- custom sidebar panel
- Overview
- Users
- User Editor
- Devices
- Sync
- Hebrew RTL + English
- admin-only WebSocket API
- responsive mobile design

## Phase 4 — Access/doorbell events
Deliver:
- alert/event stream when supported
- polling fallback
- access event normalization
- event entities
- audit screen
- event recovery after disconnect if API supports it

## Phase 5 — Hardening
Deliver:
- full diagnostics
- Repair issues
- migrations
- secret redaction
- capacity errors
- rate limiting
- soak tests on all nine stations
- documentation
- HACS release workflow

## Phase 6 — optional future
- two-way audio
- answer/reject/hangup
- go2rtc/WebRTC media bridge
- card-enrollment mode via station reader
- advanced weekly access schedules
- holidays
- CSV bulk import/export
- reporting
- mobile NFC/Hik-Connect credential provisioning

---

# 59. v1 non-goals

Do not delay v1 for:
- two-way audio
- SIP/PBX replacement
- face management
- fingerprint management
- Hik-Connect account administration
- NFC cloning
- attendance/time-clock features

v1 must be excellent at:

```text
RING + CAMERA + UNLOCK
USERS + PIN + CARDS
ASSIGNMENTS + DELETE
SYNC + OFFLINE RECOVERY
```

---

# 59A. Mandatory camera + relay-selection behavior

These requirements are release blockers.

## Camera
- Every video-capable station exposes `camera.<station>` as a normal Home Assistant entity.
- The same station video is viewable inside the custom Intercom Manager panel.
- The user is never forced to choose between the HA camera and the dedicated-panel camera; both are provided.
- A ringing station prominently displays its camera in the panel.
- The panel never embeds Hikvision usernames/passwords in browser-visible URLs.

## Relay selection
- Setup asks which of the two physical relay outputs Home Assistant should manage.
- The setup must not silently enable Relay 2 merely because the device has two relays.
- Valid selections are Relay 1, Relay 2, or both.
- Only selected relays:
  - create HA lock entities,
  - appear on Overview and station detail screens,
  - can be targeted by integration actions/services,
  - appear in managed-user per-door permissions.
- Reconfigure can change the selected relay set later.
- Backend validation rejects an unselected relay even if a caller manually crafts a service/WebSocket request.
- Per-door user rights are always constrained to the selected relay set.

# 60. Definition of Done

- [ ] 9 stations work independently.
- [ ] Station online state.
- [ ] Ring state.
- [ ] Doorbell event.
- [ ] Live camera is viewable as a normal Home Assistant camera entity.
- [ ] Live camera is viewable inside the dedicated Intercom Manager panel.
- [ ] Ringing station prominently displays its live camera in the dedicated panel.
- [ ] Relay 1 only can be selected during setup.
- [ ] Relay 2 only can be selected during setup.
- [ ] Both relays can be selected during setup.
- [ ] A non-selected relay creates no HA entity, no panel control, no service target, and no user-permission option.
- [ ] Relay selection can be changed later through Reconfigure without deleting/re-adding the intercom.
- [ ] Physical API door mapping verified.
- [ ] Reliable unlock.
- [ ] Central user create/edit.
- [ ] PIN set/change/remove when firmware permits.
- [ ] Multiple cards/user.
- [ ] Assign user to arbitrary subset of stations.
- [ ] Lock-specific rights where actual firmware supports them.
- [ ] Unassign from station removes/revokes user there.
- [ ] User Disable supported.
- [ ] Global Delete supported.
- [ ] Offline delete persists.
- [ ] Reconnect reconciles automatically.
- [ ] Import existing users is non-destructive.
- [ ] Conflicts visible.
- [ ] Sync matrix visible.
- [ ] HA restart loses no desired state/pending tombstones.
- [ ] No secret PIN/card leaks.
- [ ] Admin-only management.
- [ ] Unload/reload works.
- [ ] Hebrew RTL.
- [ ] Desktop/tablet/mobile panel.
- [ ] Repository is installable and upgradeable through HACS Custom Repository.
- [ ] `hacs.json`, README, CHANGELOG and valid custom-integration manifest version are present.
- [ ] HACS validation, Hassfest and automated test workflow pass in GitHub Actions.
- [ ] GitHub tags/releases and `manifest.json` use consistent Semantic Versions.
- [ ] Git history contains reviewable phase/feature commits with no secrets.
- [ ] Actual DS-KV6124-E1 lab test suite passes.
- [ ] Nine-device soak test passes.

---

# 61. First prompt to give Codex

Copy the following to Codex after placing this specification in the repository:

> Read `CODEX_MASTER_SPEC.md` completely before changing code. Treat the entire document as the project Source of Truth and end-state specification.
>
> The complete project is expected to be implemented, but work **phase by phase**, with Git commits and passing tests at each phase boundary. Do not attempt to invent device-specific protocol behavior just to continue autonomously.
>
> Start with **Phase 0 — Protocol Reconnaissance**. When Phase 0 reaches a point that requires real DS-KV6124-E1 probe output or a physical relay/PIN/card test, stop and explicitly request that data. After the real-device results are provided, continue through the remaining phases sequentially.
>
> From the beginning, maintain the repository as a HACS-installable GitHub custom integration. Use Semantic Versioning, maintain `CHANGELOG.md`, run HACS/Hassfest/tests in CI, and commit every completed logical unit. At the end of each phase report the branch, commit hash, test results and next phase.
>
> Build `tools/probe_ds_kv6124.py` as a fully asynchronous, non-destructive Hikvision ISAPI probe using Digest authentication. It must produce a sanitized JSON capability report and sanitized fixtures. Do not create/delete users, change configuration, or unlock a relay automatically.
>
> Implement typed models for the capability report and normalized exceptions. Add unit tests for XML/JSON parsing using synthetic fixtures.
>
> Do not assume a generic Hikvision endpoint is supported by DS-KV6124-E1 merely because it exists in public ISAPI documentation.
>
> At the end, output:
> 1. files created/changed,
> 2. exact commands to run the probe,
> 3. which resulting fixture/report files I must return to you,
> 4. any capability still requiring a manual physical test.
>
> Stop after Phase 0 and wait for the real-device probe data.

---

# 62. Research references

## Hikvision — target device
Current DS-KV6124-E1 datasheet (2026-06-03):
https://assets.hikvision.com/prd/normal/all/doc/m000168989/DS-KV6124-E1_Datasheet_20260603.pdf

Linux Villa Door Station user manual:
https://download.discomp.cz/hikvision/manual/DS-KV6114-MWBE1_Video%20Intercom%20Linux%20Villa%20Door%20Station_User%20Manual_V1.0.0_20250807.pdf

## Hikvision — official Open Hardware / ISAPI
Access Control:
https://open.hikvision.com/hardware/v2/08%E5%8D%8F%E8%AE%AE%E9%80%8F%E4%BC%A0/%E6%98%8E%E7%9C%B8%E9%97%A8%E7%A6%81.html

Video Intercom:
https://open.hikvision.com/hardware/v2/08%E5%8D%8F%E8%AE%AE%E9%80%8F%E4%BC%A0/%E5%8F%AF%E8%A7%86%E5%AF%B9%E8%AE%B2.html

## Home Assistant developer docs
Config flows:
https://developers.home-assistant.io/docs/core/integration/config_flow/

Options/reconfigure:
https://developers.home-assistant.io/docs/core/integration/options_flow/

Config entries:
https://developers.home-assistant.io/docs/config_entries_index/

Runtime data:
https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/runtime-data/

Fetching/coordinator:
https://developers.home-assistant.io/docs/integration_fetching_data/

Injected HTTP session:
https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/inject-websession/

Custom panels:
https://developers.home-assistant.io/docs/frontend/custom-ui/creating-custom-panels/

Extending WebSocket API:
https://developers.home-assistant.io/docs/frontend/extending/websocket-api

Permissions:
https://developers.home-assistant.io/docs/auth_permissions/

Lock entity:
https://developers.home-assistant.io/docs/core/entity/lock/

Integration events:
https://developers.home-assistant.io/docs/integration_events/

Diagnostics:
https://developers.home-assistant.io/docs/core/integration/diagnostics/

Quality scale:
https://developers.home-assistant.io/docs/core/integration-quality-scale/

## Community interoperability references
These are evidence/reference only; actual target firmware remains authoritative.

Hikvision Add-ons ISAPI notes:
https://github.com/pergolafabio/Hikvision-Addons/blob/main/doorbell/ISAPI.md

Native HA Hikvision intercom project:
https://github.com/TimLuist1/hikvision-intercom

---

# 63. Key implementation warning

Two non-negotiable product requirements must remain intact in every phase:
1. Camera must be available both as a normal Home Assistant camera entity and inside the dedicated Intercom Manager panel.
2. Every station setup/reconfigure flow must explicitly choose the managed relay set; never expose an unused second relay by default.

The most important rule in this entire specification:

**Do not write the system around assumptions from generic Hikvision ISAPI documentation.**

Build around a capability matrix obtained from the actual DS-KV6124-E1 with firmware V3.9.0 build 260115.

For every optional feature:
```text
documentation says it may exist
        ↓
non-destructive capability probe
        ↓
manual real-device functional test if needed
        ↓
fixture
        ↓
unit test
        ↓
production feature enabled
```

This approach prevents a fragile integration that appears correct in code but fails on the installed firmware.
