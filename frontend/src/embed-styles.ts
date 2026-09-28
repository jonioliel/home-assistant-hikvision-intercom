import { css } from "lit";

/** The iframe host owns its height; no infrastructure-header or viewport offset. */
export const embedStyles = css`
  :host([data-embed][data-embed-api]) {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 100%;
    margin: 0;
  }
  :host([data-embed][data-embed-api]) .app-shell {
    min-height: 100%;
    min-width: 0;
    max-width: none;
    margin: 0;
  }
  :host([data-embed][data-embed-api]) main {
    max-width: none;
    margin: 0;
    padding: 12px;
  }
`;
