# Manufacturer protocol basis

The owner supplied seven manufacturer documents on 2026-09-08 and explicitly requested
continued development while physical commissioning is deferred. All 587 PDF pages and
4,225 populated spreadsheet rows were extracted and indexed locally. Review covered the
scope of every document, the main section index, and the integration-relevant workflows,
API definitions, dictionaries and event tables. This is a protocol review, not proof that
every capability works on every Hikvision product. Source hashes and sizes are listed in
[vendor_sources.json](vendor_sources.json). Source PDFs/workbooks and personal watermarks
remain outside Git; the Master Spec is unchanged.

## Source scope

| Source | Review and use |
| --- | --- |
| ISAPI_IP Series_Pro Series.pdf, 518 pages | DS-KV6124-E1 is explicitly in scope on page 4. Authentication, capabilities, video, people/cards, permission schedules, events and call interaction define the implementation contracts. Firmware upgrades, activation, biometrics, recording and elevator control are outside this project's current scope. |
| Access Control Event Types and Event Linkage Types.pdf, 31 pages | Numeric access event codes use a major/minor pair; linkage codes form a different namespace. Relevant event table rows were checked against rendered pages. |
| ErrorCode.xlsx, Sheet1 A1:E2271 | Status/substatus/error codes and descriptions. The parser now recognizes documented capacity and person-conflict codes. |
| Field Dictionary.xlsx, Sheet1 A1:G1955 | Cross-product enum dictionary with 171 field names. Interpret fields in their endpoint context, not as global enums. |
| Log.pdf, 27 pages | String identifiers for alarm, exception, operation, event and information logs; these are separate from numeric AccessControllerEvent values. |
| Region Code.pdf, 1 page | Regional identifiers for license-plate recognition algorithms; not intercom locality settings. |
| Country and Region Code.pdf, 10 pages | Country/region algorithm identifiers, including reserved values; not a Home Assistant country/time-zone mapping. |

## Implementation contracts

- Device capability responses override example limits (main document page 14). Do not use
  example maxima or generic supported-product lists as evidence that a feature is enabled.
- Digest is documented on pages 8-10. Keep credentials out of errors and diagnostics. The
  observed firmware requires fresh per-request challenges after stream closure.
- RTSP address construction is documented on pages 17-19. The observed main-stream route
  remains `/Streaming/Channels/101`; snapshots use the independently verified picture route.
- Event streams are long-lived multipart connections (pages 25-28 and 32-36). Parse complete
  parts by length/boundary, discard image bodies, close stale streams and reconnect with
  bounded backoff. `currentEvent=false` is replay history, not a fresh doorbell/access event.
- Person creation is POST `UserInfo/Record`; editing is PUT `UserInfo/Modify` (pages 119-120,
  466-469). `SetUp` is an upsert (pages 117-118), so it must not silently adopt a conflicting
  unmanaged person. `employeeNo` links people, credentials and access permissions.
- `localPassword` is explicitly documented (pages 462, 466, 468, 472, 475). The observed
  firmware web client selects this field in local mode and `password` in platform mode.
  Mode routes are firmware observations; they are absent from this PDF. A successful save
  and exact readback do not establish physical PIN acceptance.
- The document describes predefined schedule IDs 65535/65534/65533 (pages 466, 468).
  This station advertises template IDs 1-255. Do not apply the generic predefined IDs here.
  Empty RightPlan readback is not proof of an all-day schedule. A prior template-1 GET failed.
- Card creation requires an existing person (pages 80-86); creation, modification and upsert
  have different conflict semantics. Access-control cardType is `normalCard` etc. (page 452).
  The field dictionary's `cardType=vehiclePass` (E157) belongs to vehicle data and must not
  replace the access-control enum.
- Card deletion uses PUT `CardInfo/Delete` with exactly one nonempty target list (pages
  449-450). Missing/null filters can mean all cards: reject them before any network request.
- The detailed person-delete API is asynchronous: acknowledgement means started; check its
  progress and final absence (pages 121-122). The separately documented `UserInfo/Delete`
  route (page 465) must also be followed by readback. Never generate an empty target list.
- Normal remote opening uses PUT `RemoteControl/door/<doorID>` with XML cmd=open
  (pages 479-480). ID 65535 means all doors and is forbidden in this integration. The owner
  has one active relay per station; only the configured, physically mapped output is exposed.
- Call status is `idle`, `ring`, `onCall` (page 490). `onCall` is described as busy; do not
  claim that it proves a call was answered. A fresh device capability read returned exactly
  these options. Physical successful ringing/answer/hangup sequences remain unverified.
- Voice interaction events/signaling are documented on pages 128-130 and 486-490, with
  capability prerequisites. No answering/audio session has been tested or initiated.

## PIN failure interpretation

The supplied event table, pages 20-22, now gives names to captured major=5 events:

| Decimal minor | Hex minor | Documented meaning | Evidence |
| --- | --- | --- | --- |
| 148 | 0x94 | Password authentication attempt limit reached | Captured after failed PIN attempts |
| 150 | 0x96 | Password authentication failed | Captured during the failed change test |
| 181 | 0xb5 | Password authenticated | Captured during witnessed initial PIN acceptance |
| 214 | 0xd6 | Device unlocking record | Captured with password/card/centerplatform method |

This establishes what the recorded codes mean. It does not identify the cause of the first
changed-PIN rejection, prove the current lockout duration, or authorize bypassing protection.
The last diagnostic retained the new PIN and sent the vendor UI's door-1 RightPlan. Its PIN
readback succeeded, but RightPlan still read back empty and the owner has not retried it.
The owned temporary user remains in the private cleanup ledger for the supervised session.

## Error dictionary references

The parser maps `deviceCardFull` (row 2153), `deviceUserFull` (2228) and `cardFullPerUser`
(2233) to capacity errors, and `deviceUserAlreadyExist` (2230) to a conflict. Existing card
conflict handling matches row 2196. Device-busy status 2 has a distinct error. The observed
web client also names `userPasswordAlreadyExist`; this is firmware-source evidence, not a
claim that the supplied workbook contains that entry. Raw device error text is never echoed.

## Phase boundary

Phase 0 protocol reconnaissance is sufficient to start the core integration under the
owner's explicit continuation instruction. Physical acceptance remains open for PIN
change/removal, credential CRUD and rights, successful call transitions and later HA/soak
checks. Documented implementations can proceed with capability checks and mock tests;
unverified hardware behavior must remain explicitly unverified. No physical test is inferred
from documentation or a green test suite.

## Phase 2 implementation notes

- User and card search pages 472 and 452 name the terminal empty status `NO MATCH`;
  the client accepts this documented spelling and the earlier `NOMATCH` spelling.
- The active station's downloaded person editor also uses `CardInfoDelCond.CardNoList`
  for individual card removal. This agrees with the manufacturer deletion schema;
  physical card CRUD still awaits supervision.
- The manufacturer defines validity between 1970-01-01 and 2037-12-31 23:59:59.
  Date-limited records require an explicit timezone and ordered bounds. Permanent validity
  is distinct from disabling a person; disable/revoke uses verified absence reconciliation.
- Phase 2's production access client read the current users/cards successfully without writes:
  two users, one card, local PIN mode, advertised PIN length 4–8 and five cards per person.
  Counts and capabilities are evidence; they do not extend the physical acceptance results.

## Real sync failure and fix (0.6.1-alpha.1)

The owner installed 0.6.0-alpha.1 through HACS and reported outbound synchronization errors.
A credential-free production-manager test reproduced `statusCode=6`, `badJsonContent`,
error code 1610612759, with the exact field indication `beginTime and endTime`.
The generic 1970/2037 bounds failed in both UTC and local form, despite `Valid.enable=false`.
The interior 2000/2030 UTC interval was accepted and read back. Disabled validity means permanent
access per the manufacturer contract; these auxiliary dates do not introduce an expiry.
No narrower undocumented general range is inferred from these samples.

After the fix, production-manager create and name-only update both reached `synced`.
The isolated test record had no PIN/cards, was deleted with the targeted API, and absence was
verified. Existing users/cards were unchanged. Sanitized evidence is in the station B fixture.

A separate timed UTC sample was accepted but returned offset-bearing times with `timeType=local`.
This contradiction does not prove how physical expiry is enforced. Timed readback fails with
`validity_timezone_mismatch`; no timezone conversion or success is inferred. A supervised
validity-boundary test is required before claiming reliable timed access on this firmware.


## Reader-based card collection (0.12.0-alpha.1)

Main-document page 87 supplies the explicit support gate and default CaptureCardInfo workflow;
page 481 supplies its capability and response schemas. A new read-only firmware check confirmed
isSupportCaptureCardInfo=true and CardInfoCap.cardNo bounds1–32. Reader ID/technology capability
fields were absent; the documented default route therefore omits readerID rather than assuming1.
No collection request or physical operation was issued for this check.

The implementation uses the dedicated collection result, not ordinary access events. Collected
physical technology is not the normalCard access enum. Full identifiers stay server-side until
explicit user-revision-bound approval. [Contract and commissioning plan](CARD_ENROLLMENT.md).
