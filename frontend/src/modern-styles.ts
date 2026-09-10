import { css } from "lit";
export const modernStyles = css`
  :host {
    container: intercom-panel / inline-size;
    min-width: 0;
  }
  main {
    container: intercom-content / inline-size;
  }
  .overview-header {
    display: contents;
  }
  .metric .metric-label-short {
    display: none;
  }
  .nav .nav-more,
  .nav-appearance,
  .person-avatar,
  .device-selector,
  .device-metrics {
    display: none;
  }
  .station-more > summary,
  .device-extra > summary,
  .device-information > summary,
  .user-more > summary {
    display: none;
  }
  .station-more,
  .device-extra,
  .device-information,
  .user-more {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .user-action-group,
  .user-more-body {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .user-more {
    display: contents;
  }
  .station-settings {
    margin-top: 10px;
  }
  dialog {
    max-width: calc(100cqw - 16px);
  }
  .editor-person-column {
    display: contents;
  }
  .dialog-head h2 {
    flex: 1;
    min-width: 0;
  }
  .appearance-button {
    flex-shrink: 0;
    min-height: 44px;
  }
  .device-station[hidden] {
    display: none;
  }
  :host([data-appearance="modern"]) {
    --primary-color: #086bdb;
    --primary-background-color: #f3f6fa;
    --card-background-color: #fff;
    --primary-text-color: #142133;
    --secondary-text-color: #53647b;
    --text-primary-color: #fff;
    --divider-color: #dce4ee;
    --hik-radius: 10px;
    --hik-control-height: 44px;
    --panel-radius: 10px;
    color-scheme: light;
  }
  :host([data-appearance="modern"][data-dark]) {
    --primary-color: #559fff;
    --primary-background-color: #101923;
    --card-background-color: #1c2835;
    --primary-text-color: #edf3fc;
    --secondary-text-color: #b0bfd2;
    --divider-color: #37465a;
    --text-primary-color: #081b34;
    color-scheme: dark;
  }
  :host([data-appearance="modern"]) .app-shell {
    direction: ltr;
    grid-template-columns: 184px minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    background: var(--primary-background-color);
  }
  :host([data-appearance="modern"]) .app-shell[dir="rtl"] > header > *,
  :host([data-appearance="modern"]) .app-shell[dir="rtl"] > main,
  :host([data-appearance="modern"]) .app-shell[dir="rtl"] > dialog {
    direction: rtl;
  }
  :host([data-appearance="modern"]) .head {
    grid-column: 2;
    grid-row: 1;
    padding: 16px 24px;
    gap: 12px;
    background: var(--surface);
  }
  :host([data-appearance="modern"]) .head h1 {
    font-size: 20px;
  }
  :host([data-appearance="modern"]) .head .brand {
    border-radius: 9px;
  }
  :host([data-appearance="modern"]) .nav {
    grid-row: 1 / 3;
    grid-column: 1;
    min-height: 100dvh;
    padding: 24px 10px;
    background: #1c2730;
    color: #edf3fc;
    border: 0;
    gap: 28px;
    flex-direction: column;
    position: sticky;
  }
  :host([data-appearance="modern"]) .nav-group {
    flex-direction: column;
    overflow: visible;
  }
  :host([data-appearance="modern"]) .nav-label {
    display: block;
    color: #b5c1ce;
    font-size: 11px;
  }
  :host([data-appearance="modern"]) .nav button {
    color: #edf3fc;
    background: transparent;
    font-size: 13px;
    min-height: 46px;
    justify-content: flex-start;
    padding: 10px;
    white-space: normal;
  }
  :host([data-appearance="modern"]) .nav button:hover {
    background: #ffffff12;
  }
  :host([data-appearance="modern"]) .nav button[aria-current="page"] {
    background: #1263ac;
    color: #fff;
    box-shadow: inset 3px 0 #60b3ff;
  }
  :host([data-appearance="modern"]) .nav .nav-appearance {
    display: block;
    margin-top: auto;
    border-top: 1px solid #475362;
    padding-top: 14px;
  }
  :host([data-appearance="modern"]) main {
    grid-column: 2;
    padding: 24px;
    max-width: 1900px;
  }
  :host([data-appearance="modern"]) .page-heading {
    margin-bottom: 18px;
  }
  :host([data-appearance="modern"]) .page-heading h2 {
    font-size: 27px;
  }
  :host([data-appearance="modern"]) .overview-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 12px 24px;
    margin-bottom: 20px;
  }
  :host([data-appearance="modern"]) .overview-header .page-heading {
    flex: 1 1 230px;
    margin: 0;
  }
  :host([data-appearance="modern"]) .overview-header .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-width: 100%;
    background: transparent;
    border: 0;
    overflow: visible;
    margin: 0;
  }
  :host([data-appearance="modern"]) .overview-header .metric {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 0;
    max-width: 100%;
    min-height: 34px;
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    background: var(--surface);
    padding: 6px 10px;
    gap: 6px;
    text-align: start;
    justify-content: start;
    line-height: 20px;
  }
  :host([data-appearance="modern"]) .overview-header .metric-copy {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 5px;
    min-width: 0;
  }
  :host([data-appearance="modern"]) .overview-header .metric strong {
    font-size: 14px;
    line-height: 20px;
    letter-spacing: normal;
    color: var(--accent);
    overflow-wrap: anywhere;
    max-width: 100%;
  }
  :host([data-appearance="modern"]) .overview-header .metric .metric-label-full {
    display: none;
  }
  :host([data-appearance="modern"]) .overview-header .metric .metric-label-short {
    display: inline;
    font-size: 12px;
    line-height: 20px;
    white-space: nowrap;
  }
  :host([data-appearance="modern"]) .overview-header .metric .metric-icon {
    display: inline-flex;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    background: transparent;
    color: var(--accent);
  }
  :host([data-appearance="modern"]) .overview-header .metric-icon .ui-icon {
    width: 16px;
    height: 16px;
  }
  :host([data-appearance="modern"]) .grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
    gap: 16px;
  }
  :host([data-appearance="modern"]) .station {
    border-radius: 10px;
    padding: 18px;
    box-shadow: 0 2px 5px #12233705;
  }
  :host([data-appearance="modern"]) .overview-station {
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  :host([data-appearance="modern"]) .station.ringing {
    border-color: #d32f4f;
    box-shadow: 0 0 0 1px #d32f4f;
  }
  :host([data-appearance="modern"]) .station .ring-banner {
    background: #c82d49;
    color: #fff;
  }
  :host([data-appearance="modern"]) .station-head {
    padding: 13px 14px;
    gap: 8px;
  }
  :host([data-appearance="modern"]) .station-head h3 {
    font-size: 16px;
  }
  :host([data-appearance="modern"]) .station-content {
    padding: 12px 14px 14px;
    display: flex;
    flex: 1;
    flex-direction: column;
  }
  :host([data-appearance="modern"]) .station-state {
    margin: 10px 0 0;
  }
  :host([data-appearance="modern"]) .camera-wrap > button {
    padding: 6px 10px;
    min-height: 44px;
    font-size: 12px;
  }
  :host([data-appearance="modern"]) .door-action > button {
    min-height: 44px;
    border-radius: 7px;
    font-size: 14px;
  }
  :host([data-appearance="modern"]) .ring-banner {
    padding: 7px 14px;
    font-size: 12px;
  }
  :host([data-appearance="modern"]) .station-more {
    margin-top: 12px;
    border-top: 1px solid var(--divider-color);
  }
  :host([data-appearance="modern"]) .station-more > summary,
  :host([data-appearance="modern"]) .device-extra > summary,
  :host([data-appearance="modern"]) .device-information > summary {
    display: list-item;
    padding: 13px 0;
    min-height: 44px;
    cursor: pointer;
    font-size: 13px;
    color: var(--ink);
  }
  :host([data-appearance="modern"]) .last-access {
    background: transparent;
    padding: 0;
    border: 0;
    margin: 8px 0;
  }
  :host([data-appearance="modern"]) .table-wrap,
  :host([data-appearance="modern"]) .person {
    border-radius: 10px;
  }
  :host([data-appearance="modern"]) .desktop-users th {
    padding: 13px 10px;
    font-size: 12px;
    background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  }
  :host([data-appearance="modern"]) .desktop-users td {
    padding: 12px 10px;
    font-size: 13px;
  }
  :host([data-appearance="modern"]) .desktop-users td:last-child {
    min-width: 145px;
    width: 160px;
  }
  :host([data-appearance="modern"]) .desktop-users td:nth-child(7) {
    max-width: 170px;
    font-size: 12px;
  }
  :host([data-appearance="modern"]) .person-name {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  :host([data-appearance="modern"]) .person-avatar {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    color: var(--accent);
    font-weight: 700;
    font-size: 13px;
  }
  :host([data-appearance="modern"]) .user-action-group {
    gap: 6px;
    align-items: start;
  }
  :host([data-appearance="modern"]) .user-more {
    display: block;
    max-width: 100%;
  }
  :host([data-appearance="modern"]) .user-more > summary {
    display: list-item;
    cursor: pointer;
    font-size: 12px;
    padding: 10px 6px;
    min-height: 44px;
    border-radius: 6px;
    color: var(--accent);
  }
  :host([data-appearance="modern"]) .user-more-body {
    display: grid;
    gap: 6px;
    padding: 6px 0;
  }
  :host([data-appearance="modern"]) .user-edit {
    min-height: 44px;
  }
  :host([data-appearance="modern"]) .user-more-body button {
    min-height: 44px;
    text-align: start;
  }
  :host([data-appearance="modern"]) .editor-dialog {
    border-radius: 12px;
    width: min(1100px, calc(100vw - 32px));
  }
  :host([data-appearance="modern"]) .editor-dialog .dialog-head {
    padding: 20px 24px;
  }
  :host([data-appearance="modern"]) .editor-dialog .dialog-body {
    padding: 20px 24px;
  }
  :host([data-appearance="modern"]) #user-form {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
  }
  :host([data-appearance="modern"]) #user-form {
    direction: ltr;
    align-items: start;
  }
  :host([data-appearance="modern"]) .app-shell[dir="rtl"] #user-form > * {
    direction: rtl;
  }
  :host([data-appearance="modern"]) .editor-person-column {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
    grid-column: 1;
  }
  :host([data-appearance="modern"]) #user-form fieldset {
    width: 100%;
    padding: 18px;
    border-radius: 10px;
    align-self: start;
  }
  :host([data-appearance="modern"]) #user-form .editor-person,
  :host([data-appearance="modern"]) #user-form .editor-validity,
  :host([data-appearance="modern"]) #user-form .editor-pin,
  :host([data-appearance="modern"]) #user-form .editor-cards {
    grid-column: 1;
  }
  :host([data-appearance="modern"]) #user-form .editor-assignments {
    grid-column: 2;
    grid-row: 2;
  }
  :host([data-appearance="modern"]) #user-form .editor-assignments .assignment-list {
    grid-template-columns: 1fr;
  }
  :host([data-appearance="modern"]) .assignment {
    padding: 10px;
    border-radius: 6px;
  }
  :host([data-appearance="modern"]) .assignment label.check {
    min-height: 44px;
  }
  :host([data-appearance="modern"]) .assignment small {
    margin-top: 3px;
    font-size: 11px;
  }
  :host([data-appearance="modern"]) .device-selector {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 0;
  }
  :host([data-appearance="modern"]) .device-selector select {
    max-width: 380px;
  }
  :host([data-appearance="modern"]) .device-grid {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    align-items: start;
  }
  :host([data-appearance="modern"]) .device-grid:has(.device-station[hidden]) {
    grid-template-columns: minmax(0, 1fr);
  }
  :host([data-appearance="modern"]) .device-station {
    container: intercom-station / inline-size;
    max-width: 1100px;
    width: 100%;
    justify-self: center;
  }
  :host([data-appearance="modern"]) .device-extra {
    border-top: 1px solid var(--divider-color);
  }
  :host([data-appearance="modern"]) .device-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-block: 16px;
  }
  :host([data-appearance="modern"]) .device-metrics > div {
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
  }
  :host([data-appearance="modern"]) .device-metrics strong {
    display: block;
    font-size: 24px;
    color: var(--accent);
  }
  @container intercom-station (min-width: 700px) {
    .device-information dl {
      grid-template-columns: minmax(100px, 0.7fr) minmax(0, 1fr) minmax(100px, 0.7fr) minmax(
          0,
          1fr
        );
      gap: 16px 20px;
    }
  }
  @container intercom-content (max-width: 1000px) {
    :host([data-appearance="modern"]) .desktop-users {
      display: none;
    }
    :host([data-appearance="modern"]) .mobile-users {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 310px), 1fr));
      gap: 14px;
    }
  }
  @container intercom-panel (max-width: 950px) {
    :host([data-appearance="modern"]) .app-shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto 1fr;
    }
    :host([data-appearance="modern"]) .head {
      grid-column: 1;
      grid-row: 1;
      padding: 14px 18px;
    }
    :host([data-appearance="modern"]) .nav {
      grid-column: 1;
      grid-row: 2;
      min-height: 0;
      max-height: none;
      position: static;
      padding: 6px 12px;
      gap: 8px;
    }
    :host([data-appearance="modern"]) .nav .nav-primary {
      flex-direction: row;
      grid-column: 1;
      grid-row: 1;
    }
    :host([data-appearance="modern"]) .nav .nav-primary button {
      flex: 1;
      justify-content: center;
    }
    :host([data-appearance="modern"]) .nav {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }
    :host([data-appearance="modern"]) .nav .nav-secondary {
      display: none;
      grid-column: 1 / -1;
      grid-row: 2;
    }
    :host([data-appearance="modern"]) .nav.expanded .nav-secondary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      border-top: 1px solid #475362;
      padding-top: 8px;
    }
    :host([data-appearance="modern"]) .nav .nav-more {
      grid-column: 2;
      grid-row: 1;
      display: flex;
    }
    :host([data-appearance="modern"]) .nav .nav-label,
    :host([data-appearance="modern"]) .nav .nav-appearance {
      display: none;
    }
    :host([data-appearance="modern"]) main {
      grid-column: 1;
      grid-row: 3;
      padding: 22px 18px;
    }
    :host([data-appearance="modern"]) #user-form {
      grid-template-columns: 1fr;
    }
    :host([data-appearance="modern"]) #user-form .editor-assignments {
      grid-column: 1;
      grid-row: auto;
    }
  }
  @container intercom-panel (max-width: 600px) {
    .head .appearance-button span,
    .dialog-head .appearance-button span {
      display: none;
    }
    .appearance-button {
      min-width: 44px;
    }
    .head .appearance-button {
      padding: 8px;
    }
    :host([data-appearance="modern"]) .head {
      padding: 12px;
      gap: 6px;
    }
    :host([data-appearance="modern"]) .head h1 {
      font-size: 16px;
    }
    :host([data-appearance="modern"]) .head .brand,
    :host([data-appearance="modern"]) .head .refresh-label {
      display: none;
    }
    :host([data-appearance="modern"]) main {
      padding: 20px 12px;
    }
    :host([data-appearance="modern"]) .nav {
      padding: 6px;
    }
    :host([data-appearance="modern"]) .nav button {
      font-size: 12px;
      padding: 8px 6px;
      gap: 5px;
    }
    :host([data-appearance="modern"]) .nav.expanded .nav-secondary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    :host([data-appearance="modern"]) .overview-header .metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      width: 100%;
      gap: 6px;
    }
    :host([data-appearance="modern"]) .overview-header .metric {
      padding-inline: 8px;
    }
    :host([data-appearance="modern"]) .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    :host([data-appearance="modern"]) .page-heading h2 {
      font-size: 24px;
    }
    :host([data-appearance="modern"]) .editor-dialog {
      width: calc(100vw - 16px);
      max-height: calc(100dvh - 16px);
    }
    :host([data-appearance="modern"]) .editor-dialog .dialog-head {
      padding: 14px;
      gap: 6px;
    }
    :host([data-appearance="modern"]) .editor-dialog .dialog-head h2 {
      font-size: 21px;
    }
    :host([data-appearance="modern"]) .editor-dialog .dialog-body {
      padding: 14px 12px;
    }
    :host([data-appearance="modern"]) #user-form fieldset {
      width: 100%;
      padding: 14px;
    }
    :host([data-appearance="modern"]) .device-selector {
      display: block;
    }
    :host([data-appearance="modern"]) .device-selector select {
      margin-top: 8px;
      max-width: none;
    }
    :host([data-appearance="modern"]) .device-metrics {
      gap: 6px;
    }
    :host([data-appearance="modern"]) .device-metrics > div {
      padding: 10px 6px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition: none !important;
      animation: none !important;
    }
  }
`;
