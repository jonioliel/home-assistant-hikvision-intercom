import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("alert snooze requires confirmation, affects only its kind and can be restored", async ({
  page,
}) => {
  await page.goto("/?fleet-alerts=1");
  await navigate(page, "Station alerts");
  const view = page.locator("wiskey-fleet-alerts");
  const card = view.locator("article").filter({ hasText: "Main gate" });
  await card.getByRole("button", { name: "Snooze this alert" }).click();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("fleet/alerts_action")).length,
    ),
  ).toBe(0);
  const review = view.getByRole("region", { name: "Review alert presentation change" });
  await expect(review.getByRole("combobox", { name: "Duration", exact: true })).toHaveValue("60");
  await review.getByRole("combobox", { name: "Duration", exact: true }).selectOption("15");
  await review.getByRole("button", { name: "Confirm suppression" }).click();
  await expect(view.getByRole("status")).toContainText("Device operation was preserved");
  await expect(view.locator("article")).toHaveCount(1);
  const saved = await page.evaluate(() => window.fleetAlerts.suppressions[0]);
  expect(saved.kind).toBe("sync_conflict");
  expect(saved.reason).toBe("investigating");
  await view.getByRole("button", { name: "Restore now" }).click();
  await view.getByRole("button", { name: "Restore alert presentation" }).click();
  await expect(view.locator("article")).toHaveCount(2);
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((call) => /sync\/|test_unlock|users\/update/.test(call.type)).length,
    ),
  ).toBe(0);
});

test("maintenance can be set before an alert and snoozed cards remain inspectable", async ({
  page,
}) => {
  await page.goto("/?fleet-alerts=1");
  await navigate(page, "Station alerts");
  const view = page.locator("wiskey-fleet-alerts");
  await view
    .getByRole("combobox", { name: "Station maintenance", exact: true })
    .selectOption("station-0");
  await view.getByRole("button", { name: "Set maintenance period" }).click();
  await view.getByRole("button", { name: "Confirm suppression" }).click();
  await view.getByRole("checkbox", { name: "Show snoozed alerts" }).check();
  await expect(view.locator("article")).toHaveCount(2);
  await expect(view.locator("article.suppressed")).toHaveCount(1);
  await view
    .locator("article")
    .filter({ hasText: "Main gate" })
    .getByRole("button", { name: "Open station details" })
    .click();
  await expect(
    page
      .locator("hikvision-intercom-panel .station-settings-heading")
      .getByRole("heading", { name: "Main gate", exact: true }),
  ).toBeVisible();
});

test("stale alert edit never overwrites and viewer has no mutation actions", async ({ page }) => {
  await page.goto("/?fleet-alerts=1");
  await navigate(page, "Station alerts");
  const view = page.locator("wiskey-fleet-alerts");
  await view.locator("article").first().getByRole("button", { name: "Snooze this alert" }).click();
  await page.evaluate(() => window.fleetAlerts.revision++);
  await view.getByRole("button", { name: "Confirm suppression" }).click();
  await expect(view.getByRole("alert")).toBeVisible();
  await expect(view.getByRole("button", { name: "Confirm suppression" })).toBeDisabled();
  expect(await page.evaluate(() => window.fleetAlerts.suppressions.length)).toBe(0);
  await page.goto("/?fleet-alerts=1&reader=1&grant=stations:view,management:view");
  await navigate(page, "Station alerts");
  await expect(view.locator("article")).toHaveCount(2);
  await expect(view.getByRole("button", { name: "Snooze this alert" })).toHaveCount(0);
});

test("Hebrew mobile alerts fit and expiry resumes an alert on refresh", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fleet-alerts=1&lang=he");
  await navigate(page, "התראות תחנות");
  const view = page.locator("wiskey-fleet-alerts");
  await view.locator("article").first().getByRole("button", { name: "השהיית התראה זו" }).click();
  await view.getByRole("button", { name: "אישור השהיה" }).click();
  await expect(view.locator("article")).toHaveCount(1);
  await page.evaluate(
    () => (window.fleetAlerts.suppressions[0].until = new Date(Date.now() - 1000).toISOString()),
  );
  await view.getByRole("button", { name: "רענון", exact: true }).click();
  await expect(view.locator("article")).toHaveCount(2);
  await expect(view.getByRole("button", { name: "הקודם", exact: true })).toBeDisabled();
  await expect(view.getByRole("button", { name: "הבא", exact: true })).toBeDisabled();
  expect(await view.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
