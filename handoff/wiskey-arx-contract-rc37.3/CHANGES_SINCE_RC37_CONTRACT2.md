# Changes since rc37-contract.2 · 2026-10-01

- D-006 requirement accepted by Arx, now agreed; implementation remains open. Exact proposed field/schema contract requires review.
- D-001 updated with reported current security settings, phone /arx priority and Companion transition only; bridge work follows CR-015.
- New D-007 proposal: heartbeat20s/timeout60s, bounded by Arx login, independent of idle/elevation; absolute lifetime remains open.
- Answered schema schedule as phased delivery, local+TOTP proof acceptance target, and heartbeat choice without inventing release dates or tested support.
- Explicitly recorded Arx current cache/UI still holds personal last_access until B0; planned removal includes stale cache/reconnect.
- Added minimal closed D-006 result schema draft and field allowlist. Seven current complete command schemas remain pending. No endpoint/runtime implementation.
- v0.3 addendum preserves v0.2 as design provenance and distinguishes existing unlock/elevation behavior from proposed purpose-bound proof.
- Static baseline catalogs/generator unchanged; runtime rc.37 unchanged, no deployment/live actions.
