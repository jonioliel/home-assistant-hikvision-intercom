import { css } from "lit";
export const interfaceStyles = css`
  :host {
    --panel-radius: 18px;
    line-height: 1.45;
  }
  .ui-icon {
    flex: 0 0 auto;
    vertical-align: middle;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-weight: 600;
  }
  .app-shell {
    display: grid;
    grid-template-columns: 208px minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    min-height: 100%;
  }
  .app-shell > header {
    display: contents;
  }
  .head {
    grid-column: 1 / -1;
    max-width: none;
    width: 100%;
    box-sizing: border-box;
    padding: 18px 26px;
    margin: 0;
    background: var(--surface);
    border-block-end: 1px solid var(--divider-color);
  }
  .head h1 {
    font-size: 19px;
    letter-spacing: -0.35px;
  }
  .head .brand {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    color: var(--text-primary-color, #fff);
    background: var(--accent);
  }
  .head .version {
    margin-top: 2px;
    font-size: 11px;
  }
  .head .quiet {
    border: 0;
    padding: 8px;
  }
  .nav {
    grid-column: 1;
    align-self: start;
    position: sticky;
    top: 0;
    width: 100%;
    max-width: none;
    display: flex;
    flex-direction: column;
    gap: 26px;
    padding: 26px 14px;
    margin: 0;
    box-sizing: border-box;
    overflow: auto;
    max-height: 100dvh;
  }
  .nav-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .nav-label {
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    padding: 0 12px 7px;
    letter-spacing: 0.04em;
  }
  .nav button {
    display: flex;
    justify-content: flex-start;
    gap: 12px;
    min-height: 44px;
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    font-size: 13px;
    text-align: start;
    white-space: normal;
  }
  .nav button[aria-current="page"] {
    background: color-mix(in srgb, var(--accent) 11%, transparent);
    color: var(--accent);
  }
  .nav button:hover {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  main {
    grid-column: 2;
    width: 100%;
    max-width: 1500px;
    min-width: 0;
    margin: 0 auto;
    padding: 30px 32px 48px;
  }
  .page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin: 0 0 22px;
  }
  .page-heading h2 {
    margin: 0;
    font-size: 28px;
    line-height: 1.25;
    letter-spacing: -0.6px;
  }
  .page-heading p {
    margin: 7px 0 0;
  }
  .metrics {
    gap: 0;
    border: 1px solid var(--divider-color);
    border-radius: 14px;
    overflow: hidden;
    margin-bottom: 26px;
    background: var(--surface);
  }
  .metric {
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 16px 18px;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .metric + .metric {
    border-inline-start: 1px solid var(--divider-color);
  }
  .metric .metric-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: var(--accent);
  }
  .metric strong {
    font-size: 22px;
    letter-spacing: -0.4px;
  }
  .metric span {
    font-size: 11px;
  }
  .grid {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 285px), 1fr));
    gap: 22px;
    align-items: start;
  }
  .station {
    padding: 0;
    border-radius: var(--panel-radius);
    background: var(--surface);
    overflow: hidden;
    box-shadow: 0 3px 12px #00000004;
  }
  .station.ringing {
    outline: 2px solid var(--accent);
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 9%, transparent);
  }
  .station-head {
    padding: 16px 18px;
    gap: 8px;
  }
  .station-head h3 {
    font-size: 17px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .station .camera-wrap {
    margin: 0;
    background: var(--secondary-background-color, #eef2f4);
  }
  .station .camera-wrap hikvision-intercom-camera {
    border-radius: 0;
  }
  .station .camera-wrap > button {
    inset-inline-end: 12px;
    bottom: 12px;
    border-radius: 9px;
    padding: 8px 12px;
  }
  .station-content {
    padding: 16px 18px 18px;
  }
  .station .ring-banner {
    border-radius: 0;
    margin: 0;
    padding: 8px 18px;
    font-size: 13px;
  }
  .station .door-action {
    margin: 0 0 14px;
  }
  .door-action button {
    width: 100%;
    min-height: 46px;
    border-radius: 11px;
  }
  .station .station-state {
    padding-bottom: 12px;
    font-size: 12px;
  }
  .station-state .status {
    font-size: 11px;
    padding: 4px 8px;
  }
  .station .last-access {
    border: 0;
    background: var(--primary-background-color);
    border-radius: 10px;
    padding: 11px 12px;
    margin: 10px 0 0;
  }
  .last-access > div:not(.sub) {
    font-weight: 600;
    margin-top: 4px;
    font-size: 14px;
  }
  .last-access .sub {
    font-size: 11px;
    line-height: 1.55;
  }
  .station .pending-users {
    margin: 10px 0 0;
    font-size: 11px;
  }
  .station .last-seen {
    margin-bottom: 0;
    font-size: 11px;
  }
  .status.online,
  .status.synced {
    color: color-mix(in srgb, var(--success-color, #167757) 45%, var(--ink));
    background: color-mix(in srgb, var(--success-color, #167757) 9%, var(--surface));
  }
  .status.error,
  .status.conflict,
  .status.offline {
    color: color-mix(in srgb, var(--error-color, #b84246) 45%, var(--ink));
  }
  .status.online::before,
  .status.offline::before {
    content: "";
    width: 5px;
    height: 5px;
    background: currentColor;
    border-radius: 50%;
  }
  .editor-dialog {
    width: min(1020px, calc(100vw - 40px));
  }
  .editor-dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .editor-dialog .dialog-head,
  .editor-dialog .dialog-foot {
    flex-shrink: 0;
  }
  .editor-dialog .dialog-head {
    padding: 20px 28px;
  }
  .editor-dialog .dialog-head h2 {
    font-size: 22px;
  }
  .editor-dialog .dialog-body {
    background: var(--primary-background-color);
    padding: 24px;
    min-height: 0;
    max-height: none;
    flex: 1 1 auto;
  }
  .editor-dialog .dialog-foot {
    padding: 16px 24px;
    background: var(--surface);
  }
  .editor-summary {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 20px;
  }
  .editor-summary .avatar {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border: 1px solid var(--divider-color);
    border-radius: 14px;
    background: var(--surface);
    color: var(--accent);
  }
  .editor-summary strong {
    display: block;
    font-size: 16px;
  }
  .editor-summary p {
    margin: 4px 0 0;
  }
  #user-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  #user-form > .field-note {
    grid-column: 1 / -1;
    margin: 0;
  }
  #user-form fieldset {
    min-width: 0;
    margin: 0;
    padding: 20px;
    background: var(--surface);
    border: 1px solid var(--divider-color);
    border-radius: 14px;
  }
  #user-form legend {
    float: inline-start;
    margin: 0 0 16px;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 9px;
  }
  #user-form legend + * {
    clear: both;
  }
  #user-form .editor-assignments {
    grid-column: 1 / -1;
  }
  #user-form .editor-assignments .assignment-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  #user-form .assignment {
    margin: 0;
    background: var(--primary-background-color);
    border-color: transparent;
  }
  #user-form .field-note {
    font-size: 11px;
  }
  .editor-summary + #user-form {
    margin-top: 0;
  }
  @media (min-width: 1600px) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 1100px) {
    .metric .metric-icon {
      display: none;
    }
    .metric {
      padding: 13px;
    }
    main {
      padding: 24px;
    }
    .app-shell {
      grid-template-columns: 182px minmax(0, 1fr);
    }
  }
  @media (max-width: 900px) {
    .app-shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto 1fr;
    }
    .head {
      padding: 14px 18px;
    }
    .head h1 {
      font-size: 17px;
    }
    .nav {
      grid-column: 1;
      position: static;
      flex-direction: column;
      gap: 0;
      padding: 0 14px 8px;
      background: var(--surface);
      border-bottom: 1px solid var(--divider-color);
      max-height: none;
    }
    .nav-group {
      flex-direction: row;
      gap: 4px;
      min-width: 0;
      overflow-x: auto;
    }
    .nav-label {
      display: none;
    }
    .nav button {
      flex-shrink: 0;
      min-height: 40px;
      padding: 8px 10px;
      font-size: 12px;
      white-space: nowrap;
      gap: 6px;
    }
    .nav .nav-primary button {
      flex: 1;
      justify-content: center;
    }
    .nav .nav-secondary {
      margin-top: 3px;
    }
    .nav .nav-secondary button {
      min-height: 34px;
      font-size: 11px;
    }
    .nav .nav-secondary .ui-icon {
      width: 15px;
      height: 15px;
    }
    main {
      grid-column: 1;
      padding: 24px 18px;
    }
    .page-heading h2 {
      font-size: 24px;
    }
    .page-heading p {
      font-size: 12px;
    }
    #user-form {
      grid-template-columns: 1fr;
    }
    #user-form .editor-assignments .assignment-list {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 600px) {
    .head {
      padding: 12px 14px;
      gap: 8px;
    }
    .head .brand {
      display: none;
    }
    .head .version {
      font-size: 10px;
    }
    .head .refresh-label {
      display: none;
    }
    main {
      padding: 22px 14px;
    }
    .page-heading {
      margin-bottom: 18px;
    }
    .page-heading h2 {
      font-size: 23px;
    }
    .metrics {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-bottom: 22px;
    }
    .metric {
      padding: 12px 5px;
      text-align: center;
      justify-content: center;
    }
    .metric strong {
      font-size: 19px;
    }
    .metric span {
      font-size: 10px;
      line-height: 1.35;
      display: block;
      overflow-wrap: anywhere;
    }
    .station-head {
      padding: 14px 16px;
    }
    .station-content {
      padding: 14px 16px 16px;
    }
    .editor-dialog {
      width: calc(100vw - 16px);
      max-height: 96dvh;
    }
    .editor-dialog .dialog-head {
      padding: 16px;
    }
    .editor-dialog .dialog-body {
      padding: 16px 12px;
    }
    .editor-dialog .dialog-foot {
      padding: 12px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .editor-dialog .dialog-foot button {
      flex: 1 1 auto;
    }
    #user-form fieldset {
      padding: 17px;
    }
    .editor-summary {
      padding-inline: 5px;
    }
  }
`;
