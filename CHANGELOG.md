# Changelog

Semantic Versioning is used throughout the project.

## [Unreleased]

### Added
- Fleet clock comparison with measured request uncertainty, repeated drift qualification, sampled device DST forecasts, stale-data handling, and separate device/display zones. Read-only; HA is the time reference.
- Save up to twenty named camera-wall layouts per administrator/browser. Restore camera order and the stream budget with playback stopped; report removed cameras and reject stale or corrupted preference writes.
- Opt-in HA diagnostic sensors for observed managed people, unique pending people, sync state and last successful reconciliation. Missing inventory stays unknown; offline queues stay visible. Pending-work age remains unimplemented.

### Documentation
- Add forty further planned tasks (N41ג€“N80), preserving the prior N01ג€“N40 backlog. Record priorities, distinct deliverables, dependencies and specification mapping; no runtime changes or new physical acceptance.

## [0.33.0-beta.1] - 2026-09-11

### Beta scope
- Move the release from Alpha to Beta with sixteen software deliverables from the approved roadmap. This is a prerelease, not stable v1; physical acceptance remains 31/38. Speaker audibility, ringing, validity and fleet acceptance remain open. All seven release CI jobs passed before publication.

### Added
- Typed and required profile fields, per-user saved filters/sort/custom-column order, and onboarding templates containing profile/group defaults only.
- Bulk profile updates, group membership changes and personal-exception resets with before/after review. Metadata-only updates avoid station writes; group grants preserve independent memberships and personal denials.
- Group-policy impact review with affected users/doors, offline targets, revision binding and durable receipts. A permission directory shows policy access, group sources, exceptions and desired/applied revisions separately.
- CSV header mapping, typed profile cells, group IDs and personal exceptions. Exports preserve inheritance instead of flattening access. Independent cell errors include row/column codes and a downloadable report without credential values. Whole-batch validation and the 500-row/256-KiB limits remain.
- Activity filters by current group/profile membership, gated by observed station ownership at event time. Per-admin saved report queries and a sandboxed full-record print/PDF view preserve timestamps and completeness warnings; missing identities are never inferred from names.
- A bounded four/nine-camera wall using the configured media transport, with explicit start/stop and offscreen cleanup. Enlarging a camera suspends the wall. Physical nine-stream stability is not claimed.
- Bounded recovery when decoded video stops progressing after playback has begun, with visible HLS fallback or manual retry. No microphone or lock action is triggered.
- Microphone selection and a local input meter that does not transmit. Device loss, backgrounding and late permission results release tracks; local testing stops after one minute.
- Deliberate USB keyboard-reader input: Enter reviews an exact identifier; explicit confirmation adds it to the user draft. Oversized input is rejected rather than truncated. No global keyboard capture or automatic save.

### Reliability and upgrade
- Preserve and immediately queue committed group/bulk changes when a response is cancelled. Validate schema 5/6 exceptions before migration; reject corrupted state instead of reconstructing access.
- Access storage migrates to schema **6** and profile definitions to schema **2**. Existing text fields stay optional; old clients preserve new attributes and templates. Back up HA before upgrading; rollback to older code requires restoring the pre-upgrade backup.
- Source, browser and real-HA transport regression coverage added. The published commit passed 994 Python cases on each of 3.12/3.14, 312 HA cases and 352 browser cases, plus static checks, reproducible bundles, HACS and Hassfest. Verified publication evidence is recorded in docs/BETA_DEVELOPMENT.md and docs/evidence/release_0.33.0-beta.1.json.

### Capability evidence
- Read-only checks on two DS-KV6124-E1 stations found six successful PIN history records; the production normalizer preserved all six employee IDs and names. This is not confirmation of the earlier installed-HA unidentified-user report.
- Both channels 101/102 are advertised; primary RTSP DESCRIBE succeeds, secondary returns 401 in the bounded probe. No secondary-stream selection is enabled from capability advertising alone.
- History advertises picture support but the sampled records contained no linked picture. Mobile NFC/Hik-Connect feasibility is documented without enabling cloud or assuming support from another device family.

## [0.32.1-alpha.1] - 2026-09-10

### Fixed
- Separate the audio diagnostics disclosure from the download button. Show station microphone-byte and HTTP upload counters directly in the camera dialog, with sample time, explicit refresh and refresh-failure feedback; a file download is no longer required to read the server counters.
- Retain the peak microphone signal after releasing push-to-talk, alongside the instantaneous level that resets on release. Include the peak and backend sample time in the sanitized diagnostic export. Refresh while talking with diagnostics open and discard responses from previous sessions.

### Diagnostics and validation
- Capture only the numeric station PUT response status, without protocol headers or sound. HTTP 200 and bytes written do not establish physical speaker audibility.
- Recheck two physical stations: G.711ulaw matches the client, talk volume is 7/10, the channel changes from disabled when closed to enabled while open, and all six bounded silence sessions close with unchanged settings. Content-Length and optional-session-query comparisons provide no evidence for a codec or transport change. See docs/AUDIO_TALKBACK_DIAGNOSTICS_HE.md.
- Add upload acknowledgment/rejection and visible-counter, stale-response, refresh-failure, peak-retention and Hebrew mobile/desktop download coverage. The owner's speech-to-speaker failure remains under investigation pending installed-HA counters and a coordinated audible test. No storage migration or persistent station setting changes.

## [0.32.0-alpha.1] - 2026-09-10

### Added
- Display enabled custom fields as named columns in the users table and labelled values on mobile, alongside group memberships, in both designs.
- Assign station door permissions to groups in Management tools. Users inherit the union of active groups, with explicit personal grants and blocks; a personal block wins over all groups. Show permission sources and reset one or all personal exceptions in the user editor.
- Apply group permission changes atomically to the policy and every affected user's desired access. Retain durable offline revocation, restart recovery and existing ownership/readback checks. Renaming groups does not request device writes.

### Documentation
- Document automatic HACS update discovery in Home Assistant, the one-time prerelease switch and the custom-repository polling delay. Publication does not imply immediate notification or automatic installation. See docs/HACS_UPDATES_HE.md.

### Compatibility and validation
- Migrate access storage from schema 4 to 5 and import prior profile settings once into the central store. Preserve existing door assignments as personal exceptions, credentials, photos, pending revocations and audit history. Back up Home Assistant before upgrading; older integration versions cannot read schema 5.
- Reject stale user-policy edits and stale bulk/CSV reviews. Preserve personal exceptions on unchanged doors when using legacy assignment edits. Disabled groups retain membership but grant no access.
- Add group inheritance, exception precedence, atomic failure/cancellation, migration, offline restart/revocation, real HA authorization/storage and responsive Hebrew browser regression checks. See docs/GROUP_PERMISSIONS_032_HE.md.

## [0.31.0-alpha.1] - 2026-09-10

### Added
- Add global user profile options under Management tools: up to 12 named fields with suggestions, up to 64 organizational groups, and optional browser-camera portraits. Rename or hide definitions while preserving stable IDs and existing user values. Filter users by fields and groups and assign multiple groups in the editor. Groups do not grant door permissions.
- Add explicit camera capture, preview, discard/retake, accept and photo removal. Save accepted images atomically with user changes; keep previews local until saving. Stop camera tracks on capture, cancellation, backgrounding, HA disconnection or component removal. Load saved portraits only for visible administrator views; never include JPEG data in overview broadcasts, CSV exports, audit history or deletion tombstones.
- Add installed go2rtc add-on discovery and a saved-provider check showing the selected server and version. Share an explicit trusted go2rtc address between MSE and RTC, with same-origin authenticated RTC signaling and source credentials retained in HA. Preserve native HA RTC when no explicit provider is chosen.

### Fixed
- Move card enrollment, history and deletion into the user editor; user enable/disable uses the editor's Active control. Keep only Edit and Sync now beside each other in user rows, in both designs and mobile layouts. Guard other editor actions while unsaved changes exist.
- Local profile-only edits preserve access assignment sync state and advance equivalent applied revisions together and do not request a new device synchronization. Central schema 4 migration preserves credentials, assignments, revocations and pending operations.
- Expose RTC connection and ICE state in safe playback diagnostics to distinguish signaling success from a decoded video stream.

### Validation and migration
- Real browser decoding confirmed 2688ֳ—2016 MSE video from two stations through the installed go2rtc server. RTC over UDP connected but lost packets without decoding frames; TCP decoded 2688ֳ—1520 H.264 from both stations with zero packet loss in the measured interval. Prefer TCP for the selected add-on and retry ordinary RTC once when TCP is unavailable. See docs/PROFILES_MEDIA_031_HE.md for evidence and setup.
- Add persistence, migration, revision-conflict, admin authorization, bounded JPEG, photo privacy/deletion, selected-provider signaling, lifecycle, filtering, capture and Hebrew responsive regression checks. No device credentials, photos, raw signaling or live video recordings are published.
- User storage payload migrates from schema 3 to 4 atomically. Keep a Home Assistant backup before upgrading; an older integration cannot read schema 4. Photos are JPEG up to 32 KiB and 512ֳ—512; the capture UI produces 256ֳ—256 images. Aggregate photo data is capped below the existing 32 MiB storage limit.

## [0.30.0-alpha.1] - 2026-09-10

### Added
- Add global camera playback options under WisKey Management tools: HLS or WebRTC/go2rtc, RTC or MSE, and an explicit HLS fallback preference. Persist settings once for all WisKey players and administrators, with atomic storage, revision conflict protection and live refresh across browsers.
- Implement real MSE fragmented-MP4 playback through an authenticated Home Assistant WebSocket bridge. Use the HA go2rtc integration or an explicitly configured trusted local go2rtc server; keep camera source credentials off the browser. Bound messages, buffering, startup and idle waits, and close streams on visibility, ownership, station, setting or connection changes.
- Add microphone permission/device/processor errors, live microphone signal and accepted-packet counters, and a privacy-preserving audio diagnostic export. Distinguish accepted microphone packets, microphone bytes written toward the station, and total transport bytes including generated silence. Talk continues over browser ג†’ HA ג†’ ISAPI independently of RTC video.

### Validation
- Verify live MSE negotiation and binary H.264 data from two stations through the existing go2rtc server. Open concurrent ISAPI audio sessions, receive data, transmit silence, close both sessions and confirm unchanged channel configuration and idle call state. Speaker audibility and the owner's browser microphone path remain unverified.
- Record the owner's successful card create/write, assignment, update and deletion tests. Multiple simultaneous cards for one person and reader-enrollment cancellation were not explicitly confirmed and remain separate acceptance items.
- Add settings persistence/conflict/authorization tests, authenticated MSE bridge tests, real browser fMP4 decoding, global mode changes, strict fallback, responsive Hebrew layouts and microphone diagnostic tests. See docs/MEDIA_030_HE.md for setup, limits and evidence.

## [0.29.0-alpha.1] - 2026-09-10

### Added
- Rename the product to WisKey in the panel, Home Assistant sidebar and integration setup. Retain the integration domain, entity IDs, data, URLs, repository and saved appearance preferences for existing installations.
- Add a Management tools page for users, stations, synchronization, administrator history, health diagnostics, schedules, integration settings and appearance selection. Advanced pages return to the hub; all existing administrator restrictions remain enforced by Home Assistant and the WebSocket API.
- Show a live date and time on Overview, ticking every second in the Home Assistant time zone with automatic daylight-saving transitions. Use the current browser clock; refresh immediately after returning to a hidden tab and clean up the timer when leaving the page.

### Improved
- Move the Appearance picker exclusively to Management tools. Remove its header/sidebar and camera/editor dialog entry points. Keep the existing/new design choice and responsive compact counters.
- Clock updates do not reload cameras or issue network/device commands. Station event timestamps retain their own existing time-zone rules.

### Validation
- Exercise management navigation, revoked administrator access, clock midnight/DST/zone changes, timer lifecycle, camera preservation and responsive Hebrew layouts in both designs.
- Update existing browser journeys for the new management hub; document the delivery in docs/WISKEY_029_HE.md. No physical device operations were performed.

## [0.28.1-alpha.1] - 2026-09-10

### Improved
- Replace the new design's large Overview metric cards with compact status chips beside the Doors & cameras heading. The camera grid starts higher on the page.
- Wrap chips with the available panel width; use two compact rows on mobile. Keep full accessible descriptions, explicit number direction, live counts and large-number wrapping.
- Preserve the existing design's metric row and the shared station, camera and door behavior.

### Validation
- Add eight browser tests for desktop/tablet/mobile layout, Hebrew/English, dark mode, live counts, large values, narrow embedded panels and switching back to the existing design.
- Document the approved proposal, actual screenshots and measured layout changes in docs/COMPACT_HEADER_0281_HE.md. No physical device operations were performed.

## [0.28.0-alpha.1] - 2026-09-10

### Added
- Add an optional blue interface with a charcoal navigation rail, compact station cards, user avatars and action disclosures, a two-column editor, and focused station details. The existing design remains the default.
- Add an Existing/New appearance picker in the header, desktop navigation and open editor/camera dialogs. Save the preference per Home Assistant user in this browser; blocked storage falls back to the current session with an explanation.
- Follow Home Assistant's effective light/dark theme across both designs and all management views. Switching appearance preserves mounted camera controls, unsaved form fields, selected users and pending station actions without sending or replaying a device command.

### Improved
- Adapt layout to the actual Home Assistant panel width using container queries. Support desktop, tablet, mobile and live resizing, including a narrow panel inside a wide browser and mobile landscape dialogs.
- Keep all eight views reachable through daily navigation and a mobile More menu. Use user cards when the content area is narrow; keep editor save actions visible while fields scroll.
- Make station activity, clock and capability sections expandable in the new design; retain independent online/sync states, a red ringing indicator and one active lock per station.

### Documentation and validation
- Record owner design approval, implementation decisions, synthetic browser screenshots and C-ALT delivery stages in docs/design/ALTERNATE_UI_HE.md and docs/ALTERNATE_UI_028_HE.md.
- No physical device operations were performed. Hardware acceptance, ISAPI contracts and access-storage schema are unchanged.

## [0.27.7-alpha.1] - 2026-09-10

### Fixed
- Preserve absolute validity and event/history filter instants when station or HA time-zone rules change in the background or the selected station disappears. Retain known DST-fold instants and seconds; visibly clear ambiguous drafts with an explanation.
- Clear discarded replacement PIN values from the actual editor fields when removing a PIN or choosing to retain the saved PIN.
- Recover uncertain bulk changes after missing replies, navigation or HA disconnection using the saved operation ID. Bound waits, keep recovery scoped to the authenticated connection, reject late results and require a receipt check before another reviewed action; never automatically replay a change.
- Bound schedule draft, proposal and operation requests, release controls after missing responses, and reload fresh data after authenticated connection replacement. Unconfirmed saves require a stored-state read before another change.
- Reject oversized storage writes before replacing the last reloadable file. Apply the same 32 MiB UTF-8 byte limit to writes and reads, including the storage envelope, and retain the existing repair notification until a successful save.

### Validation boundaries
- No physical device operations were performed. No additional ISAPI behavior or schedule permission writing was enabled. Calls, audible audio, card lifecycle, timed validity, installed WebRTC and nine-station acceptance retain their documented gates.
- See docs/SOFTWARE_CLOSURE_0277_HE.md for completed software work, regression evidence and the remaining dependencies.

## [0.27.6-alpha.1] - 2026-09-10

### Fixed
- Bound change-history reads, exports and permission comparisons to 20, 60 and 120 seconds respectively. Missing replies release the controls with an error; late replies cannot overwrite that result or download a stale export.
- Discard previous audit results and pending requests when the Home Assistant connection or administrator changes. Reattaching the history view loads a fresh list, and changing the selected person replaces an obsolete pending read.

### Validation boundaries
- No physical device operations were performed. Hardware acceptance and the current completion percentages remain unchanged.

## [0.27.5-alpha.1] - 2026-09-10

### Fixed
- Retire station event producers as soon as the runtime starts closing. Late call-status edges and live/history replies cannot emit events from an unloaded or replaced station.
- Preserve the history recovery cursor when shutdown interrupts a page, so the next recovery replays and deduplicates that page without skipping records.
- Keep a replacement event monitor registered when the old monitor finishes cleanup, and ignore late connection-recovery callbacks instead of queuing new synchronization during shutdown.

### Validation boundaries
- No physical device operations were performed. These lifecycle fixes do not close field acceptance for calls, audible audio, cards, timed validity or nine-station operation.

## [0.27.4-alpha.1] - 2026-09-10

### Fixed
- Keep the first mobile activity record visible by collapsing event filters initially; desktop filters remain open. The disclosure counts applied criteria and preserves unapplied drafts through refreshes.
- Share guarded call controls between health, Overview and camera views. Pending commands remain owned by their station across navigation, missing replies become uncertain, and call state is read only when the health controls are opened.
- Recover event investigation after missing replies, HA disconnects or connection replacement. Bound trace waits to 20 seconds and history inspection to 60 seconds; require a status read after an uncertain capture change without replaying it.
- Preserve the selected history instants when the station display timezone changes. Clear ambiguous draft wall times with an explanation instead of silently reinterpreting them.

### Validation boundaries
- No physical device operations were performed. These interface and diagnostic fixes do not establish audible audio, answered calls, card lifecycle, timed validity or nine-station hardware acceptance.

## [0.27.3-alpha.1] - 2026-09-10

### Fixed
- Reject a live health inspection if the station begins unloading or its runtime is replaced while media capabilities are being read. Do not return a mixed diagnostic snapshot.
- Bound field-checklist reads and saves; a missing save response requires reading the stored result before another change. Keep its uncertainty message through unrelated health refreshes and reconnect without replaying a save.
- Isolate health reads with one three-slot queue: station updates cannot overlap batches, completed peers immediately free capacity, and missing cached/live responses expire after 20/45 seconds. Discard old-connection results, stop queued reads on disconnect, and reconnect using cached diagnostics only.

### Validation boundaries
- No physical device operations were performed. Diagnostic recovery and recorded operator results do not establish field acceptance. The open physical gates remain unchanged.

## [0.27.2-alpha.1] - 2026-09-10

### Fixed
- Bound event-list and report waits, preserve cached records with a visible refresh failure, and keep report failures separate from list refreshes. Abort old views and exports on HA disconnect or replacement; reconnect refreshes events without replaying an export.
- Coalesce station updates while an event list is loading, supersede old reads immediately when applied filters change, and restore event loading after the same view is reattached.

### Validation boundaries
- No physical device operations were performed. Calls, audible audio, card lifecycle, timed-validity boundaries, the original unidentified PIN event and hardware fleet acceptance remain open. See the second delivery in docs/OVERNIGHT_2026_09_10_HE.md.

## [0.27.1-alpha.1] - 2026-09-10

### Fixed
- Restore keyboard focus to the opening control when an editor or camera dialog closes, including Escape and successful saves.
- Close an event HTTP client even when Home Assistant unloads the station while its executor is still constructing that client.
- Recover user-management controls after a lost response, logout or panel reattachment. Discard late private inventory/review results, bound browser waits, clear sensitive drafts when a write result is uncertain, and preserve the separate uncertain-card-approval flow without automatic replay.
- Reject new door, call and audio work as soon as a station starts unloading. Late release acknowledgements cannot recreate an optimistic pulse on the old runtime; uncertain commands are never replayed.
- Keep audio starts bound to the selected station across delayed browser permission/playback setup. Disable opening while HA is offline, restore connection listeners after reattachment, and never restart listening or the microphone on reconnect.
- Restrict central-name enrichment to events after ownership was observed on that particular station. Preserve the boundary across restarts, establish it conservatively for older storage on the next verified read, and invalidate it on an ownership discrepancy. Source-provided names remain authoritative.
- Recover the overview after missing responses or reattachment, show when displayed data may be stale, and stop waiting indefinitely for release acknowledgements. Pause door commands during HA disconnection and preserve an uncertain result without replaying or accepting a late acknowledgement.
- Bound call-state reads and signaling waits in the panel, discard responses from a previous station, and release stuck station controls after an uncertain response without replaying the command. Pause call actions on HA disconnect and obtain fresh state in other views after a command completes.

### Validation boundaries
- No physical station operations were performed for this patch. Calls, audible audio, the owner's original unidentified PIN event, timed-validity boundaries, card lifecycle, WebRTC NAT and nine-station hardware acceptance remain open. See docs/OVERNIGHT_2026_09_10_HE.md.

## [0.27.0-alpha.1] - 2026-09-09

- Arrange camera video and call/audio controls side by side on desktop, retain a visible dialog header and door footer on small screens, and improve the video error/retry view.
- Stop microphone capture on keyboard focus loss or browser audio interruption. Bound browser audio requests to five seconds, discard expired receive packets, limit slow uploads and incomplete receive frames, and drop pending upload buffers on close.
- Reconnect visible video with fresh WebRTC signaling after Home Assistant reconnects; never replay an old offer or automatically reopen microphone audio. Remove connection listeners when the camera closes.
- Restore interrupted ownership and pending-deletion statuses to pending after restart. Verify a synthetic private database generated by v0.23 through the current repository, actual HA Store/setup/reload and deferred credential removal, preserving receipts, audit and unmanaged residents.
- Add a loopback-only sustained audio/access test: nine simulated stations, rotating three simultaneous audio sessions, polling, PIN updates and injected failures. A 608.69-second run closed all 165 sessions and recovered 27 injected audio failures; this is not physical fleet acceptance.
- Honor the documented local-time default when a readback omits timeType. Keep contradictory local labels with explicit offsets blocked for timed validity. Read-only checks found different configured device zones and no currently time-limited users; settings were not changed.
- Recheck silence-only audio transport and confirmed closure on two physical stations with unchanged configuration. Audible two-way acceptance, timed-validity boundaries, calls, cards, WebRTC NAT and nine-device hardware acceptance remain pending. See docs/RECOVERY_027_HE.md.

## [0.26.0-alpha.1] - 2026-09-09

- Add a two-way audio preview to the camera window: explicit listening, hold-to-talk, microphone permissions and immediate local mute on release.
- Implement a connection-owned Home Assistant audio bridge and documented G.711ulaw ISAPI session transport, with fresh Digest authentication, bounded queues, fixed-rate raw upload and a three-minute lifetime.
- Close audio on browser disconnect, backgrounding, station unload, permission loss and call termination. Sessions remain independent between stations, and credentials and audio packets are excluded from diagnostics and WebSocket debug logs.
- Verify opening, receiving audio, silence-only upload and session closure against DS-KV6124-E1 firmware 3.9.0 without changing channel configuration. Audible two-way acceptance remains pending; microphone access requires HTTPS. This preview does not claim to resolve the owner's WebRTC NAT issue.
- Keep physical call, card and nine-station acceptance open. See docs/AUDIO_026_HE.md for implementation evidence and remaining 95% gates.

## [0.25.0-alpha.1] - 2026-09-09

### Added
- Local sync filters by person, station and items needing attention, retaining pending removals
  below the filtered matrix. Mobile sync displays station-labelled rows within person cards;
  desktop retains a scrollable matrix with sticky headers and names.
- Events distinguish edited filters from applied results, reset search/filters in one action,
  show loaded-record counts and provide explicit refresh. Reset invalidates pending reports.
- Shared administrator view styles and compact change-history cards with person/action/time,
  keyboard-accessible before/after details and loaded-versus-total counts.

### Changed
- User-list hierarchy gives Add user a primary position and groups search/management tools.
  Row actions wrap; mobile cards, filters and light/dark Hebrew/English layouts use the new style.
- Permanent user summaries omit an irrelevant timezone prefix. Limited validity still shows
  its display zone and boundaries. Event/history timestamps keep their direction in RTL text.
- Event retention/export explanations remain available in an expandable help section.

### Fixed
- Empty filtered user results no longer claim the central database is empty. Clearing filters
  restores the list, preserves sorting and clears bulk selection.
- Scope edge-to-edge card spacing to Overview; station management cards retain their padding.

### Evidence and limits
- Existing imports, credential actions, bulk review, uncertain-result recovery and applied-filter
  exports retain their behavior. No access schema, ISAPI route or device settings changed.
- This advances C3/C5/C6 of the completion/UI plan. Owner usability feedback and physical call,
  audio, timed-validity, card and nine-station acceptance remain open. MSE/NAT status is unchanged.
- Mandatory acceptance remains 31/38 (81.6%); combined scope remains 77.7%.
  See docs/ADMIN_UI_025_HE.md for delivery evidence and screenshots.

## [0.24.0-alpha.1] - 2026-09-09

### Changed
- Redesigned daily navigation, station cards and the user editor. Desktop uses a sidebar;
  mobile separates daily actions from management. Camera previews and independent door
  controls take precedence over history and support information.
- User editing groups personal details, validity, PIN, cards and station assignments, with
  a fixed save/cancel footer and responsive layout. Native SVG icons and HA theme colors
  support Hebrew RTL, English LTR and light/dark themes without external assets.
- Compact call controls show actions relevant to the observed state and explicitly indicate
  that two-way audio is unavailable. Full camera controls retain the existing command workflow.

### Fixed
- Preserve string employee identifiers, including leading zeros, when an event supplies
  employeeNo instead of employeeNoString. Explicit string identifiers still take precedence.
- Resolve a missing event name only through an observed ownership binding for that station,
  an exact identifier match and an event not predating the central user. Unbound users,
  unverified creation intents and another station's ownership cannot supply the name.
  Names explicitly reported by the device remain authoritative.

### Build
- Exclude the ephemeral CI runner's unused Chrome APT source before installing Playwright
  dependencies, avoiding its observed repository hash mismatch. Chromium still comes from
  Playwright and the full browser suite remains required for release.

### Evidence and limits
- Two authorized stations returned 123 history records through 78 read-only requests,
  including three successful PIN events with names and employee identifiers. No station writes
  or physical commands were sent. The owner's original unidentified event is not conclusively
  correlated, so that investigation remains open.
- The owner reports working MSE playback and a provider NAT issue awaiting repair. HA HTTP
  reachability was verified; authenticated installed-panel and WebRTC acceptance remain open.
- Audio channel discovery still reports disabled G.711ulaw; no audio session is enabled.
  Timed-validity readback remains unresolved. Calls, cards and the nine-station physical soak
  retain their existing acceptance gates. Screenshots use synthetic data.
- Mandatory v1 acceptance remains 31/38 (81.6%); combined scope remains 77.7%.
  See docs/CORE_UI_024_HE.md for progress against the 95% plan and interface previews.
- Upgrading from 0.23 keeps access payload schema 3 and HA Store envelope version 1.
  Back up HA before upgrading; returning to 0.22 or earlier requires a compatible backup.

## [0.23.0-alpha.1] - 2026-09-09

### Added
- Reviewed bulk access operations for up to 200 explicitly selected users: enable, disable,
  station assignment/removal, deletion, PIN removal, card removal and synchronization requests.
  Previews show per-user changes and cached capacity estimates before a separate approval.
- Atomic operation receipts survive restart and uncertain replies. Actor-bound replay never
  reapplies old changes; it only requeues reconciliation of current desired state.
- Administrator change history records actor, action, revision and masked before/after summaries
  together with user, card, import and conflict changes. It retains up to 5,000 rows / 30 days,
  with stable pagination, filters, per-user navigation and formula-safe CSV/JSON exports.
- Read-only permission comparison reports matched, drifted, unmanaged and unverified users,
  with explicit completeness and a link to the existing conflict-review workflow.
- User filters by station, assignment, activation, validity and credential presence; stable sorting,
  result counts and responsive explicit selection in Hebrew and English.

### Upgrades
- Private access payload schema migrates from 2 to 3, preserving users, credentials, ownership
  and pending removals. Back up HA before updating; downgrading to 0.22 or earlier requires
  restoring its compatible backup. The HA Store envelope remains version 1.
- Audit exports contain administrator/user identifiers and names, but no PIN values or complete
  card numbers. An unchanged operation has a receipt without inventing a change-history row.

### Evidence and limits
- Permission inspection completed against two authorized DS-KV6124-E1 stations using 32
  read-only requests and an empty isolated local baseline; this does not compare the owner's HA
  database. No station credential, relay, call or schedule changes were made in this batch.
- Capacity is an estimate from the latest available inventory, not a reservation. Saved operations
  are central commits; station completion still follows the existing queue and readback status.
- Mandatory v1 acceptance remains 31/38 (81.6%). The overall scope estimate remains about 78%.
  All 20 software deliverables and remaining hardware gates are listed in docs/BULK_ACCESS_AUDIT_HE.md.

## [0.22.0-alpha.1] - 2026-09-09

### Added
- Call controls in camera and active-station views, fresh capability/state checks, per-station
  command ownership and bounded post-command observation. Lost replies remain uncertain and
  are never retried automatically; observed state changes do not prove answered audio.
- Explicit 90-second event/call capture, source identity field-presence evidence, and sanitized
  support exports. Captures are bounded, administrator-only and expire without extra station reads.
- Read-only history inspection for explicit windows up to 24 hours, with completeness, time-filter
  verification and anonymous event summaries. It does not advance recovery cursors or fire live events.
- Playback reports with first-frame state, fallback reasons and allowlisted RTC video statistics;
  bounded capability/HLS startup, track/disconnection handling and background/network cleanup.
- Nine-station HA runtime integration tests for event isolation, independent call commands and
  unloading a pending station. A real HA camera-provider registration test covers WebRTC advertising.

### Fixed
- Recover offset-free AcsEvent history times using verified device clock rules on DS-KV6124-E1,
  V3.9.0 build 260115. The prior path rejected those rows. Equivalent UTC/+03:00 search windows
  were checked against the station; ambiguous DST times and changed clock rules are rejected.
- A video track with no decoded video dimensions cannot mark WebRTC playback as ready.

### Evidence and limits
- All 15 inspected real history records now fall within the requested window. The reporting/CSV
  pipeline preserves their 3 authentication outcomes and 12 other records without double-counting.
- Original unidentified-PIN correlation, live call acceptance, owner-system WebRTC, two-way audio,
  card lifecycle and the nine-station physical soak remain open. No station settings were changed.
- Mandatory v1 acceptance remains 31/38 (81.6%). The overall scope estimate remains about 78%.
  See docs/CALLS_AND_HISTORY_BATCH_HE.md for exact progress across the selected 20 tasks.

## [0.21.0-alpha.1] - 2026-09-09

### Added
- Health and field tests panel with per-station sync reasons, event stream/history counters,
  clock offset warnings, bounded independent refreshes and sanitized compatibility exports.
- Event evidence explains identity availability, live/history origin, receipt time and delayed
  records. Single-event support exports omit names, user IDs, cards and station addresses.
- WebRTC through Home Assistant camera signaling and its configured provider, with HLS fallback,
  transport/failure state, retry, bounded setup and peer/track/subscription cleanup.
- Private atomic field-acceptance records, explicit operator results, revision conflict checks,
  per-station checklists and export. No physical result is marked passed automatically.
- Read-only fleet soak CLI records bounded timings, failures and recovery across up to nine stations.
- Advertised call answer/reject/hangUp controls with identity/capability/current-state checks,
  single-attempt writes and explicit acknowledgement; two-way microphone audio remains unavailable.

### Fixed
- Station readiness now uses the verified Search routes and reports complete/partial coverage,
  replacing rejected by-ID GET samples. Holiday inventory remains partial; schedule writes stay disabled.
- Same-time access records prefer a complete identified record without merging identities between events.
  The owner's original unidentified-PIN report still requires correlation to an exact event.
- Restored field-test selections display the saved result correctly when their options first render.

### Evidence and limits
- Two authorized stations each passed 18/18 read-only status checks during a 90-second observation.
  A manual UTC clock on one station was about eight hours ahead; it was not changed.
- Call/audio acceptance, actual WebRTC playback, card lifecycle and the nine-station hardware soak
  remain open. No live call command, audio session, credential mutation or door release was performed.
- Mandatory v1 acceptance remains 31/38 (81.6%). See docs/CORE_MEDIA_BATCH_HE.md for all 20 tasks.

## [0.20.0-alpha.1] - 2026-09-09

### Added
- Administrator schedule operations panel connects saved proposals to durable check jobs:
  explicit resource responsibility review, background station checks, blockers, recovery steps,
  cancellation, archive and safe report export, in Hebrew and English with mobile support.
- Local resource responsibility registry detects overlapping declarations and changed device
  contents. Declarations never establish that disabled records are unused or bypass dependencies.
- Per-station preflight queue limits concurrent fleet checks to three. Interrupted checks survive
  restart and require explicit recheck. Stable job identifiers recover a journal committed before
  a failed job save, without creating duplicates or replaying device requests.
- Private Home Assistant stores, isolated Repairs, atomic journal schema migration and bounded
  archives. Uncertain or partially applied journals cannot be cancelled or expired by retention.

### Validation and limits
- The owner confirmed user creation, synchronization to two intercoms and PIN replacement:
  the new PIN worked and the old PIN was rejected. Removal without replacement remains untested.
- No production schedule write adapter or Apply control is enabled. Jobs use verified read routes;
  unknown defaults, dependencies, incomplete inventory and unverified writes remain blockers.
- This batch made no device requests. Automatic tests exercise storage, faults and the HA/browser
  workflows; they do not establish physical schedule enforcement. Update through HACS and restart HA.
- See [the operations guide and task ledger](docs/SCHEDULE_OPERATIONS.md) for completed scope and
  the next tasks. Mandatory acceptance remains 28/38; Phase 6 schedule features remain partial.

## [0.19.0-alpha.1] - 2026-09-09

### Added
- Durable schedule write journal validates immutable candidates, private before/after fingerprints,
  ordered state transitions, source/device/ownership context and per-station exclusivity. Intent is
  committed before a request; ambiguous or partially applied transactions cannot be discarded.
- Guarded schedule recovery executor checks context and all controlled resources before each step,
  saves intent, checks again, writes once and verifies readback. Lost acknowledgements and restarts
  trigger read-only recovery; unchanged original contents remain uncertain instead of being retried.
  External changes stop progress; partial writes are retained without automatic rollback.
- Repeatable offline commissioning simulator covers nine deterministic fault scenarios using committed
  JSON restart snapshots. Reports explicitly distinguish synthetic evidence from physical acceptance.
- Regression coverage includes cancellation, failed saves, no-change acknowledgements, changing
  transport gates, shared execution locks, nine concurrent synthetic stations and bounded retention.

### Scope and limits
- This is backend infrastructure for future schedule application. No production write adapter, HA
  write service, background worker, private journal store or Apply button is registered.
- Existing proposals do not establish resource ownership or verified write support. Production
  ownership/adoption, complete relevant inventory, HA integration, operator recovery and RightPlan
  assignment remain open. Physical weekly/holiday/DST enforcement has not been verified.
- No device requests were made for this batch. Mandatory acceptance remains 28/38 (73.7%); weekly
  schedules and holidays remain partial Phase 6 features. Update through HACS and restart HA.

## [0.18.0-alpha.1] - 2026-09-09

### Added
- Capability-checked schedule compiler translates local drafts and explicit resource IDs into
  candidate weekly, holiday, holiday-group and template bodies. It validates ranges, names,
  weekdays, period limits and time precision, and preserves local wall-clock times.
- Selected-resource comparison reports changed fields and external references using verified
  read-only Search routes. Unknown configuration fields, partial coverage, implicit user defaults
  and missing observations remain explicit; disabled resources are not assumed available.
- Saved deployment proposals retain draft snapshots, source revisions and installation-private
  comparison fingerprints. Explicit rechecks detect configuration or capability changes without
  replacing the original observations. Per-station local reservations prevent overlapping proposals.
- Administrator panel for preview, local save, recheck, export and removal, in Hebrew and English.
  Actor-bound single-use previews expire in five minutes; stale drafts/devices reject saves.
  Independent atomic storage and Repair handling preserve core access when proposal storage fails.

### Evidence and limits
- Production-client reads, local save/reload and recheck succeeded on the commissioned station.
  A selected weekly resource has an external template reference; three users have unknown defaults.
  No station writes occurred. Reports omit raw station configuration, credentials and private hashes.
- These are local proposals, not device ownership or deployment. Applying schedules, assigning users,
  write recovery and physical weekly/holiday/DST enforcement are still unavailable or unverified.
- Mandatory acceptance remains 28/38 (73.7%). Weekly schedules and holidays remain partial Phase 6
  extensions; these three software tasks do not close the outstanding physical acceptance gates.

## [0.17.0-alpha.1] - 2026-09-09

### Added
- User schedule dependency audit traces explicit RightPlan references through observed templates,
  weekly plans and holiday resources. Unknown defaults, malformed assignments, failed user reads
  and partial inventory coverage stay explicit. Reports exclude user identities and credentials.
- Multi-station assessment queue checks one immutable draft across stations, with two concurrent
  reads, independent results, skipped unavailable stations and cancellation of remaining checks.
  Editing or navigation discards stale work. Combined downloads omit baseline approval tokens.
- Portable draft import/export with a versioned JSON format and a reviewed, atomic append of new
  copies. Single-use administrator-bound previews expire after five minutes or a library change;
  invalid batch members reject the entire file. Unknown save responses require inspection.
- Clone the current draft, including unsaved edits and holidays, and copy windows between weekdays.
  Replacing non-empty target days requires confirmation. Copies stay local until explicitly saved.

### Evidence and limits
- A live read returned three users with no explicit RightPlan references; all three remain classified
  as unknown defaults. Schedule holiday inventory remains partial. Zero station writes were sent.
- Dependency observations are non-atomic and do not establish ownership, safe allocation or effective
  enforcement. Applying schedules and assigning them to users are still unavailable.
- Mandatory acceptance remains 28/38 (73.7%). These four workflow improvements advance the two partial
  Phase 6 schedule features; they do not close physical commissioning gates.

## [0.16.0-alpha.1] - 2026-09-09

### Added
- Persistent schedule references: explicitly save a station's observed configuration fingerprints,
  compare later assessments, replace the reference or clear it. References survive Home Assistant
  restarts in an independent private store; failed persistence preserves the previous reference.
- Detect changed record contents and advertised capabilities even when counts match. Show bounded
  resource-ID lists for observed changes, and distinguish unseen records from proven presence changes
  in completed searches. Partial searches never establish deletion or previously absent records.
- Administrator-only, station/actor/identity-bound observation tokens expire after five minutes and
  become invalid after another assessment, save or clear. Identity/firmware changes require a new
  reference; uncertain save responses require inspection without an automatic retry.
- Per-installation keyed fingerprints exclude raw configuration contents from storage and reports.
  Downloaded reports omit observation tokens. Independent Repairs report reference-storage failures
  without disabling inventory assessment, schedule drafts or existing access management.

### Scope and limits
- References record observations, not resource ownership or editable configuration backups. Searches
  remain non-atomic and holiday coverage remains partial on the commissioned firmware. Applying
  schedules, allocating device resources and assigning users are still unavailable.
- Comparisons run on requested assessments, not as background monitoring. No station schedule,
  credential, clock or relay writes are introduced. Mandatory acceptance remains 28/38 (73.7%);
  weekly schedules and holidays remain partially implemented Phase 6 extensions.

## [0.15.0-alpha.1] - 2026-09-09

### Added
- Draft compatibility assessment in Access schedules: select a station, check the current
  draft against its advertised period counts, time precision, weekdays and resource ranges,
  and download the result. Unknown constraints remain explicit. Edits, station changes,
  reloads and navigation invalidate old or late assessment results.
- Read-only schedule inventory through firmware-observed Search endpoints. Searches read
  validated pages for templates, weeks, holiday groups and holidays using advertised bounds.
  Reports distinguish completed, partial, unsupported and failed queries and show validated
  counts and references without station configuration names or raw records.
- A separate I/O lane preserves ordinary call/release access while checking schedules.
  Identity checks, a 60-second read deadline, bounded pagination, shared per-station/fleet
  admission and administrator-only access govern every check. No automatic write or retry.

### Fixed
- Diagnostics can now read schedule records even when direct per-ID GET requests return
  device status 3. A failed GET remains a failure; it is not reinterpreted as an empty slot.
- Activity-report documentation now describes the station-local grouping introduced in 0.14.

### Evidence and limits
- Live production-client reads returned 255 templates, 255 weekly plans and 64 holiday groups,
  including one enabled holiday group. 300 of 1024 holiday plans were read before reaching the
  advertised search-position bound; the result is explicitly partial. These are records read,
  not available allocation slots. The Search query enable=false can return enabled records.
- Ownership and user references are not scanned. Disabled records and identifier ranges are
  never treated as free capacity. Holiday group member limits are not inferred from ID ranges.
- Applying schedules, allocating device resources and assigning them to users remain unavailable.
  No schedule configuration, access credential, clock or relay writes occurred in this work.
- This improves the two partial Phase 6 schedule features; mandatory acceptance remains 28/38
  (73.7%). Physical PIN/validity/card/ring/video/fleet commissioning remains open.

## [0.14.0-alpha.1] - 2026-09-09

### Fixed
- Station timestamps now follow the station's configured time zone and daylight-saving rules
  by default, independently of the browser's zone. UTC and offset-aware source timestamps
  are converted once; stored events and synchronization instants remain UTC.
- Validity editing and event date filters use an explicitly labelled zone. Nonexistent and
  ambiguous newly entered DST times are rejected. Unchanged validity retains its exact instant
  and seconds; changing the display zone preserves the instant.
- Daily activity summaries use each record's station-local calendar day. Event CSV retains
  its original timestamp and adds display_timestamp and display_timezone columns.

### Added
- Per-station Home Assistant Options: follow the device (default) or select a manual IANA
  display zone such as Asia/Jerusalem. The integration reads /ISAPI/System/time on load and
  every 15 minutes; the Intercoms screen shows the clock source, sample, offset, read time,
  approximate skew and an independent Read station clock action.
- Verified cached rules survive a later read failure with a stale warning. Before any valid
  device read, display falls back explicitly to UTC; a manual zone works without that read.
- English/Hebrew documentation: [time zones, DST and input behavior](docs/TIME_ZONES.md).

### Validation and limits
- Live identity-checked GET using the production clock client confirmed UTC+03:00, NTP mode,
  base UTC+02:00 plus a one-hour seasonal increment and the configured April/October rules.
  Measured rounded skew was zero seconds. No device clock, NTP, credential or relay write occurred.
- Automated coverage includes DST transitions, offsets already present in API responses,
  manual IANA override, a browser in a different zone, report day boundaries, actual HA options,
  authorization, refresh/unload lifecycle and Hebrew mobile display.
- Current device rules describe the present configuration, not its historical changes. Other
  formats fail explicitly. Physical DST-transition acceptance and timed-credential enforcement
  remain deferred; validity_timezone_mismatch protection is unchanged.

## [0.13.0-alpha.1] - 2026-09-08

### Added
- Central schedule planning: named weekly drafts, up to eight windows per day, holiday date
  exceptions and a local-date/time preview with explicit holiday precedence. Empty holiday
  windows close the draft day; overlapping periods/dates and ambiguous overnight windows
  are rejected. End-of-day 24:00 is supported. Drafts are not applied to stations or users.
- Independent, private, atomic Home Assistant schedule storage with revision checks, bounded
  library size, cancellation-safe persistence, corruption preservation and Repairs. Existing
  user storage and synchronization remain independent of draft availability.
- English/Hebrew mobile schedule editor with add/edit/delete, unsaved-change checks, stale
  revision handling and explicit reload after an uncertain save. Preview never claims actual
  credential acceptance, timezone conversion or door access.
- Read-only station readiness checks for permission templates, weekly plans, holiday groups
  and holiday plans. Fresh identity and advertised bounds govern the sampled ID. Results
  contain sanitized counts/errors and can be exported; device configuration names and raw
  payloads are omitted. At most one check per station and three in the fleet, with deadlines.

### Validation and limitations
- Live GET-only checks against DS-KV6124-E1 V3.9.0 build260115 confirmed advertised ranges
  1ג€“255 for templates/weeks, 1ג€“64 for groups and 1ג€“1024 for holidays. Every sample-1 GET
  returned device status 3. A failed GET is never treated as an empty or available slot.
- Schedule allocation, device writes, RightPlan assignment and physical enforcement remain
  unavailable pending protocol/ownership/readback validation. Even successful readiness
  reads do not enable assignment. No schedule, credential or relay write occurred in this work.
- Automated tests cover calendar/window boundaries, holiday overrides, concurrency, failed
  and interrupted saves, actual HA authorization/storage/privacy and browser workflows.
- Mandatory acceptance remains 28 of 38 applicable items (73.7%), ten open (26.3%).
  Weekly/holiday Phase 6 work has progressed to planning, not completed device enforcement.

## [0.12.0-alpha.1] - 2026-09-08

### Added
- Reader-based card enrollment for an existing central user: choose a station/advertised reader,
  explicitly start collection, inspect a masked result, then confirm before adding a normal card
  and reconciling existing assignments. Fresh device identity/capability checks gate every start.
- Manufacturer-documented CaptureCardInfo workflow. The commissioned firmware advertises support
  and card length 1ג€“32; its detailed capabilities do not advertise reader selection, so the
  documented default-reader request omits readerID. Collection technology is never confused with
  the access-control cardType enum. Unsupported or malformed capabilities/results fail closed.
- Administrator-owned, ephemeral collection sessions: one per station, three across the fleet,
  30-second collection request and two-minute session lifetime. Full card numbers remain in backend
  memory until explicit storage; only masked previews reach the browser. Cancel, expiry and unload
  discard the private result. Existing ownership, uniqueness, capacity and revision guards apply.
- A separate collection I/O lane avoids holding the normal poll/snapshot/release lock while waiting
  for a card. Requests are bounded and never automatically retried. Cancelling HA's request does
  not claim to reset the firmware's reader mode or change its local access rules.
- English/Hebrew mobile workflow with persistent footer actions, cancellation on close, stale-user
  approval protection and discarded late responses. An uncertain save response directs the admin
  to inspect Users/Sync, without claiming that nothing was saved or automatically retrying.

### Validation and commissioning
- Automated coverage includes actual HA WebSocket authorization/privacy, unsupported capabilities,
  exact default/selected-reader requests, isolated normal I/O, lifecycle/expiry, duplicate approval,
  concurrent edits, failed storage and Hebrew mobile behavior.
- A live read-only check verified identity and both capability endpoints; no CaptureCardInfo
  collection request, credential mutation or relay command was issued during development.
  Physical collection and subsequent card acceptance/removal remain to be commissioned.
- No storage migration or expansion to other device models. PIN modification, timed validity,
  ringing/video and nine-station acceptance remain open. Optional Phase 6 now includes CSV,
  basic reporting and a capability-gated enrollment implementation; mandatory acceptance remains
  28 of 38 applicable items closed (73.7%), ten open (26.3%).

## [0.11.0-alpha.1] - 2026-09-08

### Added
- CSV bulk import/export in Users: a UTF-8 template, create-only or explicit update mode,
  secret-free row previews, changed-field and revocation indicators, and administrator confirmation.
  Up to 500 rows / 256 KiB are validated together, including employee/PIN/card collisions,
  station eligibility, observed capability limits and pending credential-removal reservations.
- Atomic central batch storage: no partially imported rows on validation or storage failure.
  A review token binds the file, mode, central revisions/ownership and captured station rules.
  Stale reviews require a fresh preview. Saved work uses existing independent station queues,
  fresh device validation, conflict protection and durable offline revocation; fleet writes are
  not an atomic transaction. Exports omit PINs and full card numbers.
- Activity reports and filtered CSV export across all matching retained records, rather than
  only the visible page. Totals, station/day breakdowns, authentication methods and recovery
  counts distinguish authentication from unlocking records. Daily groups use UTC; retention,
  missing-history and storage status remain visible. These are event counts, not unique visits.
- English/Hebrew responsive controls and spreadsheet formula neutralization. Late report
  responses cannot download a file after filters, permissions or panel lifecycle change.
- A deferred validation ledger links manufacturer contracts, observed firmware behavior and
  exact future commissioning steps without marking physical acceptance as passed.

### Performance and validation
- Bulk planning/preparation and CSV/report encoding run in workers. Large batches coalesce
  synchronization requests once per affected station. Cancelling preparation cannot publish
  partial state or overwrite a later edit; in-progress durable saves retain existing protection.
- Coverage includes 500 users across nine simulated stations, failed storage, concurrent edits,
  cancelled preparation, private previews/logs, real HA administrator enforcement, complete
  filtered reports, download lifecycle and Hebrew mobile layouts.
- No new ISAPI endpoint, storage migration or live physical/credential operation in development.
  PIN change/removal, card lifecycle, timed validity, ringing/video and nine-station acceptance
  remain deferred. CSV and basic reporting advance optional Phase 6; the mandatory tally remains
  28 of 38 applicable Definition of Done items closed (73.7%), ten open (26.3%).

## [0.10.0-alpha.1] - 2026-09-08

### Added
- Detailed read-only sync review compares ten fields of effective central and observed station
  state: presence, name, user type, validity, door rights, PIN, cards, schedules, administrative
  rights and biometric credentials. PINs remain write-only and card numbers remain masked.
  Credential differences are computed before masking, including cards with identical suffixes.
- Preview the logical user/PIN/card changes required by central state, including revocation for
  disabled/unassigned/deleted users, together with reconciliation targets and offline status.
  Importing device fields explicitly explains its fleet-wide impact and preserves active state
  and assignments. The preview does not reserve capacity or prove physical access.
- Supported-action checks explain why a resolution is unavailable, including unmanaged ownership,
  unsupported schedules/credentials/door permissions and missing device records. Unknown PIN
  readback is displayed as unverified. Writes still require fresh validation and readback.
- English and Hebrew responsive field comparisons, read time, captured revision, applied revision,
  last reconciliation, changed-field highlights and an explicit Read comparison again action.

### Fixed
- Resolution uses the central revision captured with the review, rather than a newer background
  overview revision the administrator has not reviewed. Concurrent central edits disable approval;
  the backend rejects stale revisions before device reads and atomically before persistence.
- A stale-device or revision-conflict response invalidates the open review until it is read again.
  No automatic retry or silent overwrite is performed.

### Validation and scope
- Regression coverage exercises secret masking, identical card suffixes, disabled-card exclusion,
  timed-validity display, offline targets, unsupported fields, deletion, missing ownership,
  concurrent edits, real HA WebSocket privacy/revision handling and Hebrew mobile behavior.
- No new ISAPI endpoint, storage migration or live device mutation. Physical PIN/card lifecycle,
  validity enforcement, ringing/camera acceptance and nine-station soak remain open.
- A requirement-by-requirement completion ledger replaces previous rough estimates: 28 of 38
  applicable Definition of Done items are closed (73.7%); ten remain open (26.3%). The owner's
  two excluded Relay 2 selection items and optional Phase 6 do not enter this denominator.

## [0.9.1-alpha.1] - 2026-09-08

### Fixed
- Opening one door no longer disables the other stations' release buttons. Pending state is
  tracked per station across Overview, Intercoms and the camera dialog. The same station rejects
  repeated clicks while its request is in flight; other online configured doors remain usable.
- A slow overview refresh no longer prolongs a completed release request's busy state. Existing
  HA `unlocking` state is respected for its own station, including commands from other clients.
- Release progress, acknowledgement and safe errors appear beside the targeted station with
  the last request time. Missing acknowledgement is explicitly unconfirmed, never automatically
  retried or represented as proof of physical door state. Unknown exception details stay private.
- Panel reattachment reconnects immediately. Late release/overview responses from an earlier
  panel lifecycle cannot restore stale state or suppress a newer queued overview refresh.

### Validation and compatibility
- Regression tests hold responses pending, complete two station requests out of order, reject
  same-door duplicates, isolate failure feedback and verify reconnect and Hebrew mobile behavior.
- Real HA transport regressions cover concurrent independent station runtimes and known/unknown
  release errors. The existing per-station backend guards and fleet admission limits remain.
- No new ISAPI behavior, credential writes, storage migration or physical relay test in this change.
  Hardware PIN/card, ringing, timed validity and nine-station acceptance gates remain open.

## [0.9.0-alpha.1] - 2026-09-08

### Added
- Separate **Save** and **Save & sync** in the user editor. Both durably store changes first;
  Save leaves scheduling to automatic/already-running reconciliation, while Save & sync also
  requests immediate background work. Save does not pause synchronization or create a private draft.
- Optional active-lock names during setup/reconfiguration, displayed on the HA lock entity,
  Overview, camera dialog, Intercom details and user assignments. Retaining a confirmed mapping
  allows renaming without a release test, and the existing HA entity ID is preserved.
- Configured validity summaries in desktop/mobile user lists: no expiry, not started, within
  period, expired or unverified. Dates use the browser's local timezone, and summaries refresh
  as time passes even if a later overview request fails. Sync status remains separate.

### Compatibility and validation
- Legacy API clients retain immediate scheduling by default. The new `sync_now` field accepts
  only a boolean on user create/update commands; administrative authorization and redaction remain.
- Existing unnamed lock configurations remain valid. Emptying the name during reconfiguration
  restores the default label. No access storage/config schema migration or new ISAPI endpoint.
- Regression coverage includes durable deferred scheduling/restart, storage failure, legacy API
  behavior, lock renaming without release/entity recreation, timezones and Hebrew mobile layouts.
- Physical PIN/card lifecycle, timed enforcement, ringing and nine-station soak remain open.

## [0.8.0-alpha.1] - 2026-09-08

### Fixed
- **Rescan access capabilities** and the `rescan_station` action now read access capabilities
  and inventory without requesting synchronization or changing desired permissions. Previously,
  rescan shared the sync action and could initiate pending user/credential writes.
- Concurrent station scans share one bounded read. Cancelling one caller does not interrupt
  another; unloading the station cancels the shared scan. A final inventory read after writes
  cannot reuse a scan that started before those writes.
- Failed inspection preserves the last successful inventory and reconciliation timestamps,
  exposes a safe error category and keeps private exceptions out of HA background-task logs.

### Added
- Intercom cards show observed call/snapshot/video, user/card and event-query capabilities,
  configured physical/API lock mapping, live event connection and history recovery status.
  Capabilities that were not observed are labelled unverified, not presumed unsupported.
- Dedicated inspection progress/error feedback, configured-lock release and Home Assistant
  configuration controls in each Intercom card. Camera-only stations expose no release button.
- Deliberate **Select all eligible stations** and **Clear selection** in the user editor,
  with selected-station count and existing sync status. Offline configured stations can be
  selected; camera-only stations are excluded. Changes take effect only after Save & sync.
- English/Hebrew labels and desktop/mobile browser coverage for these workflows.

### Compatibility and validation
- No storage or configuration schema change. Rescan uses already implemented read endpoints;
  core camera/call observations retain their setup-time meaning. Existing scheduled sync still
  operates independently; use Sync now to explicitly request pending reconciliation.
- Regression coverage includes read-only rescans with pending writes, shared-reader cancellation,
  unload cleanup, post-write freshness, failure privacy, admin entry points and fleet assignments.
- Physical credential lifecycle, timed validity and nine-station commissioning remain open.

## [0.7.0-alpha.1] - 2026-09-08

### Added
- Overview station cards show the last retained access event with person, authentication,
  event time and historical/receipt-time context. Door movement is not interpreted as a
  successful credential use; unknown unlocking outcomes remain unknown.
- Offline cards show the last successful status contact and the number of users awaiting
  reconciliation. Intercom details include the last successful status-request duration,
  observed managed-user count and last fully successful reconciliation.
- Previous PIN removals awaiting confirmation are visible in the Sync screen, alongside
  card removals, assignment revocations and deleted users. No PIN value is exposed.
- Search central users by the four visible trailing card digits, name or employee ID.

### Fixed
- Count pending work once per user/station, including removals and saved write intents,
  instead of counting one person repeatedly or omitting credential removals.
- Sort event history by actual time across timezone offsets. Replayed older events,
  unrelated door events and future clock outliers cannot replace a newer access summary.

### Compatibility and validation
- No storage/config schema change, new device requests or new ISAPI write behavior.
- Last-contact/request/reconciliation observations are retained through disconnects in the
  current runtime; they are unknown after a fresh load until actually observed. Event history
  and pending removals retain their existing persistence and retention behavior.
- Regression coverage includes offline recovery, restart, overlapping removals, event replay,
  privacy, admin-only HA responses and English/Hebrew desktop/mobile screens.
- Physical PIN/card lifecycle, time-limited validity and sustained nine-station acceptance
  remain open. Historical access summaries do not trigger live automations.

## [0.6.1-alpha.1] - 2026-09-08

### Fixed
- Fix station-side rejection of new permanent users: this firmware rejects the generic
  1970/2037 validity endpoints even with validity disabled. Use the interior 2000/2030
  interval accepted by the station; `enable=false` continues to mean permanent access.
- Keep the actual user-sync failure visible in station summaries and show translated
  explanations directly in the Sync matrix, including while the station is offline.
- Report contradictory timezone readback for time-limited users explicitly, without
  guessing which timezone the firmware enforces or marking those records synchronized.

### Added
- Administrator-only **Download sync diagnostics** in the Sync screen. The bounded report
  includes request stage, pseudonymous station/user references, error category and recognized
  ISAPI status/field identifiers. It excludes names, employee IDs, addresses, credentials and
  request/response bodies. The last 200 stages are held in memory until restart.
- Debug logs for sync stages and throttled warnings for failures; cancelled work and unexpected
  worker failures are observable without logging exception text or payloads.
- Regression tests for rejected-date recovery with a saved write intent, firmware readback,
  cancellation, report privacy/bounds and administrator/browser access.

### Validation and acceptance
- Production manager created and updated a credential-free test user on the real station.
  Targeted deletion was verified, and all pre-existing users/cards were unchanged.
- HACS installation of the previous release was confirmed by the owner. This update still
  requires installation and a retry of the owner's pending user synchronization.
- Timed validity semantics, PIN/card physical lifecycle and remaining fleet commissioning
  are still acceptance gates. No PIN/card was created or lock activated by this fix test.
- No storage schema change; pending ownership intents and user assignments are preserved.

## [0.6.0-alpha.1] - 2026-09-08

### Combined release ג€” Phases 2ג€“5

This prerelease includes all changes below for versions 0.3ג€“0.5 as well as Phase 5.
It upgrades the public 0.2 core integration with central user/PIN/card management,
the Hebrew/English administrator panel, camera/live-video views, synchronization,
import/conflict review, native events and bounded audit history.

Select `0.6.0-alpha.1` in HACS (enable beta versions if needed) and restart Home Assistant.
Requires Home Assistant 2026.9.1+. Back up HA before upgrading; configuration and private
access data migrate while preserving existing credentials and confirmed relay permissions.
Downgrading requires the matching backup. See [upgrade guidance](https://github.com/jonioliel/home-assistant-hikvision-intercom/blob/main/docs/HARDENING.md).

Validation: 328 protocol tests, 104 real Home Assistant tests and 14 browser tests;
Ruff, mypy, TypeScript, reproducible frontend bundle, HACS and Hassfest.
The release workflow reruns required checks on the exact publication commit.

### Phase 5 hardening

- Add private-free diagnostics for request timing, capability limits and synchronization queues.
- Add translated Repairs for storage failure, changed identity/mapping, capability regression,
  authentication, capacity and persistent conflicts; transient offline states stay out of Repairs.
- Validate and migrate config entries to 1.2 and private access data to schema 2 without changing permissions.
- Reserve replaced PINs until all former stations confirm removal; preserve ownership across restart/deletion.
- Bound administrator concurrency/rate, stored-file reads and event retention writes.
- Add repeated nine-station simulated recovery tests and a successful concurrent read-only station check.
- Physical PIN/card lifecycle, nine-station soak and real HACS install/upgrade remain acceptance gates.


## [0.5.0-alpha.1] ג€” Phase 4 (included in 0.6.0-alpha.1)

- Add bounded alert-stream framing for the station's nested JSON MIME messages.
- Normalize documented access events without inferring physical door movement or call answer.
- Add native doorbell/access event entities, call-status edge fallback and reconnect cleanup.
- Persist up to 5,000 masked audit records with 30-day retention, filters and history recovery.
- Provide the Hebrew/English administrator Events view; no PINs or complete cards in event state.
- Validate the production client with 241 queried records and a bounded live stream capture.


## [0.4.0-alpha.1] ג€” Phase 3 (included in 0.6.0-alpha.1)

### Added ג€” Phase 3
- Bundled Lit/TypeScript administrator sidebar: overview, users/editor, devices and sync matrix.
- English/Hebrew RTL, mobile person cards, dark/light HA themes and keyboard-accessible dialogs.
- HA camera previews and enlarged HA HLS video; no direct device connection from the browser.
- Administrator-only WebSocket CRUD, import/adoption, conflict review, sync and release controls.
- Write-only PIN editing, masked existing cards, deletion confirmations and revision-aware saves.
- Coalesced data-free subscriptions and immediate ring/offline updates from normal HA entities.
- WebSocket payload filtering and private schema errors, including debug logging regression tests.
- Reproducible frontend bundle checks and Chromium UI tests in GitHub Actions.

### Validation and scope
- The panel uses the Phase 2 backend. Events/audit capture follows in Phase 4.
- Published together with Phases 2, 4 and 5 in the 0.6.0-alpha.1 prerelease.
- Physical acceptance and installation/upgrade on the owner's HA host remain pending.

## [0.3.0-alpha.1] ג€” Phase 2 (included in 0.6.0-alpha.1)

### Added ג€” Phase 2
- Capability-driven user/card access client with bounded complete pagination and explicit write transactions.
- Private central records, masked administrator views, revision/identity guards and durable ownership journals.
- User-deletion tombstones and retired-card reservations survive offline stations and restarts.
- Re-check the configured device identity before relay commands and credential transactions.
- Reconciliation with saved intent before every mutation, exact readback, lost-response recovery,
  revision protection and deletion/card-removal confirmation per station.
- Explicit import/adoption, central/device conflict review, ignored unmanaged people and targeted deletion.
- Private atomic HA Store, independent background station queues, admin sync actions and offline retries.
- Reject switching a station to camera-only while managed access still needs removal.
- Modify only changed supported fields; unchanged PINs are never resubmitted for a name edit.

### Validation and scope
- Backend software includes simulator coverage for nine stations, three concurrent writers,
  offline recovery, concurrent edits/deletion and persistence failure. Physical nine-station soak is pending.
- Existing device users are scanned without automatic adoption or modification.
- The administrator panel and public CRUD WebSocket interface arrive in Phase 3.
- Configuration readback is not proof of keypad/card acceptance. Physical PIN modification/removal,
  card CRUD, call transitions and HACS installation acceptance remain open.

## [0.2.0-alpha.1] - 2026-09-08

### Added
- Phase 1 core integration: setup, reauth/reconfigure, confirmed single-relay mapping,
  shared polling, camera, online/ringing/call status, momentary lock and an admin release action.
- English/Hebrew setup and entity translations, connection-safe diagnostics and lifecycle tests.
- Dedicated Home Assistant 2026.9.1 / Python 3.14 CI tests in addition to protocol tests.
- Settings validation, explicit physical mapping confirmation, offline backoff, snapshot caching,
  stable station identity, credential-safe RTSP source and optimistic lock-state display.
- Admin-only release action, translated errors and English/Hebrew setup/options.
- HA unload/reload/shutdown cleanup and guards against stale targets or changed station identity.

### Validation and scope
- Requires Home Assistant 2026.9.1+. All publication checks run against the exact release commit.
- Production-client read-only check passed on the target firmware without sending a release.
- One active physical relay per station; camera-only mode is supported.
- Central user/card/PIN management and the dedicated administrator panel follow in Phases 2ג€“3.
- Physical PIN change/removal, card CRUD, call sequence and nine-station commissioning remain open.

## [0.1.0-alpha.1] - 2026-09-08

### Added
- Review of seven supplied manufacturer references with exact API/page and dictionary provenance.
- Verified call-status, permission-template and event-search capability responses.
- Sanitized supervised evidence for one active relay, populated user/card reads, card access,
  initial local PIN acceptance and failed PIN change despite successful API readback.
- Owner scope: relay 2 excluded throughout the project; answered-call tests deferred.
- Sanitized real-device fixtures and capability matrix for V3.9.0 build 260115.
- Extended read-only capability and PIN-mode reconnaissance using observed firmware routes.
- Separate evidence for decoded RTSP video, snapshot, idle calls and stream recovery.
- Async read-only ISAPI probe with Digest authentication and typed capability reports.
- Fixed endpoint allowlist, bounded pagination, alert stream and call timeline capture.
- XML/JSON parsing and normalized errors, including ResponseStatus errors inside HTTP 200.
- Sanitized report/fixture archives and synthetic protocol/security tests.
- HACS layout, Python CI, HACS, Hassfest and gated GitHub Release workflow.
- Real-device commissioning runbook and phase tracking.

### Fixed
- Recognize documented card/person capacity errors, person/PIN conflicts and device-busy status.
- Parse the real CallStatus.status and responseStatusStrg search response fields.
- Read length-delimited JSON alert-stream events and reject incomplete MIME parts.
- Obtain a fresh Digest challenge for each read after observed cached-auth rejection.
- Preserve firmware build, counts, capability bounds and PIN-mode metadata in sanitized exports.
- Reject malformed/empty capability wrappers as support evidence.
- Bound nested payload traversal before redaction.
- Retain device errors inside a successful event-stream HTTP response.
- Preserve the original Master Spec verbatim by excluding its code fences from formatting.

### Security
- No relay, configuration, user or card mutations in the probe.
- TLS verification by default; redirects, environment proxies and transport retries disabled.
- Size/deadline limits include Digest challenge buffering.
- Credentials, personal identifiers, raw images and unknown values excluded from exports.

### Release status
- Prepared development version: 0.1.0-alpha.1.
- Phase 0 protocol-tooling prerelease; HA setup/entities arrive in Phase 1.
- Witnessed active-relay/card/initial-PIN evidence is available;
  PIN change diagnosis, test-user cleanup and remaining acceptance gates are open.
