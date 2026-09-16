# Station management redesign — proposal, 2026-09-16

Status: approved by owner. RC8 implements the navigation, HA program lifecycle and read-only public-slot inspection; see RC8_STATION_MANAGEMENT.md for delivered scope and remaining capability limits. The sections below preserve the original design proposal.

## Current behavior verified in source
- `frontend/src/hold-open.ts` reads/saves a per-door HA draft. Saving does not deploy a native plan or activate an HA timer.
- `client/technical.py:hold_command` is guarded and is not called by draft saving or runtime timers.
- Public PIN audit returns configured/absent/unknown states for public slots 1–16, not existing PIN digits. Do not imply that configured-state discovery proves create/update/delete support.
- User access timing enforcement is a separate feature from scheduled door hold-open.

## Proposed station navigation
Overview | Opening schedules | Public codes | Settings. Keep model, online state, last read time and selected station visible. A compact overview presents configured relays, immediate opening, next scheduled action and links to users/activity. Technical diagnostics remain in an advanced disclosure.

## Opening schedules
One list combines known HA-managed programs and native programs actually read from this station. Every row states its door, recurrence, time zone, execution location, origin/ownership, status, last verification and next action. Native read failure is an unknown/incomplete result, never an empty station. Distinguish a local saved proposal from something deployed to equipment.

Statuses: saved but inactive; applying; active and read back; paused; removal pending; failed/unknown. Reserve the word draft for saved-but-inactive content only. An offline station cannot produce a successful activation or confirmed deletion status.

Create/edit in one simple form: name, door, weekly weekdays or specific date(s), full day or time intervals, station/default or manual timezone, explicit execution location (HA or station), end behavior. Show a plain-language preview. Buttons: Save and activate / Save without activation / Cancel. Native is unavailable with a specific reason when the device does not support verified hold-open schedules. No silent fallback to HA.

HA mode explains that opening and return-to-normal require HA/network availability. Returning to normal is not proof of a physically closed or locked door without a sensor. Plan execution/recovery must not be represented as complete merely because a command was accepted.

## Pause and removal
Expose Edit / Pause / Remove beside each plan. Removal is distinct from deleting an unactivated local draft. Preview which door, controller and program are affected; if currently held open, explicitly explain/request the chosen immediate return-to-normal behavior. Verify removal on the controlling system; retain a pending record if offline or response uncertain. Removing a managed plan must not erase unrelated station configuration or externally owned plans. Detect shared native resources and references before deletion. Confirmed deletion removes the active listing but retains audit history.

## Public codes
Read configured slot states, with configured / empty / unknown and last checked time. Display a masked placeholder for configured slots; do not claim the stored code is readable. Add to an empty supported slot, replace with a new code (repeat entry), and remove a specific slot only when supported by documented and verified station capabilities. Do not log or export PIN values. A station exposing only configured flags remains read-only with an actionable reason. Illustrative mockup shows write-enabled controls explicitly labeled as a compatible-station example, not verified functionality on the owner's current model.

## Responsive and implementation acceptance
Desktop two-column overview; single-column mobile forms with visible action footer, accessible labels and touch targets. Schedule list becomes cards on mobile. No raw protocol resource IDs in normal workflows. Before implementation completion: cover duplicate requests, stale station identity, interrupted writes, HA restarts, offline return-to-normal, overlapping schedules, DST, shared native plans, removal readback, and unsupported public PIN operations. Physical hold/release behavior and firmware-specific PIN writes remain separately verifiable; do not report them tested from a mockup.
