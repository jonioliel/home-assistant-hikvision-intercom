# Changes since rc37-contract.1

- Incorporated Arx decisions: D-001 amended/agreed, D-002 open, D-003 agreed; added D-004 and D-005 with explicit source and state.
- Added D-006 proposal and corrected ANSWERS 8.2's personal-free background implication: station last_access may contain person identity despite denied users/events.
- Answered Arx's five questions, including MIT catalog reuse, server descriptor direction and same-origin proof preference.
- Delivered DELEGATION v0.2 design now, without a release date or callable interface; added users/get and conditional subscribe to candidate allowlist.
- Clarified future development through one adapter, schema/capability delivery and explicit migration gates. No new native writes, executable SDK or independent UI components are delivered here.
- Retained static generator/catalogs byte-for-byte from contract.1 (238 commands, 301 literal errors). Full nested schemas remain pending.
- Runtime source/build/version unchanged. No deployment or live tests performed. This delta supplements, rather than replaces, contract.1 and its source/build archive.
