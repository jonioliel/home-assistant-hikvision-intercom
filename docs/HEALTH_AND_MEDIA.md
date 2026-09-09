# Health, event evidence, WebRTC and field acceptance

Since version 0.21, the integration provides **Health & field tests** in the administrator panel. Open a station's
report to inspect event-stream/history status, sync queue/error counts, clock offset and
media capability observations. Refresh is optional and read-only; up to three selected
stations are read at once. Exported compatibility reports omit host, device login,
person names, user IDs, cards and raw device data. Timestamps remain useful diagnostic evidence.

Event details show the normalized record's identity availability and origin. A history
query or non-current record does not fire live access automations. Receipt minus device
time includes clock offset and delivery delay; it is not a pure network latency metric.
Counters reset when the integration reloads. The delay summary retains at most 100 stream
samples and excludes history queries. Identity is never guessed from a PIN or nearby event.

The camera player asks HA `camera/capabilities` for `web_rtc`, then uses HA's authenticated
`camera/webrtc/get_client_config`, `camera/webrtc/offer` subscription and
`camera/webrtc/candidate`. This reuses the WebRTC provider configured in Home Assistant;
no third-party server address or station credentials are sent by this panel to the browser.
If HA does not advertise WebRTC, signaling fails, the peer disconnects, or no decoded video arrives within
12 seconds of RTC setup, the player falls back to HA HLS. The transport label states what was selected.
A backend provider and compatible network/codecs are required for actual WebRTC playback.
The browser requests receive-only tracks; microphone/two-way audio is not implemented.
See the [HA camera signaling contract](https://github.com/home-assistant/frontend/blob/dev/src/data/camera.ts)
and [HA camera player lifecycle](https://github.com/home-assistant/frontend/blob/dev/src/components/ha-web-rtc-player.ts).

In 0.22 call controls also appear in the camera dialog and active-call station view. They are
signaling controls only: answer/reject require a fresh `ring` state; hangUp requires
`onCall`. Each command rechecks device identity and its advertised enum, sends one
PUT CallSignal, then observes at most three status reads within five seconds. The result separates
acknowledgement (including unknown after a lost response) from changed/unchanged/unavailable state.
A lost response is never retried automatically and requires a fresh context before the next command.
Acknowledgement is not evidence that a person answered or audio works. `onCall` remains busy, not proof
of an answered call. Pending commands are owned per station and cancelled on runtime unload.
The manufacturer contract is sections13.11.2 and two-way-audio flow; the observed
firmware advertises all three commands, but physical call acceptance remains pending.

Field results are operator attestations. Each station starts unverified. Select a result
and save it after a witnessed test; changing a selection alone does not save. Reports
persist in the private HA `.storage/hikvision_intercom.acceptance` store with an atomic
save, revision check and timestamp. They do not send commands or store free-text secrets.
An unavailable/corrupt result store does not replace prior results with empty success.
Export is per station; the operator chooses the filename/location and retains its context.

For an external read-only fleet observation, create an ignored private JSON list of up to
nine ConnectionSettings mappings and run:

```console
python -m tools.fleet_soak --config private/fleet.json --seconds 300 --interval 5 --output private/soak.json
```

Use existing authorized station credentials in that private file. No password command-line
argument is accepted. The tool stops a station after authentication failure, bounds each
read and the measurement window, retains at most 1000 successful timing samples, and
exports anonymous slot numbers, counts and timings. Output files must not already exist.
A recovery count means a successful status read after failed reads, not proof of sync,
reboot recovery, physical release, live video or a nine-station acceptance test.

[Current 20-task evidence ledger and remaining work](CALLS_AND_HISTORY_BATCH_HE.md).

The observed firmware rejects the aggregate audio-capabilities URL but accepts the enumerated
channel1 capability URL. Health refresh tries that documented route when aggregate reading fails,
and reports its source and allowlisted codecs. This is capability evidence, not an opened audio session.


## Event capture and history inspection — 0.22

In **Health & field tests**, select a station and explicitly start a capture before the coordinated
bell/PIN action. Refresh or stop and export afterward. Capture lasts up to 90 seconds with at most
300 observations, consumes the existing event/status observations and does not issue station commands.
It is in-memory and ends on reload; no field-acceptance result is assigned automatically. Family names,
allowlisted voice-talk commands, times, codes and identity field-presence survive export; names, IDs,
PINs, cards and raw frames do not. Recognition of `voiceTalkEvent` here is diagnostic only and does not
add an unverified ringing trigger. Event-specific source evidence is retained for at most 128 records
per running station; older events may have no source evidence after restart.

The adjacent history form accepts a station display-zone range of at most 24 hours. The inspection
uses a separate optional read lane and bounded queries, returns completeness and whether returned
times satisfy the requested window, and emits no live automations or recovery cursor updates. Empty
results leave time-filter verification unknown. Dense/incomplete results require a narrower window.
Identity summaries expose field availability, not a reconstructed identity. Do not infer an employee
from a PIN value, nearby event or shared timestamp. The [verified local-time adapter](TIME_ZONES.md)
handles the observed firmware history format before generic normalization.

## Player recovery and support reports — 0.22

Capability discovery times out after 10 seconds; WebRTC requires an actual video frame within 12
seconds. A disconnected peer has a 3-second recovery window; failure/ended track tears down the peer
and starts HLS. HLS setup/first-frame waiting is bounded at 16 seconds. Backgrounding the page or
losing browser connectivity stops playback resources; returning to a connected visible page restarts
setup. Replacing the HA connection also restarts setup. Candidate queues and signaling counts are bounded.

**Playback report** is available even after failure. It includes selected mode, first-frame time,
fallback reason, video dimensions and allowlisted RTC counters/codec when obtainable within two seconds.
It omits credentials, entity IDs, SDP and ICE addresses. A transport selected during failed setup is
not proof of successful playback; inspect first-frame/decoded-video evidence as well.

HA integration tests register and unregister a WebRTC provider against the actual camera implementation,
verifying that `camera/capabilities` advertises it. See the
[HA camera entity contract](https://developers.home-assistant.io/docs/core/entity/camera/).
This is software verification; actual owner-system playback and two-way microphone audio remain separate.
