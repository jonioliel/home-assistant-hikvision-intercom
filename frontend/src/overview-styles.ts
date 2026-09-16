import { css } from "lit";

export const overviewStyles = css`
  :host(:fullscreen) {
    background: var(--primary-background-color, #f4f6fb);
    overflow: auto;
  }
  :host([data-appearance="modern"]) main:has(.overview-wall) {
    max-width: none;
    padding: 12px 20px;
  }
  .wall-toolbar {
    display: grid;
    gap: 10px;
    margin-bottom: 12px;
  }
  :host([data-appearance="modern"]) .wall-toolbar .overview-header {
    margin: 0;
    align-items: center;
    gap: 10px;
  }
  :host([data-appearance="modern"]) .wall-toolbar .page-heading {
    flex: 0 0 auto;
  }
  :host([data-appearance="modern"]) .wall-toolbar h2 {
    font-size: 23px;
    margin: 0;
  }
  :host([data-appearance="modern"]) .wall-toolbar .metric {
    font-size: 12px;
    min-height: 30px;
    padding: 3px 8px;
  }
  .wall-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .wall-controls input {
    width: 240px;
    min-width: 100px;
    flex: 1 1 160px;
    max-width: 360px;
  }
  .wall-controls label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .wall-controls select {
    width: auto;
    min-width: 82px;
  }
  .wall-controls button,
  .wall-controls input,
  .wall-controls select {
    min-height: 40px;
    padding: 6px 10px;
  }
  .wall-controls hikvision-live-clock {
    margin-inline-start: auto;
  }
  :host([data-appearance="modern"]) .overview-wall {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(var(--wall-columns, 4), minmax(0, 1fr));
    grid-template-rows: repeat(var(--wall-rows, 3), minmax(190px, 1fr));
    height: var(--wall-height, 660px);
    align-items: stretch;
  }
  :host([data-appearance="modern"]) .overview-wall .overview-station {
    position: relative;
    min-width: 0;
    min-height: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
  }
  :host([data-appearance="modern"]) .overview-wall .station-head {
    padding: 7px 10px;
    gap: 8px;
    min-height: 38px;
    flex: 0 0 auto;
  }
  .overview-wall .station-head h3 {
    margin: 0;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .overview-wall .station-head .badge {
    padding: 3px 7px;
    font-size: 11px;
    white-space: nowrap;
  }
  .overview-wall .camera-wrap {
    flex: 1 1 0;
    min-height: 80px;
    overflow: hidden;
    margin: 0 8px;
    border-radius: 6px;
  }
  .overview-wall .camera-wrap hikvision-intercom-camera {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    border-radius: 6px;
  }
  :host([data-appearance="modern"]) .overview-wall .camera-wrap > button {
    min-height: 36px;
    width: 36px;
    padding: 6px;
    inset-inline-end: 6px;
    bottom: 6px;
  }
  .wall-offline {
    height: 100%;
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    color: #d4dde0;
    background: #263339;
  }
  .wall-actions {
    display: flex;
    gap: 6px;
    padding: 8px;
    flex: 0 0 auto;
  }
  .wall-actions .door-action {
    display: flex;
    flex: 1;
    gap: 6px;
    min-width: 0;
    margin: 0;
  }
  .wall-actions .door-action button {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    font-size: 13px;
    min-height: 40px;
    line-height: 1.2;
  }
  .wall-actions .door-action .ui-icon {
    flex-shrink: 0;
    width: 16px;
  }
  .wall-details {
    min-width: 40px;
    min-height: 40px;
    padding: 4px;
    font-size: 22px;
  }
  .overview-wall .release-feedback {
    position: absolute;
    inset: auto 8px 58px;
    z-index: 1;
    padding: 8px;
    border-radius: 6px;
    background: var(--surface, white);
    box-shadow: 0 2px 10px #0002;
    font-size: 12px;
    max-height: 70%;
    overflow: auto;
  }
  .overview-wall .release-feedback .sub {
    display: none;
  }
  .wall-pagination {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding-top: 8px;
    color: var(--secondary-text-color);
  }
  .wall-pagination > div {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .wall-pagination button {
    padding: 4px 10px;
    min-height: 36px;
  }
  @container intercom-panel (max-width: 600px) {
    :host([data-appearance="modern"]) main:has(.overview-wall) {
      padding: 10px;
    }
    .wall-controls hikvision-live-clock {
      width: 100%;
    }
    .wall-pagination > span {
      display: none;
    }
    .wall-pagination {
      justify-content: center;
    }
    :host([data-appearance="modern"]) .wall-toolbar .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: 100%;
    }
  }
`;
