# Changes since contract.3 · 2026-10-01

- Incorporated Arx reply3; D-007 accepted heartbeat components now agreed, unresolved lifecycle/caps explicitly separated into proposed D-008.
- Proposed remote expiry=min(token_exp, open+30min); identified absent token_exp for Ingress and proposed finite30min plus verified reopen.
- Proposed rotation handover without session-state transfer and candidate global in-flight/subscription/event caps before implementation/load gates.
- Proposed short-lived bridge challenge to prevent delayed valid heartbeat from extending session under existing60s HMAC freshness window.
- Added operational-label description to name in proposed background schema. No call_state/model/firmware added; call_state considered after live B0.
- Baseline238-command/301-error static catalogs and generator unchanged. Complete current read schemas and runtime implementation still pending. Documentation only, no update/deployment/live tests.
