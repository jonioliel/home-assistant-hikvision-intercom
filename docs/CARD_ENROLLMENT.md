# Reader-based card enrollment — 0.12.0-alpha.1

This optional Phase 6 feature collects one card using the manufacturer's dedicated reader API.
It never treats an ordinary access-event record as an enrollment result. Manual card entry and
existing device-user adoption remain available independently.

## Operator workflow

1. Save the intended central user first. In **Users**, choose **Read card from station** beside
   that user. The selection captures that user's central revision.
2. Select an online station with a configured managed lock. Read-only identity and capability
   requests determine whether collection is supported and which reader choices are advertised.
3. Click **Start card collection**. After preparation, the dialog prompts you to present one card.
   The station may apply its normal rules to an already authorized card, including unlocking;
   collection does not disable normal access or promise that an existing card cannot open a door.
4. Inspect the masked card suffix, optional reported technology, user name and existing assignments.
   Enter an optional card label. A collected card is not automatically saved or assigned.
5. Choose **Add card & sync**, then confirm. The integration adds one enabled normal access card
   to the user's existing cards. The user's active state, dates and station assignments stay intact.
   Existing station queues perform reconciliation and fresh device checks, including offline work.

Only existing users are eligible; collection cannot silently create a person or adopt an unmanaged
station record. A card already owned by another central user or reserved by pending cleanup fails
existing uniqueness checks. An identical card already on the selected user is rejected as a
conflict rather than duplicated. Device ownership/capacity conflicts still require normal review.

If the user is edited or deleted during collection, approval is invalidated. Close the dialog and
start from the current record. A failure during collection saves no card. A missing response to
**Add card & sync** can be uncertain: inspect the user and Sync before retrying. Durable storage
may have completed even when the browser did not receive its response.

## Lifetime, privacy and cancellation

The server permits one session per station and three simultaneous sessions in total. The raw
card number stays in an administrator-owned backend object and never appears in the preview,
WebSocket replies or errors. Confirming stores it in the existing private access database;
otherwise cancellation, expiry or station unload removes the in-memory result.

A collection HTTP request is bounded to 30 seconds; identity/capability preparation is separately
bounded. Sessions expire two minutes after start, including preparation. A durable save already
in progress finishes under the existing storage protection; it is not abandoned by timeout or a
second cancellation. Another administrator cannot inspect, approve or cancel someone else's session.

Closing the dialog, changing the station or disconnecting the panel requests cancellation and
invalidates pending UI responses. If communication is lost, the backend's expiry still applies.
A late start response is cancelled when received; late status replies cannot reopen the preview.
The integration cancels its local request. The supplied protocol does not define a matching
cancel/reset operation, so the firmware's own reader timeout remains unverified.

No automatic retries, polling of the collection endpoint, background card harvesting or event-based
capture are performed. UI status polling reads only the private local session. Physical card
acceptance, removal and the behavior of an already-authorized card during collection still need
supervised testing; a successful API response alone cannot establish them.

## Protocol and observed evidence

The owner's main ISAPI document, page 87, defines the isSupportCaptureCardInfo gate and default
collection route. Page 481 defines the detailed capability and result schemas:

- GET `/ISAPI/AccessControl/capabilities`: a single explicit true collection-support flag is required.
- GET `/ISAPI/AccessControl/CaptureCardInfo/capabilities?format=json`: `CardInfoCap` defines optional
  card-number limits, physical card technologies and reader-ID bounds.
- GET `/ISAPI/AccessControl/CaptureCardInfo?format=json`, optionally adding an advertised `readerID`:
  result `CardInfo.cardNo`, optional `cardType` and `readerID`.

The 2026-09-08 read-only check of DS-KV6124-E1 V3.9.0 build 260115 returned support=true and
cardNo length 1–32, without readerID/cardType capability fields. This permits the documented
request with readerID omitted. The UI's default choice is an internal sentinel, never readerID=0
on the wire and never an invented readerID=1. A selected reader must be advertised; any returned
reader ID must be valid and match an explicit selection. Unknown technologies/results fail closed.
Physical technology such as TypeA_M1 is separate from the normalCard access-control type.

[Sanitized capability evidence](../tests/fixtures/capture_capabilities_readonly.json) contains
only allowlisted capability fields; no card was collected for this evidence. No model allowlist
change or station-storage migration accompanies this release.

The collector borrows the managed HTTP pool through a separate I/O lock, allowing normal station
requests while it waits. It does not take the relay/access mutation lock and does not issue a
remote-open command. Shared network/device resource limits still apply.

## Deferred physical test HW-ENROLL

Use an owner-approved test card and a dedicated central user. Confirm that only supported reader
choices appear, start once, present once and record the physical behavior and masked result. Cancel
and confirm no central card was added. Repeat, confirm the addition and verify readback/sync plus
physical acceptance. Remove only that test card and verify denial and completed cleanup. Record
an existing authorized card's behavior separately if the owner chooses that test. Do not modify
or remove the owner's original user/card.

Capture-timeout recovery, reader behavior after cancellation and simultaneous live camera/status/
door control also need observation. Use the version/firmware/time/result fields in the
[deferred validation ledger](DEFERRED_VALIDATION.md). The automated suite simulates all device I/O.

## Owner evidence — 2026-09-10

The owner reports successful card creation/writing, assignment, updating and deletion. These operations no longer need to be treated as wholly untested hardware behavior. This report does not explicitly cover two simultaneous cards assigned to one person, reader capture cancellation or expiry; those narrower checks remain open in DEFERRED_VALIDATION.md. No card numbers or user identities were recorded in this evidence.
