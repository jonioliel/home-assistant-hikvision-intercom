import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["operational.spec.ts", "access-design.spec.ts"],
  fullyParallel: true,
  workers: 2,
  use: { baseURL: "http://127.0.0.1:8765", headless: true },
  projects: [
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
