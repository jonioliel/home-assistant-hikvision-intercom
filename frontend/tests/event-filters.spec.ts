import { test, expect } from "@playwright/test";

test("mobile activity starts with records visible and filters available on demand", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "אירועים", exact: true }).click();
  const events = page.locator("hikvision-intercom-events");
  await expect(events.locator(".event-filters")).not.toHaveAttribute("open");
  await expect(events.locator(".audit-row").first()).toBeVisible();
  const heading = await events.locator(".audit-row h3").first().boundingBox();
  expect(heading!.y + heading!.height).toBeLessThan(844);
  expect(await events.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/events-mobile-collapsed-he.png" });
  await events.locator(".event-filters summary").click();
  await expect(events.locator("input[name=person]")).toBeVisible();
  expect(await events.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/events-mobile-expanded-he.png" });
});

test("desktop filters remain open and report only applied criteria", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const events = page.locator("hikvision-intercom-events");
  await expect(events.locator(".event-filters")).toHaveAttribute("open");
  await events.getByLabel("Result", { exact: true }).selectOption("denied");
  await expect(events.locator(".event-filters summary")).toContainText("All events");
  await events.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(events.locator(".event-filters summary")).toContainText("Applied: 1");
  await events.locator(".event-filters summary").click();
  await expect(events.locator(".audit-row")).toHaveCount(1);
  await events.getByRole("button", { name: "Clear search and filters", exact: true }).click();
  await expect(events.locator(".event-filters summary")).toContainText("All events");
  await expect(events.locator(".audit-row")).toHaveCount(2);
});

test("filter disclosure preserves an unapplied draft through a list refresh", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const events = page.locator("hikvision-intercom-events");
  const summary = events.locator(".event-filters summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await events.locator("input[name=person]").fill("Draft resident");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    events.getByText(
      "Filters were edited. Apply them to update the results; reports still use the last applied filters.",
    ),
  ).toBeVisible();
  await events.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(events.locator(".event-filters")).not.toHaveAttribute("open");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(events.locator("input[name=person]")).toHaveValue("Draft resident");
  expect(
    await page.evaluate(() =>
      window.calls.filter((c) => c.type.endsWith("events/list")).every((c) => !c.filters.person),
    ),
  ).toBe(true);
});
