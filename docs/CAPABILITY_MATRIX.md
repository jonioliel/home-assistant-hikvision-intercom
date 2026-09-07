# Observed device capabilities

One DS-KV6124-E1, firmware **V3.9.0 build 260115**, checked on 2026-09-07 UTC
(2026-09-07/08 in Asia/Jerusalem). Evidence is in
[`tests/fixtures/ds_kv6124_e1_fw_3_9_0`](../tests/fixtures/ds_kv6124_e1_fw_3_9_0).
Phase 0 is still open for physical observations.

| Area | Observed result | Scope and remaining verification |
| --- | --- | --- |
| Network/authentication | TCP 80, 443, 554 reachable; HTTP Digest reads successful | Port 443 alone does not establish trusted TLS. No invalid-password test was attempted. |
| Final ISAPI scan | 20/20 reads returned HTTP 200 and expected structured payloads | Two POST routes are bounded UserInfo/CardInfo searches; all others are GET. |
| Call status | `CallStatus.status = idle`; 11 unattended samples also idle | Bell, answer, hangup, missed call and return-to-idle sequence pending. |
| WorkStatus | `lockID=1`, `lockStatus=offline` | Preserve raw value; not a proven lock state or physical fault. |
| Users | Count 0; search `responseStatusStrg=NO MATCH`, 0 matches | Populated pagination and create/update/delete/readback pending. |
| Cards | Count 0; search `responseStatusStrg=NO MATCH`, 0 matches | Reader authentication, format, duplicate policy and CRUD pending. |
| User capacity | Advertised 2,000; employeeNo length 1–32; name 0–32 | Advertised limits, not a capacity load test. |
| Card capacity | Advertised 6,000 and 5 cards/person; cardNo length 1–32 | Acceptance and card-number encoding remain unverified. |
| Search page size | User/card capability maximum 30 | Probe default stays 10; empty datasets cannot prove multi-page behavior. |
| PIN schema | `password` and `localPassword` advertise 4–8 | No PIN was read, written or tried at the keypad. |
| PIN mode | `pwMgrMode=local`; capabilities list `platform,local`, default `platform` | Current setting is local, regardless of advertised default. Do not enable platform PIN writes without establishing the mode and behavior. |
| Remote door metadata | doorNo range 1–2; commands `open,close,alwaysOpen,resume` | No command sent. API-to-physical relay mapping remains unknown. |
| RightPlan | maxSize 1, doorNo 1–2, maxPlanTemplate 4, planTemplateNo 1–255 | Do not infer two independent door assignments or enforcement. |
| Snapshot | HTTP 200 JPEG; independently decoded 704×576 | Pixels omitted. HA camera acceptance pending. |
| Main RTSP stream | TCP `/Streaming/Channels/101`; five H.264 frames decoded at 2688×1520 in about 1.55 s | Short in-memory check only; no audio/playback or endurance test. |
| Stream audio metadata | G.711ulaw advertised in channel settings | Audio not decoded, listened to or transmitted. |
| Alert stream | HTTP 200 multipart/mixed with Content-Length-delimited JSON | Complete events received; live bell/access meaning pending. |
| Historical access events | `AccessControllerEvent` with `currentEvent=false` | Must not be treated as evidence of a new access attempt. Numeric event codes remain uninterpreted. |
| Stream reconnection | Two HTTP 500 responses; later retry HTTP 200 | Recovery occurred, but cause, required delay and sustained reliability are unverified. |

## Firmware-specific findings applied to the probe

- Use `CallStatus.status`, while retaining compatibility with the earlier scalar fixture form.
- Recognize `responseStatusStrg` as well as `responseSearchStatusStrg` in search responses.
- Parse complete JSON MIME parts by Content-Length; retain legacy XML event support.
  Ignore incomplete or oversized parts without promoting them to support evidence.
- Start a fresh Digest challenge for each read. Reusing cached authorization after closing
  the event stream produced HTTP 401 without WWW-Authenticate on this station. A fresh
  challenge succeeded, and the final scan and unattended call samples passed.
- Retain numeric capability bounds, context-specific card counts and PIN-mode enums while
  redacting actual credentials and identities.

## PIN-mode route provenance

The candidate `/ISAPI/AccessControl/PwMgrParams` paths returned 404/notSupport.
The station's own web client then identified the actual route beneath `UserAndRight`:

- GET `/ISAPI/AccessControl/UserAndRight/PwMgrParams/capabilities?format=json`
- GET `/ISAPI/AccessControl/UserAndRight/PwMgrParams?format=json`

Both actual routes returned HTTP 200. The UI asset `com_1891ea61.d2549e3a.js` supplied the
route names, and `com_45239610.181bf208.js` uses the `platform`/`local` options.
Vendor JavaScript and private connection data are not included in this repository.

## Required physical continuation

1. Correlate a timestamped callStatus capture with bell press, answer, end and idle.
2. With a witness and a concrete test instruction, operate one relay at a time and record
   the physical output and acknowledgement. Do not assume ID 1 maps to physical Relay 1.
3. Confirm the current PIN Mode in the device UI, then plan temporary test credentials,
   mode changes only when authorized, acceptance, changes, removal and duplicate behavior.
4. Test temporary users/cards, readback and deletion, multiple cards, door rights and denial,
   validity and RightPlan behavior. Remove only test-owned records.

Reboot, Home Assistant/HACS install and upgrade, nine-station acceptance and soak testing
remain later commissioning gates. No physical mutation was performed in the remote session.
