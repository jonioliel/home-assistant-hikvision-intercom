import { css } from "lit";

/** Shared compact navigation for both visual themes. HA retains its own menu. */
export const headerStyles = css`
  .app-shell,
  :host([data-appearance="modern"]) .app-shell {
    display: block;
    min-height: 100%;
  }
  .app-shell > header {
    display: block;
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .head,
  :host([data-appearance="modern"]) .head {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
    max-width: none;
    gap: 12px;
    padding: 12px 20px;
  }
  .head .nav,
  :host([data-appearance="modern"]) .head .nav {
    display: flex;
    position: static;
    width: auto;
    min-height: 0;
    max-height: none;
    margin: 0;
    padding: 0;
    overflow: visible;
    background: transparent;
    color: inherit;
  }
  .head .nav .nav-primary,
  :host([data-appearance="modern"]) .head .nav .nav-primary {
    display: flex;
    flex-direction: row;
    gap: 4px;
    width: auto;
    overflow: visible;
  }
  .head .nav button,
  :host([data-appearance="modern"]) .head .nav button {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    padding: 8px 12px;
    white-space: nowrap;
    color: var(--primary-text-color, #263446);
    background: transparent;
    border-radius: 10px;
  }
  .head .nav button[aria-current="page"],
  :host([data-appearance="modern"]) .head .nav button[aria-current="page"] {
    background: #4169df;
    color: white;
  }
  main,
  :host([data-appearance="modern"]) main {
    width: 100%;
    max-width: 1900px;
    margin-inline: auto;
  }
  @container intercom-panel (max-width: 850px) {
    .head,
    :host([data-appearance="modern"]) .head {
      padding: 10px 12px;
      gap: 8px;
    }
    .head .nav,
    :host([data-appearance="modern"]) .head .nav {
      order: 5;
      width: 100%;
    }
    .head .nav .nav-primary,
    :host([data-appearance="modern"]) .head .nav .nav-primary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      width: 100%;
    }
    .head .nav button,
    :host([data-appearance="modern"]) .head .nav button {
      flex-direction: column;
      padding: 6px 2px;
      gap: 4px;
      white-space: normal;
      min-width: 0;
    }
  }
`;
