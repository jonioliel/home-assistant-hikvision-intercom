# Supervised station B evidence — 2026-09-08 UTC

DS-KV6124-E1, V3.9.0 build 260115. A second owner-provided station was tested
with an on-site witness. These are normalized, sanitized observations, not raw
wire captures. No station address, person ID, card number or PIN is published.

- The populated baseline contains one owner-created person and one bound test card.
- The owner pressed the bell and heard a busy tone. All 283 call samples were idle.
  The concurrently started event connection failed with HTTP 401. Later isolated
  streams worked. This does not establish ringing or answered-call behavior.
- API door 1 accepted a normal open command. The owner confirmed that the door
  lock released and returned to normal. The first, unwitnessed attempt is not
  counted as physical confirmation.
- The owner confirmed the existing test card opened the lock. Card-to-user
  binding and the event card number were compared in memory. The matching event
  did not identify a person; `matches_test_user: false` must not be interpreted
  as a different person or an authentication denial.
- A separately owned temporary user was created with `localPassword` in local
  PIN mode. The initial six-digit PIN alone opened the lock, without `#`.
- Modifying that PIN returned HTTP 200/statusCode 1 and exact secret readback,
  but the owner reported both old and new PINs failed; the new one gave an error
  tone. This is a failed physical change test, not successful synchronization.
  Follow-up diagnosis and temporary-user cleanup are still pending.

`currentEvent: false` denotes replayed access events and is not a new attempt.
Live card/password/centerplatform observations remain scoped to the witnessed
operation. Numeric event codes alone are not given universal meanings. Bodies
and unknown fields use the probe redactor; comparison flags and owner observations
are test annotations. Vendor JavaScript is excluded from the repository.

Owner scope: one active relay per station; relay 2 is disabled and excluded.
There is no answering screen, so answer/hangup confirmation is deferred.
