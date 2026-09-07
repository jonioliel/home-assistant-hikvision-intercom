# DS-KV6124-E1 — V3.9.0 build 260115

Real responses captured from one owner-authorized station on 2026-09-07 UTC.
The owner requested remote read-only checks because nobody was beside the station.

- `capability_report.json` and the 20 endpoint files are the final successful ISAPI scan.
- `remote_validation.json` combines ISAPI evidence with the separate RTSP decode check.
- `media_observation.json`: five H.264 frames decoded in memory using PyAV 16.1.0,
  plus a decoded JPEG snapshot. No images, audio, video or credential URLs were saved.
- `historical_alert_stream.json`: an earlier stream containing historical access events.
- `auth_reuse_observation.json`: response codes and authentication-presence booleans from
  diagnosis before the fresh-Digest fix; no challenge, nonce, username or password values.
- `stream_reconnect_later.json`: one delayed reconnection succeeded after two HTTP 500s
  recorded in the final report's observations. This is not sustained-reconnect acceptance.

Payloads are normalized and conservatively redacted. XML attributes use `@name` and text
uses `#text`; namespaces are listed separately. These are exact observed structures after
that transformation, not original wire bytes. IPs, serials, card/PIN values, timestamps,
user identities, unknown values, Digest headers and image pixels are omitted or REDACTED.
The JSON MIME test framing is reconstructed around these sanitized payloads, with synthetic
boundaries and recalculated lengths. It is not represented as raw captured MIME.

The endpoint-specific files keep HTTP status, method/path, media type, elapsed time, size,
truncation and normalized payload. `true` for users/cards proves search reads only.
The ISAPI report keeps RTSP null because that CLI does not decode video; the separate
validation summary records the independently observed video evidence with its source.

Do not infer relay mapping, PIN/card acceptance, permission enforcement, populated search
pagination, call-state transitions, HA compatibility or nine-device reliability from this set.
No configuration, credential, relay or reboot operation was performed.
