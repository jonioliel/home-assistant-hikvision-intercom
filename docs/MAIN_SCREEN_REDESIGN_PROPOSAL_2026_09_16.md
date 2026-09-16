# Main screen redesign proposal — 2026-09-16

Status: owner approved the visual direction; implemented for the modern appearance in 1.0.0-rc.7.

## Objective
Show 4–12 stations in the available desktop viewport without vertical scrolling, while keeping readable station names, camera previews, and direct door controls. Station count remains 1–X; 12 is a view density, not a product limit.

## Proposed interaction
- Compact horizontal navigation, live clock/date, and one summary toolbar.
- Auto-fit layout based on both available height and width, with selectable 4/6/9/12 view density and fullscreen.
- Twelve-station desktop proposal: four columns and three rows; four stations: two by two; other densities adapt to viewport.
- Each tile shows station name, text-plus-color connection/call status, camera preview, and a stable door action footer.
- Only enabled relays appear. Two enabled relays share the footer; actions operate independently.
- Detailed events, diagnostics and technical settings move into a details dialog instead of enlarging every tile.
- Ringing highlights the existing tile without moving controls. Offline tiles retain location and disable unavailable actions.
- Camera preview freshness must be explicit; twelve previews do not imply twelve concurrent full video streams.
- On constrained mobile screens, use readable tiles and paging instead of shrinking twelve touch targets into one screen. Desktop no-scroll target is subject to minimum readable tile size, available HA viewport, and browser zoom.

## Approval and implementation
The generated image is an illustrative visual proposal, with fictional camera views and sample status values. Implementation preserves the existing appearance. Automated checks cover 4/6/9/12 stations fitting a 1440×900 desktop, mobile paging/search and stable tile ordering. Smaller viewport heights use fewer tiles per page to preserve readable controls. Camera previews remain snapshots; live playback opens explicitly. No device-conflict changes were made after the owner reported resolving that issue.
