import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:8765",
    headless: true,
    launchOptions: process.env.CI
      ? {}
      : { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" },
  },
  webServer: {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
