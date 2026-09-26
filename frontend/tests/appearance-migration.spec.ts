import { test, expect } from "@playwright/test";

test("existing WisKey appearance survives the integration domain migration", async ({ page }) => {
  const oldKey = "hikvision-intercom:appearance:v1:demo-admin";
  const newKey = "smplwise-access-control:appearance:v1:demo-admin";
  await page.addInitScript(
    ({ oldKey, newKey }) => {
      localStorage.setItem(oldKey, "access-dark");
      localStorage.removeItem(newKey);
    },
    { oldKey, newKey },
  );
  await page.goto("/?lang=he");
  await expect(page.locator("smplwise-access-control-panel")).toHaveAttribute(
    "data-appearance",
    "access-dark",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), newKey)).toBe("access-dark");
  expect(await page.evaluate((key) => localStorage.getItem(key), oldKey)).toBeNull();
});
