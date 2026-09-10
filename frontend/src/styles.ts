import { css } from "lit";
export const styles = css`
  .release-feedback {
    margin-block-start: 12px;
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .release-feedback p {
    margin: 4px 0 0;
  }

  .clock-details,
  .capability-details {
    border-block-start: 1px solid var(--divider-color, #dce5e6);
    margin-block: 16px;
    overflow-wrap: anywhere;
  }
  .capability-list {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .capability-list li {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  .capability-details h4 {
    margin-block: 16px 8px;
  }
  .assignment-tools {
    margin-block-end: 12px;
  }
  .last-access {
    margin-block-start: 14px;
    padding-block-start: 12px;
    border-top: 1px solid var(--divider-color, #dce5e6);
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .audit-list {
    display: grid;
    gap: 12px;
    margin-block: 20px;
  }
  .audit-row {
    padding: 16px;
    overflow-wrap: anywhere;
  }
  :host {
    --accent: var(--primary-color, #087e83);
    --surface: var(--card-background-color, #fff);
    --ink: var(--primary-text-color, #173338);
    --muted: var(--secondary-text-color, #667b80);
    display: block;
    height: 100%;
    color: var(--ink);
    background: var(--primary-background-color, #f3f6f6);
    font-family: var(--paper-font-body1_-_font-family, Arial, sans-serif);
    font-size: 15px;
    overflow: auto;
  }
  * {
    box-sizing: border-box;
  }
  button,
  input,
  select {
    font: inherit;
  }
  button,
  a {
    touch-action: manipulation;
  }
  button {
    border: 1px solid var(--divider-color, #dce5e6);
    background: var(--surface);
    color: var(--ink);
    border-radius: 9px;
    padding: 10px 14px;
    cursor: pointer;
    min-height: var(--hik-control-height, 42px);
  }
  button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  button:focus-visible,
  a:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  button:disabled {
    opacity: 0.48;
    cursor: default;
  }
  .primary {
    background: var(--accent);
    color: var(--text-primary-color, #fff);
    border-color: var(--accent);
  }
  .primary:hover:not(:disabled) {
    color: var(--text-primary-color, #fff);
    filter: brightness(0.94);
  }
  .danger {
    color: var(--error-color, #c83f48);
  }
  .quiet {
    border-color: transparent;
    background: transparent;
  }
  a {
    color: var(--accent);
    text-decoration: none;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--surface);
    border-bottom: 1px solid var(--divider-color, #dce5e6);
  }
  .head {
    max-width: 1320px;
    margin: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 20px 28px;
  }
  .brand {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    border-radius: 11px;
  }
  .head h1 {
    font-size: 22px;
    margin: 0;
    letter-spacing: -0.5px;
  }
  .version {
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }
  .head .spacer {
    flex: 1;
  }
  .nav {
    max-width: 1320px;
    margin: auto;
    display: flex;
    gap: 12px;
    padding: 0 28px;
    overflow: auto;
  }
  .nav button {
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 0;
    padding: 14px 17px;
    white-space: nowrap;
    color: var(--muted);
    background: transparent;
  }
  .nav button[aria-current="page"] {
    border-bottom-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  main {
    max-width: 1320px;
    margin: auto;
    padding: 28px;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 26px;
  }
  .metric {
    padding: 20px;
    background: var(--surface);
    border: 1px solid var(--divider-color, #dce5e6);
    border-radius: var(--hik-radius, 14px);
  }
  .metric strong {
    font-size: 32px;
    display: block;
    line-height: 1.3;
    letter-spacing: -1px;
  }
  .metric span {
    font-size: 13px;
    color: var(--muted);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 22px;
  }
  .toolbar h2 {
    font-size: 22px;
    margin: 0;
    flex: 1;
  }
  .toolbar input {
    flex: 1;
    min-width: 180px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
    gap: 20px;
  }
  .station,
  .person,
  .box {
    padding: 20px;
    border: 1px solid var(--divider-color, #dce5e6);
    border-radius: 15px;
    background: var(--surface);
  }
  .station.ringing {
    outline: 3px solid var(--accent);
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 9%, transparent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .row.between {
    justify-content: space-between;
  }
  .row h3 {
    font-size: 18px;
    margin: 0;
  }
  .row.actions {
    margin-top: 14px;
  }
  .station .camera-wrap {
    margin: 16px 0;
    position: relative;
  }
  .camera-wrap > button {
    position: absolute;
    inset-inline-end: 8px;
    bottom: 8px;
    background: #172a2ddd;
    color: white;
    border: 1px solid #ffffff77;
    min-height: 34px;
    padding: 6px 10px;
    font-size: 12px;
  }
  .ring-banner {
    background: var(--accent);
    color: var(--text-primary-color, #fff);
    padding: 10px;
    border-radius: 8px;
    margin-top: 12px;
    font-weight: 700;
  }
  .station .actions button {
    flex: 1;
  }
  .sub {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .status {
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 20px;
    background: var(--secondary-background-color, #eef3f3);
    padding: 5px 9px;
    white-space: nowrap;
  }
  .status.synced,
  .status.online {
    color: #167757;
    background: #e5f4ed;
  }
  .status.ringing,
  .status.syncing {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }
  .status.error,
  .status.conflict,
  .status.offline {
    color: var(--error-color, #b84246);
    background: color-mix(in srgb, var(--error-color, #b84246) 9%, var(--surface));
  }
  .empty {
    min-height: 260px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 32px;
    border: 1px dashed var(--divider-color, #b9cbce);
    border-radius: 16px;
  }
  .empty h2 {
    margin: 0;
    font-size: 21px;
  }
  .empty p {
    max-width: 560px;
    color: var(--muted);
    line-height: 1.6;
    margin: 0;
  }
  .notice {
    padding: 13px 16px;
    margin-bottom: 20px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .notice.error {
    background: color-mix(in srgb, var(--error-color, #b84246) 10%, var(--surface));
  }
  .notice span {
    flex: 1;
  }
  .notice button {
    padding: 0 7px;
    min-height: 30px;
    border: none;
    background: none;
  }
  .table-wrap {
    overflow: auto;
    border: 1px solid var(--divider-color, #dce5e6);
    border-radius: 13px;
    background: var(--surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: start;
  }
  th,
  td {
    padding: 15px 16px;
    border-bottom: 1px solid var(--divider-color, #e6eded);
    text-align: start;
    font-size: 14px;
  }
  th {
    font-size: 12px;
    color: var(--muted);
    background: var(--secondary-background-color, #f6f8f8);
  }
  tr:last-child td {
    border-bottom: 0;
  }
  td .row {
    flex-wrap: nowrap;
  }
  td button {
    font-size: 12px;
    padding: 6px 10px;
    min-height: 34px;
  }
  .mobile-users {
    display: none;
  }
  .person h3 {
    margin: 0 0 6px;
  }
  .person p {
    margin: 5px 0;
  }
  .matrix th:first-child {
    min-width: 150px;
  }
  .matrix td {
    min-width: 115px;
  }
  .matrix button {
    width: 100%;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr 1.5fr;
    gap: 10px;
    margin: 20px 0;
  }
  dt {
    color: var(--muted);
    font-size: 13px;
  }
  dd {
    margin: 0;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .section-title {
    font-size: 19px;
    margin: 28px 0 14px;
  }
  .removal {
    padding: 15px 0;
    border-bottom: 1px solid var(--divider-color, #dce5e6);
  }
  dialog {
    width: min(780px, calc(100vw - 32px));
    max-height: 90vh;
    border: 1px solid var(--divider-color, #dce5e6);
    background: var(--surface);
    color: var(--ink);
    border-radius: 17px;
    padding: 0;
    box-shadow: 0 24px 80px #0005;
  }
  .capture-dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .capture-dialog .dialog-body {
    min-height: 0;
    flex: 1 1 auto;
  }
  .capture-dialog .dialog-head,
  .capture-dialog .dialog-foot {
    flex-shrink: 0;
  }
  .capture-dialog .dialog-foot {
    flex-wrap: wrap;
  }
  dialog::backdrop {
    background: #102e3a88;
    backdrop-filter: blur(3px);
  }
  .dialog-head {
    padding: 22px 26px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--divider-color, #dce5e6);
  }
  .dialog-head h2 {
    font-size: 21px;
    margin: 0;
  }
  .dialog-body {
    padding: 24px 26px;
    overflow: auto;
    max-height: 66vh;
  }
  .dialog-foot {
    padding: 16px 26px;
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    border-top: 1px solid var(--divider-color, #dce5e6);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0 0 26px;
  }
  legend {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 14px;
    width: 100%;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 13px;
  }
  input,
  select {
    width: 100%;
    border: 1px solid var(--divider-color, #bbcdcf);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    padding: 11px 12px;
    min-height: 43px;
  }
  input:disabled {
    background: var(--secondary-background-color, #f2f5f5);
    opacity: 0.7;
  }
  input[type="checkbox"] {
    width: 18px;
    min-height: 18px;
    accent-color: var(--accent);
    margin: 0;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .field-note {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.5;
    margin: 8px 0;
  }
  .card-edit {
    border: 1px solid var(--divider-color, #dce5e6);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 10px;
  }
  .assignment {
    border: 1px solid var(--divider-color, #dce5e6);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 8px;
  }
  .assignment small {
    margin-inline-start: 28px;
    color: var(--muted);
    display: block;
    margin-top: 7px;
  }
  .card-edit .fields {
    margin-bottom: 10px;
  }
  .import-row {
    border-bottom: 1px solid var(--divider-color, #dce5e6);
    padding: 17px 0;
  }
  .import-row h3 {
    margin: 0;
  }
  .review-field {
    padding: 12px;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    margin-block: 8px;
  }
  .review-field.changed {
    border-inline-start: 4px solid var(--warning-color, #e7a12c);
  }
  .review-field h3 {
    margin: 0;
    font-size: 14px;
  }
  .review-values {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-block-start: 8px;
  }
  .review-values > div {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .review-plan {
    padding: 12px;
    background: var(--secondary-background-color);
    border-radius: 10px;
  }
  @container intercom-panel (max-width: 480px) {
    .review-values {
      grid-template-columns: 1fr;
    }
  }
  .comparison {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
  }
  .comparison > div {
    background: var(--secondary-background-color, #f3f6f6);
    border-radius: 12px;
    padding: 16px;
  }
  .comparison h3 {
    margin: 0 0 15px;
    font-size: 15px;
  }
  .camera-dialog {
    width: min(1050px, calc(100vw - 24px));
  }
  .camera-dialog[open] {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 24px);
  }
  .camera-dialog .dialog-head,
  .camera-dialog .dialog-foot {
    flex-shrink: 0;
  }
  .camera-dialog .dialog-body {
    min-height: 0;
    max-height: none;
  }
  .camera-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
    gap: 20px;
    align-items: start;
  }
  .camera-video,
  .camera-controls {
    min-width: 0;
  }
  .camera-controls {
    max-block-size: max(80px, calc(100dvh - 280px));
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  .camera-video {
    position: sticky;
    top: 0;
  }
  .camera-video hikvision-intercom-camera {
    width: 100%;
  }
  @container intercom-panel (max-width: 850px) {
    .camera-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
    .camera-controls {
      max-block-size: none;
      overflow: visible;
      scrollbar-gutter: auto;
    }
    .camera-video {
      position: static;
    }
  }
  .loader {
    padding: 70px;
    text-align: center;
    color: var(--muted);
  }
  @container intercom-panel (max-width: 700px) {
    .head {
      padding: 15px 16px;
      gap: 10px;
    }
    .head h1 {
      font-size: 19px;
    }
    .head .refresh-label {
      display: none;
    }
    .nav {
      padding: 0 8px;
      gap: 0;
    }
    .nav button {
      padding: 13px 14px;
      font-size: 13px;
    }
    main {
      padding: 19px 14px;
    }
    .metrics {
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    .metric {
      padding: 14px;
    }
    .metric strong {
      font-size: 27px;
    }
    .metric span {
      font-size: 12px;
    }
    .grid {
      grid-template-columns: 1fr;
    }
    .station {
      padding: 16px;
    }
    .desktop-users {
      display: none;
    }
    .mobile-users {
      display: grid;
      gap: 12px;
    }
    .toolbar {
      gap: 8px;
    }
    .toolbar input {
      flex-basis: 100%;
    }
    .toolbar h2 {
      flex-basis: 100%;
    }
    .fields,
    .comparison {
      grid-template-columns: 1fr;
    }
    .dialog-head,
    .dialog-body {
      padding: 18px;
    }
    .dialog-body {
      max-height: 67vh;
    }
    .dialog-foot {
      padding: 14px 18px;
    }
    dialog {
      max-height: 94vh;
    }
    .brand {
      width: 34px;
      height: 34px;
    }
    .notice {
      font-size: 13px;
    }
    .matrix th,
    .matrix td {
      padding: 10px;
    }
    .card-edit .fields {
      gap: 10px;
    }
  }

  .custom-user-field {
    min-width: 7rem;
    max-width: 13rem;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .user-custom-details {
    display: grid;
    gap: 8px;
    margin: 10px 0;
  }
  .user-custom-details > div {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .user-custom-details dt {
    color: var(--secondary-text-color);
  }
  .user-custom-details dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .group-door-options {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .group-door-options .check {
    margin: 8px 0;
  }
  .permission-source {
    overflow-wrap: anywhere;
  }
  .permission-reset {
    max-width: 100%;
    white-space: normal;
  }
`;
