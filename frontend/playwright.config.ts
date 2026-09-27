import { defineConfig } from "@playwright/test";
const port = Number(process.env.WISKEY_TEST_PORT || 8765);
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: process.env.CI
      ? {}
      : { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" },
  },
  webServer: {
    command: "node tests/serve.mjs",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
