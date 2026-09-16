# RC8: overview and station management

The approved station design is implemented in the modern appearance with Overview, Opening programs, Public codes and Settings tabs. The existing appearance retains its previous layout.

## Overview

Camera containers use 16:9 and contain the complete source image. Images with another aspect ratio retain their proportions with borders. Column selection maximizes useful image area within the available height; eight stations on a wide desktop use 4x2. Small phones show one station per page. Fullscreen, search and density selection remain available.

## Opening programs managed by Home Assistant

Choose a door, name, IANA time zone, weekly periods and optional date exceptions. Date exceptions replace the weekly periods on those dates. The full-day button uses 00:00–24:00. Save without activation does not send a command. Save and activate first verifies station identity and advertised alwaysOpen/close capabilities. One program is supported per managed door, with multiple windows.

HA checks programs every 15 seconds. At a window start it requests alwaysOpen; at its end it requests close (return to controlled operation, per the manufacturer RemoteControlDoor contract). These acknowledgements are not physical door-position confirmation. Pause returns an owned door to controlled operation. Editing requires pause first. Remove retains a pending record if the station is unreachable until restoration is acknowledged. Old saved plans can be edited or deleted.

Ownership is saved before sending an open command. After a restart or lost open acknowledgement, the worker restores controlled operation and does not reopen in that same window. HA shutdown or network loss can leave a door held open until communication resumes; this is not a station-local autonomous schedule. Changes to relay mapping are blocked while a program references that relay.

No physical station writes were performed for this release. Local simulated transport tests cover normal end, pause, remove, restart, lost acknowledgements, offline restoration and storage failure. Physical hold-open/restore behaviour still needs acceptance on the intended hardware.

## Capability boundaries

Station-native opening schedules are not enabled by this version. Public PIN inspection shows slot presence only, never PIN digits. Add/replace/delete public PIN operations remain unavailable because their write contract has not been verified. The interface explains these limits rather than reporting an unsupported operation as successful.
