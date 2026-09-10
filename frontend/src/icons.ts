import { svg } from "lit";
const paths: Record<string, string> = {
  appearance:
    "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1 1 0 0 1 .7-1.7H17a4 4 0 0 0 4-4A9 9 0 0 0 12 3ZM7 10h.01M10 6h.01M15 6h.01M18 10h.01",
  overview: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  devices: "M6 3h12v18H6ZM9 7h6M9 11h6M11 17h2",
  events: "M5 3h14v18H5ZM8 7h8M8 11h5M8 15h7",
  sync: "M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5",
  audit: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  health: "M2 12h5l3-8 4 16 3-8h5",
  schedules: "M4 5h16v16H4ZM4 10h16M8 3v4m8-4v4",
  lock: "M6 10h12v11H6ZM8 10V7a4 4 0 0 1 8 0M12 14v3",
  camera: "M3 6h12v12H3ZM15 10l6-4v12l-6-4",
  menu: "M4 6h16M4 12h16M4 18h16",
  arrow: "M7 17 17 7M7 7h10v10",
};
export const icon = (name: string) =>
  svg`<svg class="ui-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${paths[name] ?? paths.overview}></path></svg>`;
