import { css } from "lit";
export const adminStyles = css`
  :host {
    display: block;
    min-width: 0;
  }
  .page-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
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
    color: var(--muted);
    font-size: 13px;
  }
  .filter-panel {
    padding: 18px;
    background: var(--surface);
    border: 1px solid var(--divider-color);
    border-radius: var(--hik-radius, 14px);
    margin-bottom: 16px;
  }
  .filter-panel summary {
    font-weight: 600;
    cursor: pointer;
  }
  .filter-panel[open] summary {
    margin-bottom: 16px;
  }
  .filter-panel form {
    margin: 0;
  }
  .record-heading {
    display: flex;
    justify-content: space-between;
    align-items: start;
    flex-wrap: wrap;
    gap: 8px;
  }
  .record-heading h3 {
    margin: 0;
    font-size: 16px;
  }
  .record-heading time {
    color: var(--muted);
    font-size: 12px;
  }
  .record-meta {
    color: var(--muted);
    font-size: 12px;
    margin: 8px 0;
  }
  .record-person {
    font-size: 16px;
    font-weight: 600;
    margin: 10px 0 5px;
  }
  .report-help {
    font-size: 12px;
    color: var(--muted);
    margin: 12px 0;
  }
  .report-help summary {
    cursor: pointer;
  }
  .result-summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin: 16px 0;
    color: var(--muted);
    font-size: 13px;
  }
  .filter-pending {
    padding: 8px 12px;
    border-inline-start: 3px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, var(--surface));
    border-radius: 6px;
    font-size: 12px;
  }
  .audit-row,
  .history article {
    padding: 18px 20px;
    margin: 0 0 12px;
    background: var(--surface);
    border: 1px solid var(--divider-color);
    border-radius: var(--hik-radius, 14px);
  }
  .audit-row p {
    margin: 6px 0;
  }
  .audit-row details,
  .audit-diff {
    margin-top: 12px;
    border-top: 1px solid var(--divider-color);
    padding-top: 10px;
    font-size: 12px;
  }
  .audit-row summary,
  .audit-diff summary {
    cursor: pointer;
    color: var(--muted);
  }
  .audit-diff .comparison {
    margin: 14px 0;
  }
  .audit-diff .comparison > div {
    padding: 12px;
    border-radius: 10px;
    background: var(--primary-background-color);
  }
  .history .history-action {
    margin-top: 12px;
    font-size: 12px;
  }
  .audit-row .badge {
    border-radius: 20px;
    padding: 4px 9px;
    color: var(--ink);
    background: var(--primary-background-color);
  }
  .audit-row .badge.error {
    color: color-mix(in srgb, var(--error-color, #b84246) 45%, var(--ink));
  }
  @container intercom-panel (max-width: 650px) {
    .page-heading {
      align-items: flex-start;
    }
    .page-heading h2 {
      font-size: 24px;
    }
    .filter-panel {
      padding: 14px 12px;
    }
    .filter-panel label {
      font-size: 12px;
    }
    .audit-row,
    .history article {
      padding: 16px;
    }
    .record-heading {
      flex-direction: column;
    }
  }
`;
