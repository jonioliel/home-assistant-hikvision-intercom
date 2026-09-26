import { test, expect } from "@playwright/test";

test("existing WisKey appearance survives the HACS upgrade", async ({ page }) => {
  const key = "hikvision-intercom:appearance:v1:demo-admin";
  await page.addInitScript((savedKey) => {
    localStorage.setItem(savedKey, "access-dark");
  }, key);
  await page.goto("/?lang=he");
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
    "data-appearance",
    "access-dark",
  );
  expect(await page.evaluate((savedKey) => localStorage.getItem(savedKey), key)).toBe(
    "access-dark",
  );
});
