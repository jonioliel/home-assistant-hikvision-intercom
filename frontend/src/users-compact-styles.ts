import { css } from "lit";
export const usersCompactStyles = css`
  .users-page .users-heading {
    margin-block: 0 12px;
  }
  .users-page .users-heading p {
    margin-block: 4px 0;
  }
  .users-page .users-tools {
    padding: 10px;
    gap: 8px;
    margin-block: 0 10px;
  }
  .users-page .users-tools input {
    min-width: 180px;
  }
  .users-filter-strip {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
  }
  .users-filter-strip wiskey-saved-user-views {
    flex: 1 1 240px;
    min-width: 0;
  }
  .users-page .user-filters {
    flex: 1 1 240px;
    margin: 0;
    padding: 8px 12px;
  }
  .users-page .user-result-bar {
    display: inline-flex;
    margin: 0;
    padding: 4px 0;
    align-items: center;
    gap: 8px;
  }
  .users-page .user-result-bar p {
    margin: 0;
  }
  .users-page .user-selection-tools {
    display: inline-flex;
    margin: 0;
    padding: 4px 8px;
    border: 0;
    background: none;
  }
  .users-page .phone-cell {
    min-width: 128px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .users-page .user-detail-link {
    padding: 4px;
    border: 0;
    background: none;
    color: inherit;
    font-weight: 700;
    text-align: start;
  }
  .users-page .user-detail-link:hover {
    color: var(--primary-color, #4264da);
    text-decoration: underline;
  }
  .users-page .desktop-users {
    margin-top: 8px;
  }
  @media (max-width: 700px) {
    .users-page .users-tools input {
      flex-basis: 100%;
    }
    .users-filter-strip {
      display: block;
    }
  }
`;
