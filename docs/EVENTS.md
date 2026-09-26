# Events and audit history

The commissioned station's stream emits JSON parts, including nested form-data headers.
The parser honors Content-Length, bounds structured parts to 256 KiB, skips image bodies,
rejects malformed/oversized framing and reconnects with backoff. A separate connection
leaves call polling and controlled credential writes available. Stream tasks stop on unload.

`event.<station>_access` exposes documented major-5 meanings: card/PIN accepted or denied,
PIN attempt limit, unlock/lock reports, contact reports and device alarms. An authentication
acceptance is not proof of physical release; an unlocking record retains an unknown result.
Unknown major/minor combinations stay unknown. Door is physical 1 only when a supplied
API door number matches the explicitly commissioned mapping. A missing door stays unknown.
Only an explicit employee ID resolves a managed person's name. No inference from timing.

`event.<station>_doorbell` uses the `ring` event type from native HA event entities.
Until a reliable station-specific push ringing message is commissioned, a transition to
ringing in the existing call poller provides the event. Initial/recovered ringing does not
create a new press. A two-second debounce suppresses rapid repeated transitions. `onCall`
continues to mean busy; it is not evidence that somebody answered.

Automation example (select the actual entity ID in HA):

```yaml
triggers:
  - trigger: state
    entity_id: event.front_doorbell
conditions:
  - condition: template
    value_template: >-
      {{ trigger.from_state is not none and trigger.to_state is not none
         and trigger.to_state.attributes.event_type == 'ring'
         and trigger.to_state.state not in ['unknown', 'unavailable']
         and trigger.from_state.state != trigger.to_state.state }}
actions:
  - action: persistent_notification.create
    data:
      message: Someone is ringing the intercom.
```

History is private, versioned `.storage/hikvision_intercom.events`, capped at 5,000 records
and 30 days from receipt, pruned hourly and on queries. It contains masked cards and no PINs,
raw payloads, images or device URLs. A short batching interval reduces disk writes; an abrupt
power loss may lose the last unsaved batch. Graceful shutdown flushes pending history.
Storage errors are visible in the panel. Back up the complete HA configuration normally.

The admin-only Events tab filters by time, station, person/employee ID, result, authentication
and physical door. Each response has at most 200 records. Historical entries are labeled.
Query recovery starts with the preceding day, overlaps saved cursors, and checks complete
pagination before advancing. Dense queries are narrowed to honor station page-position limits.
Recovery older than 30 days is outside this cache's retention scope. Missing/incomplete
history is reported; no completeness is claimed after device log deletion or overflow.

A recovered query record, `currentEvent=false`, missing/invalid device time, or a timestamp
outside the freshness window does not trigger a live HA event. Query-based recovery updates
only the audit view. Live access automations therefore require the event stream; call-status
polling remains the doorbell fallback. Keep the station clock accurate.

Event serials wrap, so live deduplication also includes timestamp and station identity.
The observed query omits event serials and can return identical records in one second.
Occurrence ordinals preserve those records across overlapping queries. Stream and query
records may appear separately where their identities cannot be established as equivalent;
we do not merge them by guessing. Recovered entries never retrigger live automations.

Validation: the real station returned 241 event records in nine pages. A separate 12-second
capture parsed 13 framed documents, including 11 access events, with no writes. Published
fixtures contain counts/field names only. Original manufacturer sources remain private.

Native HA event API reference: https://developers.home-assistant.io/docs/core/entity/event/
