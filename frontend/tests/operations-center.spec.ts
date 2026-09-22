import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("background operations show durable progress with friendly names and targeted retry", async ({
  page,
}) => {
  await page.goto("/?operations=1");
  await navigate(page, "Background operations");
  const center = page.locator("wiskey-operations-center");
  await expect(center.getByRole("heading", { name: "Background operations" })).toBeVisible();
  await expect(center).toContainText("CSV import");
  await expect(center).toContainText("Lobby entrance");
  await expect(center).toContainText("Dana Cohen");
  await expect(center.getByText("Saved · needs attention").first()).toBeVisible();

  await center.getByRole("button", { name: "Retry station" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.calls.filter((call) => call.type.endsWith("sync/station")).at(-1)?.station_id,
      ),
    )
    .toBe("station-1");
});

test("operations center is usable on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?operations=1&lang=he");
  await navigate(page, "עבודות רקע");
  await expect(page.locator("wiskey-operations-center")).toBeVisible();
  expect(
    await page
      .locator(".app-shell")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("person details use the dedicated endpoint and reuse the bounded cache", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "access-light"),
  );
  await page.goto("/?operations=1");
  await navigate(page, "Users");
  const link = page.locator(".access-people-table .user-detail-link").nth(1);
  await link.click();
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.filter((call) => call.type.endsWith("users/get")).length),
    )
    .toBe(1);
  await link.click();
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.filter((call) => call.type.endsWith("users/get")).length),
    )
    .toBe(1);
});
