# Health, event evidence, WebRTC and field acceptance

Version 0.21 adds **Health & field tests** to the administrator panel. Open a station's
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
If HA does not advertise WebRTC, signaling fails, the peer disconnects, or setup exceeds
12 seconds, the player falls back to HA HLS. The transport label states what was selected.
A backend provider and compatible network/codecs are required for actual WebRTC playback.
The browser requests receive-only tracks; microphone/two-way audio is not implemented.
See the [HA camera signaling contract](https://github.com/home-assistant/frontend/blob/dev/src/data/camera.ts)
and [HA camera player lifecycle](https://github.com/home-assistant/frontend/blob/dev/src/components/ha-web-rtc-player.ts).

Call controls appear inside the media detail after refreshing a station. They are
signaling controls only: answer/reject require a fresh `ring` state; hangUp requires
`onCall`. Each command rechecks device identity and its advertised enum, sends one
PUT CallSignal, and requires an explicit success status. A lost response is never retried
automatically. Acknowledgement is not evidence that a person answered or audio works.
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

[Current 20-task evidence ledger and remaining work](CORE_MEDIA_BATCH_HE.md).
