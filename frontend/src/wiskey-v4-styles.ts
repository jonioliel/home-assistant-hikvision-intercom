import { css } from "lit";

/** Approved WisKey 04, opt-in and isolated from the four earlier appearances. */
export const wiskeyV4Styles = css`
  :host([data-appearance^="wiskey-"]) {
    --wk4-bg: #f4f6f5;
    min-height: 100dvh;
    --wk4-surface: #fff;
    --wk4-raised: #fff;
    --wk4-wash: #f7f9f8;
    --wk4-ink: #192a2d;
    --wk4-muted: #5f7170;
    --wk4-line: #dfe6e3;
    --wk4-accent: #087e70;
    --wk4-accent-soft: #e8f4ef;
    --wk4-on-accent: #fff;
    --wk4-green: #247553;
    --wk4-green-soft: #edf6ee;
    --wk4-amber: #985a0c;
    --wk4-amber-soft: #fff4df;
    --wk4-red: #b84045;
    --wk4-red-soft: #fbeef0;
    --wk4-blue: #315eae;
    --wk4-blue-soft: #edf3ff;
    --primary-background-color: var(--wk4-bg);
    --secondary-background-color: var(--wk4-wash);
    --card-background-color: var(--wk4-surface);
    --primary-text-color: var(--wk4-ink);
    --secondary-text-color: var(--wk4-muted);
    --divider-color: var(--wk4-line);
    --primary-color: var(--wk4-accent);
    --text-primary-color: var(--wk4-on-accent);
    --success-color: var(--wk4-green);
    --warning-color: var(--wk4-amber);
    --error-color: var(--wk4-red);
    --access-tint: var(--wk4-accent-soft);
    --access-hover: var(--wk4-wash);
    --access-green-bg: var(--wk4-green-soft);
    --access-amber-bg: var(--wk4-amber-soft);
    --access-red-bg: var(--wk4-red-soft);
    --hik-control-height: 38px;
    --wiskey-photo-size: 42px;
    --wiskey-radius: 12px;
    color-scheme: light;
    font: 14px/1.45 var(--wiskey-font);
  }
  :host([data-appearance="wiskey-dark"]) {
    --wk4-bg: #101c20;
    --wk4-surface: #18282d;
    --wk4-raised: #203338;
    --wk4-wash: #142329;
    --wk4-ink: #edf3f1;
    --wk4-muted: #a0b4b5;
    --wk4-line: #30444a;
    --wk4-accent: #8bddbc;
    --wk4-accent-soft: #213d37;
    --wk4-on-accent: #102c25;
    --wk4-green: #9cdfb7;
    --wk4-green-soft: #203a31;
    --wk4-amber: #edc689;
    --wk4-amber-soft: #413729;
    --wk4-red: #ffb2b7;
    --wk4-red-soft: #412b34;
    --wk4-blue: #a9c7ff;
    --wk4-blue-soft: #263750;
    color-scheme: dark;
  }
  :host([data-appearance^="wiskey-"]) .app-shell {
    min-width: 0;
    min-height: 100dvh;
    background: var(--wk4-bg);
  }
  :host([data-appearance^="wiskey-"]) .head {
    min-height: 58px;
    padding: 0 24px;
    gap: 16px;
    flex-wrap: nowrap;
    background: var(--wk4-surface);
    color: var(--wk4-ink);
    border-color: var(--wk4-line);
  }
  :host([data-appearance^="wiskey-"]) .head .brand {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--wk4-accent-soft);
    color: var(--wk4-accent);
  }
  :host([data-appearance^="wiskey-"]) .head h1 {
    font-size: 22px;
    font-weight: 780;
    letter-spacing: -0.7px;
  }
  :host([data-appearance^="wiskey-"]) .head .version {
    display: none;
  }
  :host([data-appearance^="wiskey-"]) .head .nav {
    align-self: stretch;
    margin-inline: 22px auto;
    width: auto;
  }
  :host([data-appearance^="wiskey-"]) .head .nav .nav-primary {
    align-items: stretch;
    gap: 4px;
  }
  :host([data-appearance^="wiskey-"]) .head .nav button,
  :host([data-appearance^="wiskey-"]) .head button {
    background: transparent;
    color: var(--wk4-muted);
    border-color: transparent;
    border-radius: 8px;
  }
  :host([data-appearance^="wiskey-"]) .head .nav button {
    min-height: 58px;
    padding: 8px 13px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 0;
    position: relative;
  }
  :host([data-appearance^="wiskey-"]) .head .nav button[aria-current="page"] {
    color: var(--wk4-accent);
    background: transparent;
  }
  :host([data-appearance^="wiskey-"]) .head .nav button[aria-current="page"]::after {
    content: "";
    position: absolute;
    inset-inline: 13px;
    inset-block-end: -1px;
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: var(--wk4-accent);
  }
  :host([data-appearance^="wiskey-"]) .head .spacer {
    flex: 1;
  }
  :host([data-appearance^="wiskey-"]) .head > button:last-child {
    border: 1px solid var(--wk4-line);
    min-width: 38px;
    min-height: 38px;
    padding: 7px 10px;
  }
  :host([data-appearance^="wiskey-"]) main {
    max-width: 1720px;
    min-width: 0;
    padding: 24px 28px 36px;
  }
  :host([data-appearance^="wiskey-"]) h2,
  :host([data-appearance^="wiskey-"]) .page-heading h2 {
    font-size: 27px;
    line-height: 1.25;
    letter-spacing: -0.5px;
  }
  :host([data-appearance^="wiskey-"]) button,
  :host([data-appearance^="wiskey-"]) input,
  :host([data-appearance^="wiskey-"]) select,
  :host([data-appearance^="wiskey-"]) textarea {
    font: inherit;
    border-radius: 8px;
  }
  :host([data-appearance^="wiskey-"]) button {
    min-height: 38px;
  }
  :host([data-appearance^="wiskey-"]) button.primary {
    background: var(--wk4-accent);
    border-color: var(--wk4-accent);
    color: var(--wk4-on-accent);
  }
  :host([data-appearance^="wiskey-"]) button:focus-visible,
  :host([data-appearance^="wiskey-"]) input:focus-visible,
  :host([data-appearance^="wiskey-"]) select:focus-visible,
  :host([data-appearance^="wiskey-"]) summary:focus-visible {
    outline: 3px solid #3878d4;
    outline-offset: 2px;
  }
  :host([data-appearance^="wiskey-"]) .box,
  :host([data-appearance^="wiskey-"]) .station,
  :host([data-appearance^="wiskey-"]) .tool-card,
  :host([data-appearance^="wiskey-"]) .device-card,
  :host([data-appearance^="wiskey-"]) fieldset,
  :host([data-appearance^="wiskey-"]) .table-wrap {
    border-color: var(--wk4-line);
    border-radius: 12px;
    background: var(--wk4-surface);
    box-shadow: 0 4px 18px #18342b09;
  }
  :host([data-appearance^="wiskey-"]) .toolbar {
    background: var(--wk4-surface);
    border-color: var(--wk4-line);
  }

  /* Entry center: the approved compact header, twelve-card capacity, and real data. */
  :host([data-appearance^="wiskey-"]) .wk4-page-head,
  :host([data-appearance^="wiskey-"]) .wk4-head-actions,
  :host([data-appearance^="wiskey-"]) .wk4-overview-toolbar,
  :host([data-appearance^="wiskey-"]) .wk4-filters,
  :host([data-appearance^="wiskey-"]) .wk4-door-info,
  :host([data-appearance^="wiskey-"]) .wk4-door-actions,
  :host([data-appearance^="wiskey-"]) .wk4-grid-foot {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-page-head {
    justify-content: space-between;
    margin-bottom: 18px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-page-head h2 {
    margin: 0;
  }
  :host([data-appearance^="wiskey-"]) .wk4-page-head p {
    margin: 3px 0 0;
    font-size: 13px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-head-actions button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-stats {
    display: flex;
    align-items: center;
    gap: 25px;
    min-width: 0;
    min-height: 54px;
    padding: 8px 18px;
    margin-bottom: 18px;
    border: 1px solid var(--wk4-line);
    border-radius: 10px;
    background: var(--wk4-surface);
  }
  :host([data-appearance^="wiskey-"]) .wk4-stats > div,
  :host([data-appearance^="wiskey-"]) .wk4-stats > button {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--wk4-ink);
    white-space: nowrap;
  }
  :host([data-appearance^="wiskey-"]) .wk4-stats strong {
    font-size: 18px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-stats span {
    color: var(--wk4-muted);
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-stats hikvision-live-clock {
    margin-inline-start: auto;
    font-size: 12px;
    color: var(--wk4-muted);
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 288px;
    gap: 22px;
    align-items: start;
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview-main,
  :host([data-appearance^="wiskey-"]) .wk4-overview-side {
    min-width: 0;
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview-toolbar {
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview-toolbar input {
    flex: 1 1 240px;
    min-width: 180px;
    max-width: 380px;
    height: 38px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-filters {
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--wk4-line);
    border-radius: 9px;
    background: var(--wk4-surface);
  }
  :host([data-appearance^="wiskey-"]) .wk4-filters button {
    min-height: 30px;
    padding: 4px 8px;
    border: 0;
    background: transparent;
    color: var(--wk4-muted);
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-filters button[aria-pressed="true"] {
    background: var(--wk4-accent-soft);
    color: var(--wk4-accent);
  }
  :host([data-appearance^="wiskey-"]) .wk4-density {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--wk4-muted);
    font-size: 12px;
    white-space: nowrap;
  }
  :host([data-appearance^="wiskey-"]) .wk4-density select {
    min-height: 30px;
    padding: 3px 7px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-fullscreen {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 4px 7px;
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-fullscreen .ui-icon {
    width: 14px;
    height: 14px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-count {
    margin-inline-start: auto;
    color: var(--wk4-muted);
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door {
    min-width: 0;
    overflow: hidden;
    background: var(--wk4-surface);
    border: 1px solid var(--wk4-line);
    border-radius: 10px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door.ringing {
    border-color: var(--wk4-accent);
    box-shadow: 0 0 0 2px var(--wk4-accent-soft);
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-image {
    height: 122px;
    position: relative;
    overflow: hidden;
    background: #17302e;
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview[data-dense="true"] .wk4-door-image {
    height: 88px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview[data-dense="true"] .wk4-door-info {
    padding-top: 6px;
    padding-bottom: 5px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview[data-dense="true"] .wk4-door-actions {
    padding-bottom: 7px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-image smplwise-access-control-camera {
    display: block;
    width: 100%;
    height: 100%;
    --camera-object-fit: contain;
  }
  :host([data-appearance^="wiskey-"]) .wk4-open-camera {
    position: absolute;
    inset-inline-end: 8px;
    inset-block-end: 8px;
    display: inline-flex;
    gap: 5px;
    align-items: center;
    min-height: 26px;
    padding: 3px 6px;
    background: #122e2bdd;
    border: 1px solid #ffffff4d;
    color: #fff;
    font-size: 11px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-open-camera .ui-icon {
    width: 14px;
    height: 14px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-offline {
    height: 100%;
    display: grid;
    place-content: center;
    color: #a9b9b4;
    text-align: center;
  }
  :host([data-appearance^="wiskey-"]) .wk4-ring {
    position: absolute;
    inset-inline-start: 8px;
    inset-block-start: 8px;
    padding: 3px 7px;
    background: var(--wk4-accent);
    color: var(--wk4-on-accent);
    border-radius: 5px;
    font-size: 11px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-info {
    flex-wrap: wrap;
    padding: 9px 11px 7px;
    gap: 2px 6px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-name {
    justify-content: flex-start;
    min-height: 20px;
    min-width: 0;
    max-width: calc(100% - 78px);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--wk4-ink);
    font-weight: 700;
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-name:disabled {
    opacity: 1;
  }
  :host([data-appearance^="wiskey-"]) .wk4-state {
    margin-inline-start: auto;
    color: var(--wk4-green);
    font-size: 11px;
    white-space: nowrap;
  }
  :host([data-appearance^="wiskey-"]) .wk4-state.offline {
    color: var(--wk4-red);
  }
  :host([data-appearance^="wiskey-"]) .wk4-state.ringing {
    color: var(--wk4-amber);
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-info small {
    flex-basis: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--wk4-muted);
    font-size: 11px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-actions {
    padding: 0 10px 10px;
    gap: 6px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-actions button:not(.wk4-more) {
    min-width: 0;
    flex: 1 1 auto;
    min-height: 34px;
    padding: 5px 7px;
    background: var(--wk4-accent-soft);
    border-color: transparent;
    color: var(--wk4-accent);
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door-actions .wk4-more {
    flex: 0 0 34px;
    width: 34px;
    min-height: 34px;
    padding: 0;
    font-size: 19px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-door .release-feedback {
    margin: 0 10px 10px;
    font-size: 11px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-grid-foot {
    justify-content: space-between;
    margin-top: 10px;
    color: var(--wk4-muted);
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-pager {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-pager button {
    min-height: 30px;
    padding: 3px 8px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-overview-side {
    display: grid;
    gap: 14px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-side-card {
    padding: 12px;
    border: 1px solid var(--wk4-line);
    border-radius: 10px;
    background: var(--wk4-surface);
  }
  :host([data-appearance^="wiskey-"]) .wk4-side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--wk4-line);
    padding-bottom: 8px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-side-head h3 {
    font-size: 15px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-side-head button {
    min-height: 24px;
    border: 0;
    color: var(--wk4-accent);
    background: transparent;
  }
  :host([data-appearance^="wiskey-"]) .wk4-event {
    display: grid;
    gap: 1px;
    padding: 9px 0;
    border-bottom: 1px solid var(--wk4-line);
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-event:last-child {
    border-bottom: 0;
  }
  :host([data-appearance^="wiskey-"]) .wk4-event small,
  :host([data-appearance^="wiskey-"]) .wk4-event time {
    color: var(--wk4-muted);
    font-size: 11px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-attention {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 7px 0;
    border: 0;
    border-bottom: 1px solid var(--wk4-line);
    background: transparent;
    text-align: start;
  }
  :host([data-appearance^="wiskey-"]) .wk4-attention small {
    color: var(--wk4-amber);
  }

  /* People remain a full-width table; the profile opens in a wide view. */
  :host([data-appearance^="wiskey-"]) .access-people-workspace {
    display: block;
  }
  :host([data-appearance^="wiskey-"]) .users-page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  :host([data-appearance^="wiskey-"]) .access-users-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 10px;
  }
  :host([data-appearance^="wiskey-"]) .users-heading {
    flex: 0 0 auto;
    margin: 0;
  }
  :host([data-appearance^="wiskey-"]) .users-heading p {
    display: block;
  }
  :host([data-appearance^="wiskey-"]) .users-tools {
    flex: 1 1 auto;
    margin: 0;
  }
  :host([data-appearance^="wiskey-"]) .users-tools input {
    max-width: none;
    min-width: 180px;
    width: 100%;
    flex: 1 1 240px;
  }
  :host([data-appearance^="wiskey-"]) .users-tools .wk4-filter-button,
  :host([data-appearance^="wiskey-"]) .users-tools .wk4-view-button {
    flex: 0 0 auto;
    min-height: 38px;
    padding: 7px 12px;
    background: var(--wk4-surface);
    border: 1px solid var(--wk4-line);
    color: var(--wk4-ink);
  }
  :host([data-appearance^="wiskey-"]) .users-tools .wk4-filter-button:hover,
  :host([data-appearance^="wiskey-"]) .users-tools .wk4-view-button:hover,
  :host([data-appearance^="wiskey-"]) .wk4-station-shortcuts button:hover {
    border-color: var(--wk4-accent);
    background: var(--wk4-accent-soft);
  }
  :host([data-appearance^="wiskey-"]) .access-people-table th {
    font-size: 12px;
    background: var(--wk4-wash);
    color: var(--wk4-muted);
  }
  :host([data-appearance^="wiskey-"]) .access-people-table td,
  :host([data-appearance^="wiskey-"]) .access-people-table th {
    border-color: var(--wk4-line);
  }
  :host([data-appearance^="wiskey-"]) .access-user-options,
  :host([data-appearance^="wiskey-"]) .access-selection-options,
  :host([data-appearance^="wiskey-"]) .user-result-bar {
    grid-column: 1;
  }
  :host([data-appearance^="wiskey-"]) .access-people-table {
    min-width: 0;
    overflow-x: auto;
  }
  :host([data-appearance^="wiskey-"]) .access-people-table table {
    min-width: 780px;
  }
  :host([data-appearance^="wiskey-"]) .access-people-table .phone-cell {
    min-width: 139px;
    white-space: nowrap;
  }
  :host([data-appearance^="wiskey-"]) .access-people-table td {
    height: 58px;
  }
  :host([data-appearance^="wiskey-"]) .access-person-identity .person-avatar {
    width: 42px;
    height: 42px;
    flex-basis: 42px;
  }
  :host([data-appearance^="wiskey-"]) .access-people-table tr[aria-selected="true"] {
    background: var(--wk4-wash);
  }

  /* Existing station tabs, programs, codes and HA jobs keep their components. */
  :host([data-appearance^="wiskey-"]) .device-station {
    padding: 20px;
  }
  :host([data-appearance^="wiskey-"]) .station-tabs {
    border-color: var(--wk4-line);
    gap: 8px;
  }
  :host([data-appearance^="wiskey-"]) .station-tabs button[aria-current="page"] {
    color: var(--wk4-accent);
    border-bottom: 2px solid var(--wk4-accent);
    background: transparent;
  }
  :host([data-appearance^="wiskey-"]) .device-station .station-settings-heading {
    align-items: center;
    margin-bottom: 14px;
  }
  :host([data-appearance^="wiskey-"]) .device-station .station-settings-heading h3 {
    font-size: 23px;
    margin: 0;
  }
  :host([data-appearance^="wiskey-"]) .station-tabs {
    gap: 3px;
    border-top: 1px solid var(--wk4-line);
    padding-top: 6px;
  }
  :host([data-appearance^="wiskey-"]) .device-station .station-settings-card {
    border-color: var(--wk4-line);
    border-radius: 10px;
    box-shadow: none;
  }
  :host([data-appearance^="wiskey-"]) .device-station .station-settings-card dl {
    margin-block: 10px;
  }
  :host([data-appearance^="wiskey-"]) .device-station .station-relay {
    border-color: var(--wk4-line);
    border-radius: 10px;
    padding: 12px;
  }
  :host([data-appearance^="wiskey-"]) .device-station .device-metrics {
    gap: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    justify-content: flex-end;
  }
  :host([data-appearance^="wiskey-"]) .device-station .device-metrics > div {
    flex: 0 1 180px;
    border: 0;
    background: transparent;
    text-align: center;
  }
  :host([data-appearance^="wiskey-"]) .wk4-station-shortcuts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-top: 14px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-station-shortcuts button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 18px;
    gap: 3px 8px;
    align-items: center;
    min-height: 84px;
    padding: 14px 16px;
    text-align: start;
    border: 1px solid var(--wk4-line);
    border-radius: 10px;
    background: var(--wk4-surface);
    color: var(--wk4-ink);
  }
  :host([data-appearance^="wiskey-"]) .wk4-station-shortcuts button strong {
    grid-column: 1;
    font-size: 15px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-station-shortcuts button span {
    grid-column: 1;
    color: var(--wk4-muted);
    font-size: 12px;
  }
  :host([data-appearance^="wiskey-"]) .wk4-station-shortcuts button svg {
    grid-column: 2;
    grid-row: 1 / span 2;
    color: var(--wk4-accent);
  }
  :host([data-appearance^="wiskey-"]) .tool-card {
    min-height: 106px;
    padding: 14px 16px;
  }
  :host([data-appearance^="wiskey-"]) .tool-card button,
  :host([data-appearance^="wiskey-"]) .tool-card a {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 35px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--wk4-ink);
    text-align: start;
    font-size: 15px;
    font-weight: 700;
  }
  :host([data-appearance^="wiskey-"]) .tool-card button svg:first-child,
  :host([data-appearance^="wiskey-"]) .tool-card a svg:first-child {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    padding: 7px;
    border-radius: 8px;
    background: var(--wk4-accent-soft);
    color: var(--wk4-accent);
  }
  :host([data-appearance^="wiskey-"]) .tool-card button svg:last-child,
  :host([data-appearance^="wiskey-"]) .tool-card a svg:last-child {
    margin-inline-start: auto;
    color: var(--wk4-muted);
  }
  :host([data-appearance^="wiskey-"]) .tool-card p {
    margin: 6px 41px 0 0;
    color: var(--wk4-muted);
    line-height: 1.4;
  }
  :host([data-appearance^="wiskey-"]) .tools-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  :host([data-appearance^="wiskey-"]) .sync-filters {
    flex-wrap: wrap;
  }
  :host([data-appearance^="wiskey-"]) .matrix {
    overflow: auto;
  }
  :host([data-appearance^="wiskey-"]) .camera-dialog {
    width: min(1240px, calc(100vw - 28px));
    border-radius: 12px;
  }
  :host([data-appearance^="wiskey-"]) .camera-dialog .dialog-body {
    padding: 14px 18px;
    overflow: auto;
  }
  :host([data-appearance^="wiskey-"]) .camera-layout.wk4-camera-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 16px;
    align-items: start;
  }
  :host([data-appearance^="wiskey-"]) .wk4-camera-main {
    min-width: 0;
  }
  :host([data-appearance^="wiskey-"]) .camera-layout.wk4-camera-layout .camera-video {
    max-width: 100%;
    border-radius: 10px;
    overflow: hidden;
    position: relative;
  }
  :host([data-appearance^="wiskey-"]) .wk4-camera-tts {
    min-width: 0;
  }
  :host([data-appearance^="wiskey-"]) .wk4-camera-tts wiskey-intercom-tts {
    margin: 0;
    width: 100%;
  }
  :host([data-appearance^="wiskey-"]) .wk4-camera-layout > .release-feedback {
    grid-column: 1 / -1;
  }
  :host([data-appearance^="wiskey-"]) .camera-layout.wk4-camera-layout:fullscreen {
    overflow: auto;
    align-content: start;
  }

  @container intercom-panel (max-width: 1200px) {
    :host([data-appearance^="wiskey-"]) .wk4-overview-layout {
      grid-template-columns: minmax(0, 1fr) 250px;
      gap: 14px;
    }
    :host([data-appearance^="wiskey-"]) .wk4-door-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    :host([data-appearance^="wiskey-"]) .head .nav {
      margin-inline: 6px auto;
    }
    :host([data-appearance^="wiskey-"]) .head .nav button {
      padding-inline: 9px;
    }
  }
  @container intercom-panel (max-width: 980px) {
    :host([data-appearance^="wiskey-"]) .wk4-overview-layout {
      grid-template-columns: minmax(0, 1fr);
    }
    :host([data-appearance^="wiskey-"]) .wk4-overview-side {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    :host([data-appearance^="wiskey-"]) .wk4-door-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    :host([data-appearance^="wiskey-"]) .wk4-stats {
      flex-wrap: wrap;
      gap: 8px 18px;
    }
    :host([data-appearance^="wiskey-"]) .wk4-stats hikvision-live-clock {
      margin-inline-start: 0;
    }
    :host([data-appearance^="wiskey-"]) .access-users-header {
      flex-wrap: wrap;
    }
  }
  @container intercom-panel (max-width: 700px) {
    :host([data-appearance^="wiskey-"]) .head {
      min-height: 56px;
      padding: 7px 12px;
    }
    :host([data-appearance^="wiskey-"]) .head .nav {
      position: fixed;
      inset-inline: 0;
      inset-block-end: 0;
      top: auto;
      z-index: 5;
      width: 100%;
      height: calc(62px + env(safe-area-inset-bottom));
      padding: 0 4px env(safe-area-inset-bottom);
      background: var(--wk4-surface);
      border-top: 1px solid var(--wk4-line);
    }
    :host([data-appearance^="wiskey-"]) .head .nav .nav-primary {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    :host([data-appearance^="wiskey-"]) .head .nav button {
      min-width: 0;
      min-height: 58px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 5px 2px;
      font-size: 11px;
    }
    :host([data-appearance^="wiskey-"]) .head .nav button[aria-current="page"]::after {
      inset-block-end: auto;
      inset-block-start: 0;
    }
    :host([data-appearance^="wiskey-"]) main {
      padding: 14px 12px calc(80px + env(safe-area-inset-bottom));
    }
    :host([data-appearance^="wiskey-"]) .wk4-page-head {
      align-items: flex-start;
      gap: 10px;
      flex-wrap: wrap;
    }
    :host([data-appearance^="wiskey-"]) .wk4-page-head h2 {
      font-size: 24px;
    }
    :host([data-appearance^="wiskey-"]) .wk4-head-actions {
      width: 100%;
    }
    :host([data-appearance^="wiskey-"]) .wk4-head-actions button {
      flex: 1;
    }
    :host([data-appearance^="wiskey-"]) .wk4-stats {
      gap: 6px 14px;
      padding: 9px 11px;
    }
    :host([data-appearance^="wiskey-"]) .wk4-stats > div,
    :host([data-appearance^="wiskey-"]) .wk4-stats > button {
      flex: 1 1 calc(50% - 14px);
    }
    :host([data-appearance^="wiskey-"]) .wk4-stats hikvision-live-clock {
      flex-basis: 100%;
    }
    :host([data-appearance^="wiskey-"]) .wk4-overview-toolbar input {
      flex-basis: 100%;
      max-width: none;
    }
    :host([data-appearance^="wiskey-"]) .wk4-filters {
      max-width: 100%;
      overflow-x: auto;
    }
    :host([data-appearance^="wiskey-"]) .wk4-door-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    :host([data-appearance^="wiskey-"]) .wk4-door-image {
      height: 90px;
    }
    :host([data-appearance^="wiskey-"]) .wk4-door-actions button:not(.wk4-more) {
      font-size: 11px;
    }
    :host([data-appearance^="wiskey-"]) .wk4-overview-side {
      grid-template-columns: minmax(0, 1fr);
    }
    :host([data-appearance^="wiskey-"]) .access-users-header {
      display: block;
    }
    :host([data-appearance^="wiskey-"]) .users-tools {
      margin-top: 10px;
      flex-wrap: wrap;
    }
    :host([data-appearance^="wiskey-"]) .users-tools input {
      flex-basis: 100%;
    }
    :host([data-appearance^="wiskey-"]) .access-people-table {
      overflow: visible;
    }
    :host([data-appearance^="wiskey-"]) .access-people-table table {
      min-width: 0;
    }
    :host([data-appearance^="wiskey-"]) .camera-dialog {
      width: calc(100vw - 10px);
      max-height: calc(100dvh - 10px);
    }
    :host([data-appearance^="wiskey-"]) .camera-dialog .dialog-body {
      padding: 7px;
    }
    :host([data-appearance^="wiskey-"]) .camera-layout.wk4-camera-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 7px;
    }
    :host([data-appearance^="wiskey-"])
      .camera-layout.wk4-camera-layout
      .camera-video
      smplwise-access-control-camera {
      max-height: 32dvh;
    }
    :host([data-appearance^="wiskey-"]) .wk4-camera-tts {
      max-width: 100%;
    }
  }
  @container intercom-panel (max-width: 980px) {
    :host([data-appearance^="wiskey-"]) .tools-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container intercom-panel (max-width: 700px) {
    :host([data-appearance^="wiskey-"]) .tools-grid,
    :host([data-appearance^="wiskey-"]) .wk4-station-shortcuts {
      grid-template-columns: minmax(0, 1fr);
    }
    :host([data-appearance^="wiskey-"]) .device-station .device-metrics > div {
      flex: 1 1 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :host([data-appearance^="wiskey-"]) *,
    :host([data-appearance^="wiskey-"]) *::before,
    :host([data-appearance^="wiskey-"]) *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;
