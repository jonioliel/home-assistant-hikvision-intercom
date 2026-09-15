import { css } from "lit";

export const stationSettingsStyles = css`
  .station-settings-list {
    display: grid;
    gap: 24px;
  }
  .station-config {
    min-width: 0;
    border: 1px solid var(--divider-color);
    border-radius: 16px;
    padding: 20px;
    background: var(--surface);
  }
  .station-settings-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 18px;
  }
  .station-settings-heading h3 {
    margin: 0 0 6px;
    font-size: 23px;
  }
  .station-settings-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .station-settings-card {
    min-width: 0;
    padding: 18px;
    border: 1px solid var(--divider-color);
    border-radius: 12px;
  }
  .station-settings-card h4 {
    margin: 0 0 14px;
  }
  .station-config dl {
    display: grid;
    grid-template-columns: minmax(100px, 0.7fr) minmax(0, 1.3fr);
    gap: 12px;
    margin: 0;
  }
  .station-config dt {
    color: var(--muted);
  }
  .station-config dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .station-settings-symbol {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
    color: var(--accent);
  }
  .station-settings-symbol svg {
    width: 48px;
    height: 48px;
  }
  .station-relay {
    padding: 14px;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    margin-bottom: 12px;
  }
  .station-relay .row {
    margin-top: 12px;
  }
  .station-config .device-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 16px 0;
  }
  .station-config .device-metrics > div {
    min-width: 0;
    text-align: center;
    padding: 12px 6px;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
  }
  .station-config .device-metrics strong {
    display: block;
    font-size: 24px;
    margin-bottom: 4px;
  }
  .station-config > details {
    border-top: 1px solid var(--divider-color);
    padding: 14px 0;
  }
  .station-config summary {
    cursor: pointer;
    font-weight: 600;
  }
  .station-config .settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  @container intercom-panel (max-width: 850px) {
    .station-settings-columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 700px) {
    .station-settings-columns {
      grid-template-columns: minmax(0, 1fr);
    }
    .station-config {
      padding: 16px;
    }
    .station-settings-card {
      padding: 12px;
    }
  }
`;
