# WisKey → Arx native contract review — rc.37-contract.1

Date: 2026-09-30. Inspected local WisKey source reports `2.0.0-rc.37`; local checkout commit is `909579e3d113803e6274dbe4e4046aa5e6bf3c3c`. Arx's request cites published rc.37 commit `4bffe08`; this package does **not** assert those two trees are byte-identical. The prior rc.37 release handoff remains the installable build. **This package is documentation and read-only sample code, not a new WisKey release or implemented delegation API.**

Read `DECISIONS_WISKEY_ARX.md` first for the identity answer, then `ANSWERS.md` for numbered answers. `DELEGATION.md` describes a proposed additive design, with every unimplemented element marked. `SCOPES.md`, `MEDIA.md`, `AUDIO.md`, `DATA_MODEL.md`, `ADAPTER.md` cover source-confirmed behavior and limitations. `schemas/commands.static.json` contains 238 commands with top-level request registration, permission classification and request limits. `schemas/errors.static.json` contains 301 literal error codes with source locations. The generator is included under `tools/`. These two catalogs are **static extracts, not complete nested/response schemas and not a promise that all 301 errors reach every command**. Do not use them alone to enable writes.

`request/ARX_REQUEST.md` is Arx's original question for cross-checking. `source/WisKey-Arx-native-integration-rc37.zip` is the earlier rc.37 source/build handoff, included for self-contained review; its build is not modified by this contract reply.

## Evidence status

- **DONE:** Read Arx's request sections 0–10; inspected WisKey rc.37 source for identity, command dispatch, permissions, projection, media, audio and audit. Generated and parsed both JSON catalogs. Ran the included read-only adapter unit tests.
- **NOT_RUN:** Live HA/Arx integration, physical station actions, 10 live streams, microphone/speaker verification, Companion, per-command runtime schema tests, delegation tests (feature does not exist).
- **NO LIVE EXAMPLES:** No access to the owner's installation or sanitized real responses. Example envelopes in this package are synthetic and labelled so; supplying them as live evidence would be misleading.

## Continuing development and upgrade discipline

WisKey development continues beyond rc.37. Arx must discover `overview.api.version`, `min_client`, `capabilities` and per-user `commands` at each connection; gate each screen/action rather than hard-coding a release label. Treat missing optional fields and new enum members as forward-compatible; never silently infer a grant. Pin any shared UI adapter to a WisKey release, and run a contract diff on every new WisKey handoff. Keep `embed-api-v1` as a rollback path until the native implementation passes field acceptance. New WisKey features will require additive catalog updates and a separate Arx parity decision.

**Contradictions / corrections:** `DELEGATION.md` cannot be delivered as an implemented contract yet; `via` requires audit representation changes, contrary to Arx's no-storage-change draft. A delegated session is not currently equivalent to HA `ActiveConnection` for security, subscriptions, audio and TTS. The proposed reauth page and web-component bundle do not exist. Camera `stream_source()` is an HA camera method, not a frozen external WisKey media API. Details are in `DECISIONS_WISKEY_ARX.md`.
