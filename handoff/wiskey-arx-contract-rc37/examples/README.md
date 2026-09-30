# Examples and evidence

`arx-readonly-client.mjs` and its tests are integration helper code written for this handoff. They use an injected, already authorized transport and contain no HA token, station credential or WisKey private source code. The tests use synthetic responses; they verify adapter behavior, **not** a live HA installation.

No real sanitized request/response/error transcripts from the owner's site are included because this workspace has no live Arx/HA session. Any example JSON added later must carry a provenance label (`LIVE_SANITIZED`, `TEST_FIXTURE` or `ILLUSTRATIVE`) and must remove secret values and identifying network/person data. Do not label a fabricated response “actual”.
