# WisKey → Arx · rc37-contract.2

Documentation delta to `rc37-contract.1`; prepared 2026-09-30 in response to Arx's document dated 2026-10-01. This is not a WisKey runtime release or a callable delegation API.

Runtime baseline: `2.0.0-rc.37`. Inspected local source: `909579e3d113803e6274dbe4e4046aa5e6bf3c3c`. Arx cites published commit `4bffe08`; equivalence of those trees has not been verified. Bridge baseline `smplwise_bridge 0.3.1` and deployment details are Arx-reported, not independently inspected.

Read `REPLY_TO_ARX_HE.md`, then the master `DECISIONS_WISKEY_ARX.md`, then `DELEGATION_V0.2.md`. The latter is a reviewable proposal for bridge development; no signature, endpoint or capability there exists in rc.37.

`schemas/` and `tools/` contain unchanged copies of the previous static catalogs and generator. They are not full nested schemas or an authorization oracle. Keep the prior contract.1 source/build package as the baseline. No replacement installation is required for this delta.

WisKey development continues: future features must be discovered and integrated through versioned capabilities, generated schemas and explicit adapters. Arx should build one adapter and refresh its pinned contract on each handoff, rather than copy WisKey private handlers or fork the whole UI.

Verification in this delivery: archive integrity, JSON parsing, expected catalog counts and identical catalog hashes against contract.1. No runtime implementation, live HA/Arx tests, media tests, reauth tests or physical actions were performed. Prior client unit tests are historical evidence, not a new test run.
