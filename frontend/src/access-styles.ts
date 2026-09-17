import { css } from "lit";

/** Access is opt-in. Legacy selectors and media nodes remain unchanged. */
export const accessStyles = css`
  :host([data-access]) {
    --primary-background-color: #f5f6fa;
    --secondary-background-color: #f1f3f8;
    --card-background-color: #ffffff;
    --primary-text-color: #202432;
    --secondary-text-color: #657083;
    --divider-color: #e1e5ee;
    --primary-color: #5b54df;
    --text-primary-color: #ffffff;
    --error-color: #b83549;
    --success-color: #207448;
    --warning-color: #986015;
    --access-tint: #f0efff;
    --access-hover: #f7f8fc;
    --access-green-bg: #e9f5ee;
    --access-red-bg: #fcecef;
    --access-amber-bg: #fff4de;
    --wiskey-font: "WisKey Heebo", "Segoe UI", Arial, sans-serif;
    --paper-font-body1_-_font-family: var(--wiskey-font);
    --hik-control-height: 36px;
    --wiskey-photo-size: 34px;
    --wiskey-radius: 8px;
    --wiskey-space: 12px;
    color-scheme: light;
    font: 14px/1.45 var(--wiskey-font);
    background: var(--primary-background-color);
    container-type: inline-size;
  }
  :host([data-appearance="access-dark"]) {
    --primary-background-color: #10121a;
    --secondary-background-color: #202431;
    --card-background-color: #1a1d29;
    --primary-text-color: #edf0f7;
    --secondary-text-color: #a4aec2;
    --divider-color: #303647;
    --primary-color: #a49cff;
    --text-primary-color: #151326;
    --error-color: #ff9daf;
    --success-color: #81d9a3;
    --warning-color: #f4c877;
    --access-tint: #2b2844;
    --access-hover: #232837;
    --access-green-bg: #163d2f;
    --access-red-bg: #422532;
    --access-amber-bg: #423522;
    color-scheme: dark;
  }
  :host([data-access]) .app-shell {
    min-height: 100%;
    background: var(--primary-background-color);
  }
  :host([data-access]) .head {
    min-height: 60px;
    padding: 6px 20px;
    gap: 12px;
    flex-wrap: nowrap;
    background: #191d29;
    color: #f5f7ff;
  }
  :host([data-access]) .head .brand {
    width: 32px;
    height: 32px;
    background: #514bba;
    color: white;
    border-radius: 8px;
  }
  :host([data-access]) .head h1 {
    font-size: 20px;
  }
  :host([data-access]) .head .version {
    color: #b7bfd3;
    font-size: 10px;
    margin: 0;
  }
  :host([data-access]) .head button {
    background: transparent;
    border-color: #3a4053;
    color: #dce2f4;
  }
  :host([data-access]) .head .nav {
    margin-inline: 22px auto;
    order: 0;
    width: auto;
  }
  :host([data-access]) .head .nav .nav-primary {
    display: flex;
    gap: 4px;
  }
  :host([data-access]) .head .nav button {
    font-size: 14px;
    border: 0;
    border-radius: 7px;
    min-height: 38px;
    padding: 6px 14px;
    flex-direction: row;
  }
  :host([data-access]) .head .nav button[aria-current="page"] {
    background: #37334e;
    color: #d2cdff;
  }
  :host([data-access]) .head .spacer {
    flex: 0;
  }
  :host([data-access]) main {
    padding: 18px 22px 28px;
    max-width: 1920px;
  }
  :host([data-access]) h2 {
    font-size: 23px;
    letter-spacing: -0.4px;
    margin: 0;
  }
  :host([data-access]) h3 {
    font-size: 15px;
    margin: 0;
  }
  :host([data-access]) .page-heading {
    margin: 0 0 14px;
    gap: 10px;
  }
  :host([data-access]) .page-heading p {
    font-size: 13px;
    margin-top: 3px;
  }
  :host([data-access]) button,
  :host([data-access]) input,
  :host([data-access]) select,
  :host([data-access]) textarea {
    border-radius: 7px;
    font: inherit;
  }
  :host([data-access]) button {
    min-height: 36px;
    padding: 7px 12px;
  }
  :host([data-access]) input:not([type="checkbox"]):not([type="radio"]),
  :host([data-access]) select {
    min-height: 36px;
    padding: 6px 10px;
  }
  :host([data-access]) button.primary {
    background: var(--primary-color);
    color: var(--text-primary-color);
  }
  :host([data-access]) .ui-icon {
    width: 18px;
    height: 18px;
  }
  :host([data-access]) .box,
  :host([data-access]) .station,
  :host([data-access]) .tool-card,
  :host([data-access]) fieldset {
    border-radius: 10px;
    box-shadow: none;
    background: var(--card-background-color);
    border-color: var(--divider-color);
  }
  :host([data-access]) .status {
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 5px;
    white-space: nowrap;
  }
  :host([data-access]) .status.synced,
  :host([data-access]) .status.online,
  :host([data-access]) .status.active {
    color: var(--success-color);
    background: var(--access-green-bg);
  }
  :host([data-access]) .status.error,
  :host([data-access]) .status.offline,
  :host([data-access]) .status.conflict {
    color: var(--error-color);
    background: var(--access-red-bg);
  }
  :host([data-access]) .status.pending,
  :host([data-access]) .status.ringing {
    color: var(--warning-color);
    background: var(--access-amber-bg);
  }
  :host([data-access]) th {
    background: var(--secondary-background-color);
    color: var(--secondary-text-color);
    font-size: 12px;
    padding: 10px;
  }
  :host([data-access]) td {
    padding: 8px 10px;
    font-size: 14px;
    border-color: var(--divider-color);
  }
  :host([data-access]) tbody tr:hover {
    background: var(--access-hover);
  }
  :host([data-access]) .table-wrap {
    border: 1px solid var(--divider-color);
    border-radius: 9px;
    background: var(--card-background-color);
  }
  :host([data-access]) .toolbar {
    padding: 10px;
    margin: 8px 0;
    border-radius: 8px;
  }
  :host([data-access]) .tools-back {
    padding: 4px 8px;
    margin-bottom: 12px;
    font-size: 12px;
  }
  :host([data-access]) .tools-grid {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  :host([data-access]) .tool-card {
    padding: 14px;
  }
  :host([data-access]) .tool-card button {
    min-height: 36px;
    padding: 0;
    font-size: 15px;
  }
  :host([data-access]) .tool-card p {
    font-size: 13px;
    margin-bottom: 0;
  }
  :host([data-access]) .device-selector {
    padding: 0;
    border: 0;
    margin-bottom: 12px;
    max-width: 440px;
  }
  :host([data-access]) .device-station {
    padding: 18px;
  }
  :host([data-access]) .device-heading {
    margin-bottom: 12px;
    padding-bottom: 12px;
  }
  :host([data-access]) .device-summary-grid {
    gap: 12px;
  }
  :host([data-access]) .device-card {
    padding: 16px;
    border-radius: 9px;
  }
  :host([data-access]) .device-metrics {
    gap: 10px;
    margin-block: 12px;
  }
  :host([data-access]) .device-metrics > div {
    padding: 10px;
    border-radius: 8px;
  }
  :host([data-access]) .device-metrics strong {
    font-size: 22px;
  }
  :host([data-access]) .device-extra {
    margin-block: 10px;
    border-color: var(--divider-color);
  }
  :host([data-access]) .sync-filters {
    display: flex;
    align-items: end;
    gap: 12px;
  }
  :host([data-access]) .matrix td {
    min-width: 110px;
  }
  :host([data-access]) .matrix td button {
    min-height: 32px;
    padding: 4px 8px;
    background: transparent;
    border-color: transparent;
  }
  :host([data-access]) .matrix .sync-person {
    min-width: 160px;
  }
  :host([data-access]) .matrix th:first-child {
    position: sticky;
    inset-inline-start: 0;
    z-index: 1;
  }
  :host([data-access]) .matrix td:first-child {
    position: sticky;
    inset-inline-start: 0;
    background: var(--card-background-color);
    z-index: 1;
  }
  :host([data-access]) .sync-operations {
    margin: 10px 0;
  }
  :host([data-access]) dialog {
    border: 1px solid var(--divider-color);
    border-radius: 12px;
    background: var(--card-background-color);
    color: var(--primary-text-color);
  }
  :host([data-access]) dialog::backdrop {
    background: #090d19a8;
    backdrop-filter: blur(4px);
  }
  :host([data-access]) .dialog-head {
    padding: 14px 20px;
    background: var(--card-background-color);
  }
  :host([data-access]) .dialog-head h2 {
    font-size: 20px;
  }
  :host([data-access]) .dialog-body {
    padding: 16px 20px;
  }
  :host([data-access]) .dialog-foot {
    padding: 12px 20px;
    background: var(--card-background-color);
    border-top: 1px solid var(--divider-color);
  }
  :host([data-access]) .editor-dialog {
    width: min(1140px, calc(100vw - 40px));
  }
  :host([data-access]) #user-form {
    gap: 14px;
  }
  :host([data-access]) #user-form fieldset {
    padding: 14px;
    margin: 0 0 14px;
  }
  :host([data-access]) #user-form legend {
    font-size: 15px;
    font-weight: 650;
  }
  :host([data-access]) .camera-dialog {
    width: min(1050px, calc(100vw - 32px));
  }
  :host([data-access]) .camera-dialog .dialog-body {
    padding: 0;
  }
  :host([data-access]) .camera-video {
    border-radius: 0;
    background: #0c0f15;
  }
  :host([data-access]) .camera-video hikvision-intercom-camera {
    --camera-object-fit: contain;
  }
  :host([data-access]) .camera-layout {
    gap: 0;
  }
  :host([data-access]) .access-eyebrow {
    font-size: 11px;
    color: var(--secondary-text-color);
    font-weight: 600;
    letter-spacing: 0.6px;
  }
  :host([data-access]) .access-page-heading {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-bottom: 18px;
  }
  :host([data-access]) .access-page-heading hikvision-live-clock {
    margin-inline-start: auto;
  }
  :host([data-access]) .access-inline-stats {
    display: flex;
    gap: 14px;
    color: var(--secondary-text-color);
    font-size: 12px;
  }
  :host([data-access]) .access-inline-stats span {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  :host([data-access]) .access-dot {
    width: 6px;
    height: 6px;
    background: var(--success-color);
    border-radius: 50%;
  }
  :host([data-access]) .access-dashboard {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 290px;
    align-items: start;
    gap: 18px;
  }
  :host([data-access]) .access-section-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  :host([data-access]) .access-section-bar input {
    width: 240px;
    max-width: 65%;
  }
  :host([data-access]) .access-count {
    color: var(--secondary-text-color);
    font-size: 12px;
    margin-inline-start: 8px;
  }
  :host([data-access]) .access-doors {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  :host([data-access]) .access-door {
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
    border-radius: 9px;
    min-width: 0;
    padding: 10px;
  }
  :host([data-access]) .access-door[data-selected="true"] {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 1px var(--primary-color);
  }
  :host([data-access]) .access-door.ringing {
    border-color: var(--warning-color);
  }
  :host([data-access]) .access-door-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    width: 100%;
    text-align: start;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    min-height: 36px;
  }
  :host([data-access]) .access-door-heading strong {
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  :host([data-access]) .access-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--secondary-text-color);
    white-space: nowrap;
  }
  :host([data-access]) .access-status i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }
  :host([data-access]) .access-status.online {
    color: var(--success-color);
  }
  :host([data-access]) .access-status.offline {
    color: var(--error-color);
  }
  :host([data-access]) .access-status.ringing,
  :host([data-access]) .access-status.pending {
    color: var(--warning-color);
  }
  :host([data-access]) .access-door-body {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 0 10px;
  }
  :host([data-access]) .access-door-camera {
    padding: 0;
    border: 0;
    width: 66px;
    height: 50px;
    flex: 0 0 66px;
    overflow: hidden;
    background: var(--secondary-background-color);
  }
  :host([data-access]) .access-door-camera hikvision-intercom-camera {
    width: 100%;
    height: 100%;
    --camera-object-fit: contain;
  }
  :host([data-access]) .access-door-context {
    display: grid;
    gap: 3px;
    font-size: 12px;
    color: var(--secondary-text-color);
  }
  :host([data-access]) .access-door-context small {
    font-size: 11px;
  }
  :host([data-access]) .access-door-actions {
    display: flex;
    gap: 6px;
  }
  :host([data-access]) .access-door-actions button {
    width: 100%;
    padding: 5px 8px;
    min-height: 32px;
    background: var(--access-tint);
    color: var(--primary-color);
    border-color: transparent;
    font-size: 13px;
  }
  :host([data-access]) .access-context {
    display: grid;
    gap: 12px;
  }
  :host([data-access]) .access-context-card,
  :host([data-access]) .access-incoming,
  :host([data-access]) .access-attention {
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    padding: 14px;
  }
  :host([data-access]) .access-context-camera {
    aspect-ratio: 16/9;
    overflow: hidden;
    border-radius: 7px;
    background: #151921;
  }
  :host([data-access]) .access-context-camera hikvision-intercom-camera {
    width: 100%;
    height: 100%;
    --camera-object-fit: contain;
  }
  :host([data-access]) .access-context dl {
    display: block;
    margin: 10px 0;
  }
  :host([data-access]) .access-context dl div {
    display: flex;
    justify-content: space-between;
    padding: 7px 0;
    gap: 8px;
    font-size: 12px;
    border-bottom: 1px solid var(--divider-color);
  }
  :host([data-access]) .access-context dt {
    flex: 0 0 96px;
    color: var(--secondary-text-color);
  }
  :host([data-access]) .access-context dd {
    flex: 1;
    min-width: 0;
    text-align: end;
    margin: 0;
  }
  :host([data-access]) .access-context-actions {
    display: flex;
    gap: 8px;
  }
  :host([data-access]) .access-context-actions button {
    flex: 1;
    font-size: 12px;
    padding: 6px;
  }
  :host([data-access]) .access-incoming {
    border-color: var(--warning-color);
    background: var(--access-amber-bg);
  }
  :host([data-access]) .access-incoming h3 {
    margin: 4px 0 12px;
  }
  :host([data-access]) .access-incoming button {
    width: 100%;
  }
  :host([data-access]) .access-attention > button {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    width: 100%;
    text-align: start;
    border: 0;
    border-bottom: 1px solid var(--divider-color);
    border-radius: 0;
    background: transparent;
    font-size: 12px;
  }
  :host([data-access]) .access-attention h3 {
    margin-bottom: 6px;
  }
  :host([data-access]) .access-no-camera {
    height: 100%;
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    color: #d5dced;
  }
  :host([data-access]) .access-pagination {
    display: flex;
    gap: 12px;
    justify-content: end;
    align-items: center;
    margin-top: 12px;
  }
  :host([data-access]) .access-activity {
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    margin-top: 16px;
    padding: 14px;
  }
  :host([data-access]) .access-activity-row {
    display: grid;
    grid-template-columns: 24px 1fr 1fr auto auto;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    font-size: 13px;
    border-top: 1px solid var(--divider-color);
  }
  :host([data-access]) .access-activity-row time {
    font-size: 11px;
    color: var(--secondary-text-color);
  }
  :host([data-access]) .access-people-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    align-items: start;
    gap: 16px;
  }
  :host([data-access]) .access-people-list,
  :host([data-access]) .access-person-inspector {
    min-width: 0;
  }
  :host([data-access]) .access-person-inspector {
    position: static;
    max-height: none;
    overflow: visible;
    border-radius: 10px;
  }
  :host([data-access]) .users-page {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 12px;
  }
  :host([data-access]) .users-heading {
    grid-column: 1/-1;
    margin-bottom: 8px;
  }
  :host([data-access]) .users-heading p {
    display: none;
  }
  :host([data-access]) .users-tools {
    grid-column: 1;
    padding: 0;
    border: 0;
    background: transparent;
    margin: 0 0 8px;
  }
  :host([data-access]) .users-tools input {
    min-width: 100px;
    flex: 1;
    max-width: 480px;
  }
  :host([data-access]) .users-tools button {
    font-size: 12px;
    padding: 5px 9px;
  }
  :host([data-access]) .access-user-options {
    grid-column: 2;
    grid-row: 2;
    margin: 0 0 8px;
    align-self: start;
  }
  :host([data-access]) .access-user-options > summary,
  :host([data-access]) .access-selection-options > summary {
    min-height: 36px;
    padding: 7px 12px;
    border: 1px solid var(--divider-color);
    background: var(--card-background-color);
    border-radius: 7px;
    font-size: 12px;
    cursor: pointer;
  }
  :host([data-access]) .access-user-options[open] {
    grid-column: 1/-1;
    grid-row: auto;
  }
  :host([data-access]) .access-user-options[open] .users-filter-strip {
    margin-block: 10px;
  }
  :host([data-access]) .access-selection-options {
    grid-column: 2;
    margin-bottom: 8px;
  }
  :host([data-access]) .access-selection-options[open] {
    grid-column: 1/-1;
  }
  :host([data-access]) .user-result-bar {
    grid-column: 1;
    font-size: 12px;
    color: var(--secondary-text-color);
    margin-bottom: 8px;
  }
  :host([data-access]) .access-people-workspace {
    grid-column: 1/-1;
  }
  :host([data-access]) .access-people-table table {
    width: 100%;
    min-width: 680px;
  }
  :host([data-access]) .access-people-table tr[aria-selected="true"] {
    background: var(--access-tint);
  }
  :host([data-access]) .access-people-table td {
    padding: 7px 10px;
    height: 54px;
    font-size: 13px;
  }
  :host([data-access]) .access-person-identity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 140px;
  }
  :host([data-access]) .access-person-identity .person-avatar {
    display: grid;
    place-items: center;
    border-radius: 50%;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    font-size: 12px;
    background: var(--access-tint);
    color: var(--primary-color);
  }
  :host([data-access]) .access-person-identity .user-detail-link {
    font-size: 15px;
    min-height: 24px;
    padding: 0;
    white-space: nowrap;
  }
  :host([data-access]) .access-person-id {
    display: block;
    font-size: 11px;
    color: var(--secondary-text-color);
  }
  :host([data-access]) .access-select-cell {
    width: 28px;
    padding: 6px;
  }
  :host([data-access]) .access-people-table .phone-cell {
    min-width: 128px;
    font-size: 13px;
  }
  :host([data-access]) .access-profile-col,
  :host([data-access]) .access-groups-col {
    min-width: 80px;
  }
  :host([data-access]) .access-person-state {
    white-space: nowrap;
  }
  :host([data-access]) .access-person-state > .sub {
    display: block;
    margin: 3px 0 0;
    font-size: 11px;
  }
  :host([data-access]) .access-person-actions .user-action-group {
    display: flex;
    gap: 6px;
    flex-wrap: nowrap;
  }
  :host([data-access]) .access-person-actions button {
    min-height: 30px;
    padding: 4px 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .access-user-options > summary,
  .access-selection-options > summary {
    display: none;
  }
  :host([data-access]) .access-user-options > summary,
  :host([data-access]) .access-selection-options > summary {
    display: list-item;
  }
  :host([data-access]) .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    overflow: hidden;
  }
  @container intercom-panel (max-width: 1200px) {
    :host([data-access]) .access-dashboard {
      grid-template-columns: minmax(0, 1fr) 260px;
      gap: 12px;
    }
    :host([data-access]) .access-doors {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    :host([data-access]) main {
      padding: 14px;
    }
  }
  @container intercom-panel (max-width: 1099px) {
    :host([data-access]) .access-people-workspace {
      grid-template-columns: minmax(0, 1fr);
    }
    :host([data-access]) .access-person-inspector {
      display: none;
    }
    :host([data-access]) .head .nav {
      margin-inline: 8px auto;
    }
    :host([data-access]) .head .nav button {
      padding: 6px 9px;
    }
  }
  @container intercom-panel (max-width: 850px) {
    :host([data-access]) .access-dashboard {
      grid-template-columns: 1fr;
    }
    :host([data-access]) .access-context {
      grid-template-columns: 1fr 1fr;
    }
    :host([data-access]) .access-doors {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    :host([data-access]) .access-page-heading {
      gap: 12px;
      flex-wrap: wrap;
    }
    :host([data-access]) .access-page-heading hikvision-live-clock {
      font-size: 11px;
    }
    :host([data-access]) .head {
      padding: 6px 12px;
      min-height: 54px;
    }
    :host([data-access]) .head .nav {
      position: fixed;
      inset-block-end: 0;
      inset-inline: 0;
      margin: 0;
      width: 100%;
      min-height: 62px;
      padding-bottom: env(safe-area-inset-bottom);
      background: var(--card-background-color);
      border-top: 1px solid var(--divider-color);
      z-index: 5;
    }
    :host([data-access]) .head .nav .nav-primary {
      width: 100%;
      display: flex;
    }
    :host([data-access]) .head .nav button {
      flex: 1;
      color: var(--secondary-text-color);
      flex-direction: column;
      gap: 3px;
      padding: 7px 2px;
      font-size: 11px;
      min-height: 58px;
      border-radius: 0;
    }
    :host([data-access]) .head .nav button[aria-current="page"] {
      color: var(--primary-color);
      background: var(--access-tint);
    }
    :host([data-access]) .head .spacer {
      flex: 1;
    }
    :host([data-access]) main {
      padding-bottom: calc(82px + env(safe-area-inset-bottom));
    }
    :host([data-access]) button {
      min-height: 44px;
    }
    :host([data-access]) .access-user-options > summary,
    :host([data-access]) .access-selection-options > summary {
      min-height: 44px;
    }
    :host([data-access]) .access-door-heading {
      min-height: 44px;
    }
    :host([data-access]) .access-door-actions button {
      min-height: 40px;
    }
    :host([data-access]) .users-page {
      grid-template-columns: 1fr;
    }
    :host([data-access]) .users-tools {
      flex-wrap: wrap;
    }
    :host([data-access]) .users-tools input {
      max-width: none;
      flex-basis: 100%;
    }
    :host([data-access]) .access-user-options {
      grid-column: 1;
      grid-row: auto;
    }
    :host([data-access]) .access-selection-options {
      grid-column: 1;
    }
    :host([data-access]) .access-activity-row {
      grid-template-columns: 22px 1fr 1fr;
    }
    :host([data-access]) .access-activity-row > .sub {
      display: none;
    }
    :host([data-access]) .access-activity-row time {
      grid-column: 2/-1;
    }
    :host([data-access]) .editor-dialog {
      width: calc(100vw - 16px);
      max-height: calc(100dvh - 16px);
    }
    :host([data-access]) .dialog-foot {
      position: sticky;
      bottom: 0;
      z-index: 2;
      gap: 6px;
      padding: 10px;
    }
    :host([data-access]) .dialog-foot button {
      flex: 1;
      padding: 6px;
      font-size: 13px;
    }
    :host([data-access]) .dialog-head,
    :host([data-access]) .dialog-body {
      padding: 12px;
    }
  }
  @container intercom-panel (max-width: 600px) {
    :host([data-access]) main {
      padding: 12px 10px 82px;
    }
    :host([data-access]) h2 {
      font-size: 21px;
    }
    :host([data-access]) .access-inline-stats {
      font-size: 11px;
      gap: 10px;
    }
    :host([data-access]) .access-page-heading {
      margin-bottom: 12px;
    }
    :host([data-access]) .access-page-heading > div:first-child {
      flex-basis: 100%;
    }
    :host([data-access]) .access-eyebrow {
      display: none;
    }
    :host([data-access]) .access-doors {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    :host([data-access]) .access-door {
      padding: 8px;
    }
    :host([data-access]) .access-door-heading {
      flex-wrap: wrap;
      align-content: start;
      gap: 2px;
      min-height: 50px;
    }
    :host([data-access]) .access-door-heading strong {
      width: 100%;
      font-size: 14px;
    }
    :host([data-access]) .access-door-camera {
      width: 52px;
      flex-basis: 52px;
      height: 40px;
    }
    :host([data-access]) .access-door-body {
      gap: 6px;
    }
    :host([data-access]) .access-door-context {
      font-size: 11px;
    }
    :host([data-access]) .access-context {
      grid-template-columns: 1fr;
    }
    :host([data-access]) .access-person-inspector {
      display: none;
    }
    :host([data-access]) .access-people-table {
      border: 0;
      background: transparent;
      overflow: visible;
    }
    :host([data-access]) .access-people-table table,
    :host([data-access]) .access-people-table tbody {
      display: block;
      min-width: 0;
    }
    :host([data-access]) .access-people-table thead {
      display: none;
    }
    :host([data-access]) .access-people-table tr {
      display: grid;
      grid-template-columns: 26px 1fr auto;
      position: relative;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      margin-bottom: 6px;
      padding: 8px;
      background: var(--card-background-color);
    }
    :host([data-access]) .access-people-table td {
      display: block;
      padding: 0;
      height: auto;
      min-width: 0;
      border: 0;
    }
    :host([data-access]) .access-people-table .access-select-cell {
      grid-column: 1;
      grid-row: 1/3;
      align-self: center;
    }
    :host([data-access]) .access-people-table td:nth-child(2) {
      grid-column: 2;
      grid-row: 1;
    }
    :host([data-access]) .access-people-table .phone-cell {
      grid-column: 2;
      grid-row: 2;
      margin-inline-start: 42px;
      font-size: 12px;
    }
    :host([data-access]) .access-people-table .access-person-state {
      grid-column: 3;
      grid-row: 1/3;
      text-align: end;
    }
    :host([data-access]) .access-people-table .access-person-actions {
      grid-column: 2/-1;
      margin-top: 8px;
    }
    :host([data-access]) .access-person-actions button {
      min-height: 44px;
    }
    :host([data-access]) .access-profile-col,
    :host([data-access]) .access-groups-col,
    :host([data-access]) .access-rights-cell,
    :host([data-access]) .access-person-id {
      display: none !important;
    }
    :host([data-access]) .access-person-identity .user-detail-link {
      white-space: normal;
      min-height: 36px;
    }
    :host([data-access]) .sync-filters {
      flex-wrap: wrap;
    }
    :host([data-access]) .tools-grid {
      grid-template-columns: 1fr;
    }
  }

  .access-users-header {
    display: contents;
  }
  :host([data-access]) .users-page {
    grid-template-columns: 1fr auto auto;
    gap: 0 8px;
  }
  :host([data-access]) .access-users-header {
    grid-column: 1/-1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    margin-bottom: 10px;
  }
  :host([data-access]) .users-heading {
    display: contents;
  }
  :host([data-access]) .users-heading > div {
    grid-column: 1;
    grid-row: 1;
  }
  :host([data-access]) .users-heading > button {
    grid-column: 3;
    grid-row: 1;
  }
  :host([data-access]) .users-tools {
    grid-column: 2;
    grid-row: 1;
    margin: 0;
  }
  :host([data-access]) .users-tools input {
    max-width: none;
  }
  :host([data-access]) .access-user-options {
    grid-column: 2;
    grid-row: 2;
  }
  :host([data-access]) .access-selection-options {
    grid-column: 3;
    grid-row: 2;
  }
  :host([data-access]) .access-user-options[open],
  :host([data-access]) .access-selection-options[open] {
    grid-column: 1/-1;
    grid-row: auto;
  }
  :host([data-access]) .access-selection-options > summary,
  :host([data-access]) .access-user-options > summary {
    min-height: 28px;
    padding: 4px 8px;
  }
  :host([data-access]) .user-result-bar {
    grid-row: 2;
  }
  :host([data-access]) .access-people-table th {
    padding-block: 7px;
  }
  :host([data-access]) .device-selector {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  :host([data-access]) .device-extra > summary,
  :host([data-access]) .device-information > summary {
    display: list-item;
  }
  :host([data-access]) .station-settings-heading {
    position: static;
    border: 0;
    margin-bottom: 10px;
  }
  :host([data-access]) .station-settings-heading h3 {
    font-size: 21px;
  }
  :host([data-access]) .station-settings-columns {
    gap: 12px;
  }
  :host([data-access]) .station-settings-card {
    padding: 14px;
    border-radius: 8px;
  }
  :host([data-access]) .station-settings-symbol {
    margin-bottom: 12px;
  }
  :host([data-access]) .station-settings-symbol svg {
    width: 32px;
    height: 32px;
  }
  :host([data-access]) .station-tabs {
    gap: 4px;
    padding-block: 0 10px;
    margin-bottom: 14px;
  }
  :host([data-access]) .station-tabs button {
    background: transparent;
    border-color: transparent;
    color: var(--secondary-text-color);
    font-size: 13px;
  }
  :host([data-access]) .station-tabs button[aria-current="page"] {
    background: var(--access-tint);
    color: var(--primary-color);
  }
  :host([data-access]) .station-config {
    padding: 16px;
  }
  :host([data-access]) .station-relay {
    padding: 10px;
    margin-bottom: 10px;
  }
  :host([data-access]) .station-relay p {
    margin-block: 6px;
  }
  :host([data-access]) .station-config dl {
    gap: 10px;
    font-size: 13px;
  }
  :host([data-access]) #user-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
  :host([data-access]) .editor-person-column {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  :host([data-access]) .editor-person-column fieldset {
    margin: 0 !important;
  }
  :host([data-access]) .editor-assignments .assignment-list {
    grid-template-columns: 1fr;
  }
  :host([data-access]) .assignment {
    padding: 10px;
    border-radius: 7px;
  }
  @container intercom-panel (max-width: 850px) {
    :host([data-access]) .access-users-header {
      grid-template-columns: 1fr auto;
      gap: 8px;
    }
    :host([data-access]) .users-heading > button {
      grid-column: 2;
    }
    :host([data-access]) .users-tools {
      grid-column: 1/-1;
      grid-row: 2;
    }
    :host([data-access]) .users-page {
      grid-template-columns: 1fr auto;
    }
    :host([data-access]) .access-selection-options {
      grid-column: 2;
      grid-row: 3;
    }
    :host([data-access]) .access-user-options {
      grid-column: 1;
      grid-row: 3;
    }
    :host([data-access]) .user-result-bar {
      grid-column: 1/-1;
    }
    :host([data-access]) .access-selection-options > summary,
    :host([data-access]) .access-user-options > summary {
      min-height: 44px;
      padding: 10px 8px;
    }
    :host([data-access]) #user-form {
      grid-template-columns: minmax(0, 1fr);
    }
    :host([data-access]) .station-tabs button {
      min-height: 44px;
    }
  }

  .access-transfer-tools,
  .access-transfer-list {
    display: contents;
  }
  .access-transfer-tools > summary {
    display: none;
  }
  :host([data-access]) main {
    padding-block-start: 12px;
  }
  :host([data-access]) .access-transfer-tools {
    display: block;
    position: relative;
    flex: 0 0 auto;
  }
  :host([data-access]) .access-transfer-tools > summary {
    display: list-item;
    min-height: 36px;
    padding: 7px 10px;
    border: 1px solid var(--divider-color);
    border-radius: 7px;
    background: var(--card-background-color);
    cursor: pointer;
    font-size: 12px;
  }
  :host([data-access]) .access-transfer-tools:not([open]) > .access-transfer-list {
    display: none;
  }
  :host([data-access]) .access-transfer-tools[open] > .access-transfer-list {
    position: absolute;
    z-index: 4;
    inset-inline-end: 0;
    top: calc(100% + 6px);
    display: grid;
    gap: 6px;
    min-width: 210px;
    padding: 8px;
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
    box-shadow: 0 6px 20px #0002;
    border-radius: 9px;
  }
  :host([data-access]) .access-transfer-list button {
    width: 100%;
    text-align: start;
    justify-content: flex-start;
  }
  :host([data-access]) .access-people-table td {
    padding-block: 4px;
  }
  :host([data-access]) .access-people-table th {
    padding-block: 5px;
  }
  :host([data-access]) .app-shell[data-view="devices"] main {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  :host([data-access]) .app-shell[data-view="devices"] .tools-back {
    align-self: flex-start;
  }
  :host([data-access]) .app-shell[data-view="devices"] main > .toolbar {
    margin: 0 0 10px;
    padding: 0;
    border: 0;
    background: transparent;
  }
  :host([data-access]) .app-shell[data-view="devices"] .device-selector {
    margin: 0 0 12px;
    padding: 0;
    flex-direction: row;
    width: min(100%, 440px);
  }
  :host([data-access]) .app-shell[data-view="devices"] .device-selector select {
    margin: 0;
  }
  @container intercom-panel (max-width: 850px) {
    :host([data-access]) .head .nav {
      top: auto;
      bottom: 0;
      max-height: none;
      height: calc(62px + env(safe-area-inset-bottom));
    }
    :host([data-access]) .users-tools {
      flex-wrap: nowrap;
    }
    :host([data-access]) .users-tools input {
      flex: 1 1 auto;
      min-width: 0;
      width: 100%;
    }
    :host([data-access]) .access-transfer-tools > summary {
      min-height: 44px;
      padding: 10px;
    }
    :host([data-access]) .access-users-header {
      margin-bottom: 6px;
    }
    :host([data-access]) .access-people-table td {
      padding-block: 0;
    }
  }
`;
