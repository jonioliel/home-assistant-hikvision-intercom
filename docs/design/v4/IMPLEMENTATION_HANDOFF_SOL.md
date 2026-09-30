# Implementation handoff — WisKey Design 04
Audience: Codex Sol or another implementation agent. This document is the entry point after the user approves the visual design.
Baseline inspected: v1.9.3, commit `6f22d29640b3e0a50b96a05976f0e8c496954299`, 24 September 2026.
Workspace: `C:/hik intercom`.

## 0. Scope and approval
This package is an approval prototype, NOT a production patch. First confirm that the user has approved this proposal in the task history. The current request authorizes creating this package, not implementing it. Do not treat this document as user approval.
After approval, implement an ADDITIONAL appearance. Keep `current`, `modern`, `access-light`, and `access-dark`. Do not rewrite application behavior or introduce competitor-only features.
Publishing and installing are separate actions governed by the existing session authorization and repository instructions.

## 1. Read in this order
1. `START_HERE_HE.md`
2. `DESIGN_SPEC_HE.md`
3. `SCREEN_COVERAGE.md`
4. `RESEARCH_HE.md`
5. `gallery.html`, the requested PNGs in `images/`, and the matching renderer in `app.js`.
6. Existing product modules listed below. Read actual current code; line numbers and the baseline may have moved.

The HTML/CSS is a precise visual reference. **Do not ship app.js, its dummy data, innerHTML renderer, or no-op buttons in Home Assistant.** Translate layouts into existing Lit components. Use existing request helpers, server data, event subscriptions, i18n and authorization. Screens in the gallery sometimes represent states/tabs of one component rather than new routes.

## 2. Deliverable contract
Suggested new appearance IDs: `wiskey-light` and `wiskey-dark` (check for collisions first).
- Extend the existing appearance union in `frontend/src/appearance.ts`.
- Extend the server allowlist in `custom_components/hikvision_intercom/appearance_settings.py`.
- Preserve schema/revision validation and the existing default policy; no storage reset.
- The shared default already exists in 1.9.3. Do NOT build a second competing global-preference store.
- Existing user override wins over shared default. “Follow default” removes only that user’s override.
- Existing stored IDs retain their meaning. A global switch must not overwrite local preferences.
- Theme selection stays under Management. Do not add appearance buttons inside the call window.
- New tokens must be scoped under the new host appearance, e.g. `:host([data-appearance="wiskey-light"])`; prefix `--wk4-*`. Avoid global table/button rules affecting HA or older themes.
- Reuse existing icon infrastructure and localization keys. The prototype’s SVG paths are visual guides; do not introduce a second inconsistent icon API.
- Heebo is included with license. Prefer existing font loading; avoid multiple downloads. Preserve an Arial/system fallback.

## 3. Component ownership
| Area | Existing sources to reuse | Implementation boundary |
|---|---|---|
| Shell, routes, panel state | `panel.ts`, `appearance.ts`, `styles.ts`, `api-contract.ts`, `access-control.ts` | Layout and navigation state; no rewriting request handlers |
| Dashboard and cameras | `access-overview.ts`, `camera-wall.ts`, `live-clock.ts`, `camera.ts` | Responsive grids, fixed media identity, independent door busy states |
| People list | `panel.ts`, `user-filters.ts`, `saved-user-views.ts`, `phone.ts`, `types.ts` | Keep server pagination, selection snapshot and query semantics |
| Person view and editor | `user-details.ts`, `panel.ts`, `user-timing.ts`, `timing-validity.ts`, `user-photo.ts`, `usb-card-input.ts` | Preserve one draft/revision; separate view and edit state |
| Groups and profiles | `profile-settings.ts`, `permission-directory.ts`, `profile-fields.ts` | Existing preview/apply receipts and inherited/personal exceptions |
| Station management | `station-technical.ts`, `door-programs.ts`, `public-codes.ts`, `hold-open.ts`, station rendering in `panel.ts` | Existing capabilities, relay mapping and write/readback |
| Camera, audio and TTS | `camera.ts`, `camera-mse.ts`, `camera-rtc.ts`, `call-controls.ts`, `audio-controls.ts`, `microphone-input.ts`, `tts-controls.ts`, `dialog-viewport.ts` | CSS/container changes; preserve all media lifecycle ownership |
| WhatsApp | `user-details.ts`, `whatsapp-templates.ts`, `phone.ts` | Preview/edit/confirm send; current message and media contracts |
| Events and reports | `events.ts`, `event-tools.ts`, `report-tools.ts`, `admin-audit.ts` | Preserve filters, snapshots, export/print and evidence provenance |
| Sync, operations, recovery | `panel.ts`, `bulk-users.ts`, `operations-center.ts` | Keep independent station/user tasks, receipts, revisions and tombstones |
| Health and lifecycle | `health.ts`, `identity-lifecycle.ts`, `fleet-clocks.ts` | No invented aggregate metrics or live checks on every render |
| Settings | `profile-settings.ts`, `media-settings.ts`, `clock-settings.ts`, `appearance.ts` | Existing server settings and capability-specific host actions |
| Advanced schedules | `schedules.ts`, `deployment-plans.ts`, `schedule-operations.ts` | Every advanced action remains reachable, even if not in primary nav |

## 4. Navigation state — prevent the previous person → events bug
Use an explicit top-level view enum. Keep selected person, person read view, and editor draft distinct.
- Clicking a person opens read view, not the editor.
- “Edit” is the only normal transition into a draft editor.
- Navigating to Events clears/hides person viewing state; it must not trigger an editor fallback.
- When a draft is dirty, use the existing leave/keep flow. Never save due to a route or theme change.
- Back returns to the saved people query, page, selection, and scroll position.
- Do not render a hidden editor underneath a new screen with the same person ID.
- Dialog close returns focus to the original trigger. Theme changes preserve focus and draft content.

Map new navigation to the current permission contract, not to arbitrary route names. Keep old deep links working or redirect them explicitly without side effects.

## 5. Person workspace
The default list is full width, not permanently split by a narrow inspector.
The person detail page has:
1. Identity strip, 76px portrait, name, active state, department, role, employee number, nonwrapping phone.
2. Communication/edit/sync actions.
3. A wide permissions area with 8 doors visible in the desktop reference, displaying source and relay.
4. A compact factual column containing credentials and validity.
5. Current activity as secondary content.

On mobile the permissions area comes immediately after the identity/actions. Use page scrolling for long details. Do not place a scrollbar on a portrait or on a small nested details region.
Group membership inherits the station assignment under current rules. Relay permissions remain current explicit selections. Do not fabricate a new hierarchical role model.
The user’s current state is independent from station connectivity and per-assignment sync.

Editor tabs share a single draft: details, doors, days/hours, credentials. Do not discard unvisited fields.
Always mode removes schedule policy; expiry removal remains an explicit choice. Weekly/date policies retain IANA time zone and enforcement mode. Readback/status remains visible after save.
PIN uniqueness is checked by the server both before save and on commit. Keep generated code flow and reservation semantics while removal is pending.
Station card capture and USB capture are distinct inputs to the same explicit confirmation step. Retain cancel/timeout/reconnect cleanup.

## 6. Dashboard and media
Use available content width and height, not browser width alone. The panel is hosted in HA, whose own navigation consumes space.
- Reference desktop: 1440×900 content viewport. 8 doors with activity, or 12 doors without side activity.
- Fewer rows / paging at short height; 4–12 is a view capacity, not a hardware limit. Preserve 1–X stations.
- Retain count selector, per-page navigation, search and full-screen behavior.
- Use object-fit:contain on camera surfaces; no stretching to fill the grid.
- Snapshot thumbnails do not open dozens of live streams.
- Busy/opening state belongs to a station/relay key. An unlock must not disable every door.

Call page:
- Desktop main video plus a 320px TTS area; controls under the video.
- Mobile video + compact controls + TTS remain visible in the reference 390×844 and 360×800 layouts.
- Account for safe-area insets, HA chrome and software keyboard. Do not promise simultaneous visibility with the on-screen keyboard open.
- Refresh is a small camera-local icon with accessible name; not a giant primary button.
- Actual ringing/answer/reject/hangup state comes from existing capability/event data. Command acceptance does not imply answered call.
- PTT/toggle setting is unchanged. No text selection during PTT; handle pointercancel, lost capture, blur and visibility loss.
- Inbound audio via MSE/RTC/HLS and microphone uplink via ISAPI are different paths. Do not “fix” one by relabeling the other.
- Keep video nodes, MediaSource, WebSocket, AudioContext and media tracks stable across status/clock/theme renders.
- Keep user gesture requirements for unmute and getUserMedia. No microphone acquisition on opening a profile or changing theme.
- Keep TTS mutual exclusion/busy handling, character and real decoded-duration limits, cancellation and errors from the existing backend. Styling must not bypass limits.
- Diagnostics stay available in a collapsible area or dedicated sheet; counters are not evidence of audible sound.

## 7. Stations, schedules and shared codes
- Station tabs: overview, opening programs, public codes, settings.
- Programs list exposes real active/paused/removing/error state; edit, pause and delete operate through current HA program API.
- Explain that a door held open differs from a person’s scheduled permission.
- Do not claim native station scheduling when capabilities report unsupported. The advanced deployment path remains gated.
- Public-code slots display configured/unconfigured/unverified, NEVER a recovered plaintext PIN.
- Public code edit is its own component/context, not a personal PIN editor.
- Retain old-code challenge where required. Unknown write result → read/verify, not unsafe automatic repeat.
- Relay 2 management does not grant it to all people. Preserve API mapping and connected-output instructions.
- NTP settings apply to stations; HA host time management remains separately capability-gated.

## 8. People operations and messaging
- Keep 25/50/100/200 server paging, snapshots, selection limits, filters, saved views and search.
- Fit phone in one line; storage/WhatsApp E.164 conversion stays in phone helpers.
- Bulk selection cannot silently expand to every result. Preserve preview, apply, receipt and partial outcomes.
- Import preserves mapping, custom fields/groups, duplicate and capacity checks; invalid rows are visible before mutation.
- Lifecycle report does not auto-merge duplicates or send reminders.
- WhatsApp must remain user → preview → editable text → explicit send. No automatic send from save or PIN generation.
- Service accepted, delivered and read are different. Show only statuses provided by the integration.
- Display media only from the supported authenticated media route. Never invent an attachment endpoint.
- Template placeholder names in the prototype are explanatory; use the exact tokens allowed by the current backend, not assumed token names.
- No full PIN/card values in list rows, logs, analytics, URL or exported mock fixtures.

## 9. Authorization and truthfulness
Source of truth: `custom_components/hikvision_intercom/panel_permissions.py` and `frontend/src/api-contract.ts`.
Five existing areas: overview, users, events, stations, management; levels none/view/manage.
HA operator policy editing stays HA-admin-only, even for an operator with management/manage.
Do not conflate group physical access with HA screen permissions.
Offline device is not inactive person. Server save is not verified station write. HTTP acknowledgment is not physical lock/speaker confirmation.
Preserve distinction between live and historical events, identity source, current portrait and historical evidence.

## 10. Build sequence after approval
Deliver one coherent theme; do not leave hidden legacy islands.
1. Record current branch/version/status. Inspect AGENTS and current tests. Preserve unrelated edits. Create an isolated branch if appropriate.
2. Add namespaced tokens, appearance IDs and migration-safe picker entries. Verify all old appearances still render.
3. Implement shell, responsive navigation and route-state separation.
4. Implement full-width people list and wide person details/editor with shared draft.
5. Implement overview grid and station tabs. Keep actual actions and busy state keyed correctly.
6. Implement call/TTS layout with stable media DOM and lifecycle tests.
7. Cover WhatsApp, groups, schedules, sync/operations, settings, health and reports using the coverage matrix.
8. Run scoped tests, inspect screenshots, then required full release checks. Update changelog and manual-test HTML only for remaining physical checks.
9. Produce a reviewable diff, acceptance results and known limitations. Release only under existing applicable authorization.

A stylesheet-only patch that leaves parts unusable is incomplete. Conversely, replacing business logic to imitate demo data is also incorrect.

## 11. Regression acceptance matrix
| Test | Expected evidence |
|---|---|
| Old theme IDs and global/local preferences | Existing tests + storage/override regression tests; no reset |
| Person detail → Events → Back | Events opens, no editor; filter/page restored |
| Dirty editor → navigation/theme | Intentional leave flow; draft kept; no unintended save |
| People 1/25/200 rows, long names/custom labels | Layout, paging, selection and LTR phone |
| Group inheritance / personal deny / relay 2 | Same effective permissions before and after restyle |
| PIN conflict and generation | Inline error, server uniqueness, no accidental exposure |
| Card station/USB/photo | Same capture lifecycle, timeout/cancel and explicit acceptance |
| 1/4/8/12/25 stations | Capacity adapts; paging; no image distortion |
| One unlock while others usable | Only chosen station/relay pending |
| MSE, RTC, HLS and fallback | Existing tests, stable video node and explicit unmute |
| Toggle/PTT/mic denied/mic missing | Accurate state, actionable errors, tracks closed |
| TTS short/long/busy/error/close | Existing streaming duration handling unchanged |
| WhatsApp preview and history | No send without click; E.164; card-only case; supported media |
| HA schedules and local unsupported | Correct labels, verified status, edit/delete reachable |
| Public codes | Masked slots, old-code challenge, supported/unsupported paths |
| Sync partial failure/offline/unknown | Other users progress; verify unknown; receipt persists |
| HA none/view/manage | Server authorization honored, admin policy isolated |
| 360×800, 390×844, 768×1024, 1024×900, 1366×768, 1440×900, 1920×1080 | No root horizontal overflow; local table scroll only |
| 200% zoom, keyboard, RTL/LTR, dark mode | Readable reflow, focus order, labels, contrast |
| Slow request, socket reconnect, theme change during media | No double subscription, lost draft, audio leak or duplicate mutation |

Reference commands (verify package scripts first):
`npm --prefix frontend run check`
`npm --prefix frontend test`
`npm --prefix frontend run build`
Use existing Python/HA test setup and required release scripts. Do not infer physical acceptance from mocked browser tests.

## 12. Prototype reproduction and limits
From the repository root: `node docs/design/v4/render.mjs`.
The script uses the repository Playwright package and the installed Chrome executable. Adjust that executable path on other platforms.
49 screens are checked across light/dark desktop/tablet/mobile plus 360×800 and 1366×768. Selected mobile images include both first viewport and full page.
`qa/VALIDATION.json` records layout and local interaction checks only. It is NOT evidence for HA authorization, device execution, actual audio/TTS delivery or WhatsApp.
Buttons marked `data-demo` are intentionally no-op review affordances. Real implementation must bind each to the existing supported behavior.
Do not ship `gallery.html`, `manifest.js`, demo portraits or fake station addresses as production UI fixtures.

