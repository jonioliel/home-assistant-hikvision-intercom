# WisKey embedded panel — contract v1 and SMPLWISE VMS handoff

Target build: **2.0.0-rc.19**. Contract version: **1**. Technical domain and route remain
`hikvision_intercom` and `/hikvision-intercom`.

## הוראות קצרות להעברה לצוות VMS

יש לטעון את המסכים המקוריים של WisKey בתוך iframe באותו מקור דפדפן, עם
`embed=1`. הניווט מתבצע דרך פרמטרים בכתובת ודרך `postMessage`; אין צורך לקרוא
רכיבי Shadow DOM או לקרוא למתודות הפנימיות של הפאנל. רשימות המסכים וכלי הניהול
מגיעות בהודעת `wiskey:ready`. ההרשאות, אישורי הפעולות, ערכות העיצוב והמדיה נשארים
באחריות WisKey ובזהות המשתמש המחובר לתשתית המערכת.

הקובץ הזה והמימוש לדוגמה
[wiskey-embed-client.mjs](examples/wiskey-embed-client.mjs) הם חבילת ההעברה.
אין צורך להחליף אינטגרציה, להעביר נתונים או להגדיר הרשאה חדשה.

## 1. Deployment and ownership

Use the existing panel, under the actual signed-in browser operator, in a same-origin
iframe inside the VMS ingress page. Build its URL from the **origin**, not the ingress
path: `new URL('/hikvision-intercom', window.location.origin)`.

This contract reuses the original screens rather than reproducing or proxying their
backend actions. WisKey's server-side permissions, station/field scopes, session locks,
fresh authentication, revisions, confirmations and audit attribution still apply.
An iframe is not a new service account, permission grant or arbitrary command channel.

Normal `/hikvision-intercom` opening retains its existing toolbar, menu, refresh,
navigation, themes and content. Deep-link query parameters now work there as well.
No panel registration setting changes: `frontend_url_path='hikvision-intercom'`,
`require_admin=False`, `embed_iframe=False`, `trust_external=False`.

The same-origin and signed-in deployment is a prerequisite, not an authentication
bypass. The VMS server must not expose Supervisor tokens to this iframe or JavaScript.
Other origins and opaque/sandboxed origins are not supported by this channel.

## 2. URL contract

| Parameter | Meaning |
| --- | --- |
| `embed=1` | Opt in to embedded layout. Other values or absence use normal layout. |
| `tab=<id>` | Select a permitted screen. Defaults to `overview`, or the first permitted default screen. |
| `tool=<id>` | Select a management screen when `tab=tools`. Omit it to show the hub grid. |

Examples:

```text
/hikvision-intercom?embed=1&tab=users
/hikvision-intercom?embed=1&tab=devices
/hikvision-intercom?embed=1&tab=tools
/hikvision-intercom?embed=1&tab=tools&tool=schedules
/hikvision-intercom?embed=1&tab=tools&tool=media_options
/hikvision-intercom?embed=1&tab=tools&tool=access_control
```

Canonical top-level IDs are `overview`, `users`, `devices`, `events`, `sync`, `tools`
and `camera_wall`. Top-level labels depend on language and appearance.

Management screen IDs currently include:

```text
clock_options       media_options         whatsapp_templates
profile_options     permission_directory  workflow_center
platform_center     operations_center     investigations
identity_lifecycle  guest_templates       visit_requests
fleet_alerts        audit                 health
schedules           access_control
```

The hub also links to `users`, `devices`, `sync` and `camera_wall`; these are returned in
its tool list and canonicalize to their top-level tab on navigation. Existing direct
links such as `tab=media_options` are accepted and normalize to
`tab=tools&tool=media_options`. **Use the installed instance's ready catalog**, not a
hard-coded copy of these lists, when building VMS navigation.

TTS settings and quick phrases are within `media_options`; there is no separate TTS
screen ID. Appearance remains the existing dialog opened from the hub. Infrastructure
integration settings remain a link, not an invented WisKey tool route. Both are fully
usable from the embedded hub.

Unknown/malformed URL IDs fall back to the existing allowed default. Inaccessible
screens also fall back; they never grant access. URL changes are parsed on mounting,
`window`'s `location-changed`, and `popstate`, after authentication/data are ready.

Navigation writes canonical `tab`/`tool` using `history.replaceState`, preserving
the router's `history.state`, other query parameters, `embed`, and hash. It does not
create a browser-history entry for each tab click. Back/forward restores screens when
the browser or host router has created corresponding entries. VMS controls its own
history policy and should mirror the **confirmed** iframe location into namespaced
parent parameters such as `wiskey_tab`/`wiskey_tool`.

## 3. Messages

All messages are ordinary structured objects, not JSON strings. Both parties must
check `event.origin === window.location.origin`. VMS additionally checks
`event.source === iframe.contentWindow`; WisKey checks `event.source === window.parent`.
Send with an explicit same-origin target, never `'*'`.

### Panel → its immediate parent

```js
{ type: 'wiskey:ready', version: 1,
  tabs: [{ id: 'users', label: 'People' }, /* ... */],
  tools: [{ id: 'media_options', label: 'Video, audio and announcements' }, /* ... */] }

{ type: 'wiskey:location', tab: 'tools', tool: 'media_options' }
{ type: 'wiskey:location', tab: 'users', tool: null }
{ type: 'wiskey:title', text: 'People' }
```

`ready` is sent once per successful panel mounting, after its authenticated overview
arrives. It is not replayed for every refresh/tab click. Remounting/reloading requires
a fresh handshake. It contains only permitted, available navigation IDs and localized
labels; it contains no person, device, credential or token data. It is a startup
catalog, not a substitute for current server-side authorization.

`location` follows navigation, including the actual retained location when the user
declines the schedule's existing unsaved-change confirmation. Do not optimistically
render the requested destination as confirmed. No repeated location messages are
emitted for background data refreshes alone. `tool` is a string or **null**, never a
credential, query or action payload.

`title` follows the page heading/route label and document-title changes. Render its
text with `textContent` or the framework's escaped text binding, not `innerHTML`.

### Parent → panel

```js
iframe.contentWindow.postMessage(
  { type: 'wiskey:navigate', tab: 'tools', tool: 'media_options' },
  window.location.origin
);
```

For a top-level tab, omit `tool` or send `null`. Unknown IDs, malformed input, unknown
message types, non-parent senders and different origins are ignored. Requests before
the first authenticated overview, during a session lock, after revocation, or to an
unavailable screen do not navigate. There is no unlock, send, edit, TTS or device-action
message in this contract. **Wait for ready before sending navigation.**

Successful permission checks still require the user's normal action inside the
corresponding screen to perform a mutation. Selecting a tab never performs that action.
The contract version changes only for breaking changes; additions remain discoverable.

## 4. Layout, sidebar and persistence

The panel root has `data-embed-api="1"`; its rendered app shell also carries it. Embedded
roots have `data-embed`. The entire WisKey toolbar is omitted: brand/title, top tabs,
infrastructure menu and refresh. Hub cards, tool-back links, forms, sub-navigation,
dialogs, camera controls and ordinary content remain available.

Embedded layout fills its host width/height without an infrastructure-header offset,
outer margin or content max-width. Existing RTL, responsive layouts and theme/accent
preferences are retained. Embed mode itself writes no local/session storage or server
preference. A new normal URL restores normal presentation.

The official frontend event is:

```js
window.dispatchEvent(new CustomEvent('hass-kiosk-mode', {
  detail: { enable: true }
}));
```

The payload is **`enable`**, not `kioskMode`. Verified against the official
[20260107.0 sidebar mixin](https://github.com/home-assistant/frontend/blob/20260107.0/src/state/sidebar-mixin.ts)
and [current sidebar mixin](https://github.com/home-assistant/frontend/blob/dev/src/state/sidebar-mixin.ts).
The listener updates in-memory kiosk state. WisKey restores the previously observed
state on leaving embed mode or disconnecting. It does not dispatch `hass-dock-sidebar`,
store `always_hidden`, change dock preferences, or intercept `hass-toggle-menu` globally.
Other browser tabs/parent frames receive no kiosk event.

Older infrastructure builds that do not handle the kiosk event ignore it. VMS may
retain its old **non-persistent, frame-scoped CSS** sidebar fallback only for that case.
Do not dispatch a competing kiosk state for contract-v1 builds.

## 5. VMS implementation steps

1. Install/update WisKey to the target build and reload its frontend after the normal
   infrastructure restart required by an integration update.
2. Register the message listener **before** assigning `iframe.src` so a fast ready is
   not missed. Clear the old catalog/state before intentionally reloading the iframe.
3. Load an absolute same-origin panel URL with `embed=1` and the selected tab/tool.
4. On version-1 ready, build the VMS WisKey tabs/tool links from the supplied catalog.
   Keep each ID separate from its translated label. Treat any incompatible version as
   unsupported; do not assume it is v1.
5. On a VMS tab selection, send `wiskey:navigate`; retain the actual selected state
   until `wiskey:location` confirms a location. A confirmation may retain the old screen.
6. Mirror iframe locations into VMS's own namespaced URL fields and process the host's
   router/back/forward by sending navigation. Do not feed each received message straight
   back to the child; that creates an echo loop.
7. Show `wiskey:title` as escaped text. Use the actual browser operator's permissions;
   never impersonate an administrator just because the VMS has its own menu permissions.
8. On refresh, reopen the same iframe URL using its last confirmed tab/tool. Close or
   remove the frame on VMS module exit so WisKey cleans up listeners and media.
9. Remove DOM `navigate()` calls and custom kiosk dispatch on the v1 path. Preserve
   the current older-build adapter only when the public marker is absent. If the marker
   exists but ready is delayed, show loading/authentication status rather than invoking
   the legacy adapter or making an unprivileged user appear authorized.

Give the iframe the media permissions required by your ingress deployment, for example
`allow="autoplay; microphone; fullscreen"`. Browser gestures/HTTPS, ancestor permission
policy and physical media behavior still apply. This attribute cannot override a
restrictive ancestor or browser policy. The embedding work does not change audio codecs,
video transports, TTS generation or device access.

## 6. Reference adapter

[examples/wiskey-embed-client.mjs](examples/wiskey-embed-client.mjs) demonstrates
same-origin validation, version negotiation, catalog discovery, message-based
navigation, refresh and a bounded older-build fallback hook. It supplies no HA token,
reads no Shadow DOM and calls no internal panel method on the v1 path.

```js
import { attachWiskey } from './wiskey-embed-client.mjs';

const iframe = document.querySelector('#wiskey-frame');
iframe.allow = 'autoplay; microphone; fullscreen';
const connector = attachWiskey(iframe, {
  initial: { tab: 'users', tool: null },
  onReady: ({ tabs, tools }) => renderWiskeyNavigation(tabs, tools),
  onLocation: ({ tab, tool }) => {
    selectConfirmedWiskeyTab(tab, tool);
    const url = new URL(window.location.href);
    url.searchParams.set('wiskey_tab', tab);
    if (tool) url.searchParams.set('wiskey_tool', tool);
    else url.searchParams.delete('wiskey_tool');
    history.replaceState(history.state, '', url);
  },
  onTitle: (text) => { document.querySelector('#wiskey-title').textContent = text; },
  onLegacy: () => activateExistingLegacyAdapter(),
  onWaiting: () => showWiskeyLoadingOrAuthentication(),
  onUnsupported: (version) => showUnsupportedWiskeyVersion(version),
});

// A user-selected management tool:
connector.navigate({ tab: 'tools', tool: 'media_options' });
// A deliberate refresh, after ordinary unsaved-change coordination:
connector.refresh();
// On VMS module teardown:
// connector.dispose(); iframe.remove();
```

The reference uses replace-state in its example; a VMS wanting an entry per local
navigation can use its router/push-state on **user intent**, then reconcile the actual
location returned by WisKey. Full iframe reloads can discard drafts: prefer messages
for tab changes. Apply your existing exit/refresh confirmation policy before reload.

## 7. Acceptance boundary

Automated iframe tests cover normal/embed mode, URL canonicalization, lifecycle,
desktop/mobile dialogs, host-sized light/dark layout, origin/source checks, malformed
IDs, restricted operators, lock/revocation, unsaved schedules, title notifications,
history state/back/forward and absence of automatic mutations/mode persistence.

After integrating the VMS adapter, its developer should verify the actual deployment:
one VMS toolbar, actual infrastructure sidebar behavior, bookmark/router mapping,
an administrator and a selected restricted operator, module unload/reopen, and an
existing camera/media session in the nested ingress frame. These are deployment checks,
not a requirement to repeat the user's previously passed reader/door tests.

This document confirms the implemented WisKey contract. It does not assert that the
separately developed VMS has already adopted it or that nested ingress media has been
physically accepted. See [implementation verification](WISKEY_EMBED_IMPLEMENTATION_CONFIRMATION_HE.md).
