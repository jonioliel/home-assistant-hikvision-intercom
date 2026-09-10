import { navigate, openAppearance } from "./navigation";
import { test, expect } from "@playwright/test";
const preference = "hikvision-intercom:appearance:v1:demo-admin";
for (const [name, width, lang, dark] of [
  ["desktop-he", 1440, "he", false],
  ["desktop-en-dark", 1440, "en", true],
  ["tablet-he-dark", 768, "he", true],
  ["mobile-he", 390, "he", false],
  ["small-en-dark", 320, "en", true],
] as const) {
  test(`compact overview header fits and preserves all counters: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript((key) => localStorage.setItem(key, "modern"), preference);
    await page.goto(`/?lang=${lang}${dark ? "&dark=1" : ""}`);
    const metrics = page.locator(".overview-header .metric");
    await expect(metrics).toHaveCount(4);
    await expect(metrics.locator("bdi")).toHaveText(["8 / 9", "1", "6", "3"]);
    await expect(metrics.nth(0)).toHaveAccessibleName(
      lang === "he" ? "תחנות מחוברות: 8 / 9" : "Stations online: 8 / 9",
    );
    expect(
      await metrics.evaluateAll((nodes) =>
        nodes.every(
          (el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height <= 36,
        ),
      ),
    ).toBe(true);
    const title = await page.locator(".overview-header h2").boundingBox();
    const summary = await page.locator(".metrics").boundingBox();
    const header = await page.locator(".overview-header").boundingBox();
    const cards = await page.locator(".overview-station").first().boundingBox();
    if (width >= 1100) {
      expect(Math.abs(title!.y - summary!.y)).toBeLessThan(6);
      expect(header!.height).toBeLessThan(85);
      const chips = await metrics.evaluateAll((nodes) =>
        nodes.map((el) => el.getBoundingClientRect().y),
      );
      expect(new Set(chips).size).toBe(1);
    }
    if (width <= 600) {
      const chips = await metrics.evaluateAll((nodes) =>
        nodes.map((el) => el.getBoundingClientRect().y),
      );
      expect(chips[0]).toBe(chips[1]);
      expect(chips[2]).toBe(chips[3]);
      expect(chips[2]).toBeGreaterThan(chips[0]);
      expect(summary!.height).toBeLessThanOrEqual(74);
      expect(summary!.y).toBeGreaterThan(title!.y + title!.height);
    }
    expect(cards!.y - (header!.y + header!.height)).toBeLessThanOrEqual(22);
    expect(
      await page.locator(".app-shell").evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/compact-header-${name}.png` });
  });
}
test("existing design retains its metric row when toggling appearance", async ({ page }) => {
  await page.goto("/");
  const counters = page.locator(".metric bdi");
  await expect(counters).toHaveText(["8 / 9", "1", "6", "3"]);
  const oldHeader = await page.locator(".overview-header .page-heading").boundingBox();
  const oldMetrics = await page.locator(".metrics").boundingBox();
  expect(oldMetrics!.y).toBeGreaterThan(oldHeader!.y + oldHeader!.height);
  const oldCard = await page.locator(".overview-station").first().boundingBox();
  await openAppearance(page);
  const picker = page.locator("hikvision-appearance-picker");
  await picker.getByRole("radio", { name: "New", exact: true }).check();
  await picker.getByRole("button", { name: "Apply design" }).click();
  await navigate(page, "Overview");
  await expect(counters).toHaveText(["8 / 9", "1", "6", "3"]);
  const compactCard = await page.locator(".overview-station").first().boundingBox();
  expect(oldCard!.y - compactCard!.y).toBeGreaterThan(60);
  await openAppearance(page);
  await picker.getByRole("radio", { name: "Existing", exact: true }).check();
  await picker.getByRole("button", { name: "Apply design" }).click();
  await navigate(page, "Overview");
  expect((await page.locator(".metrics").boundingBox())!.height).toBe(oldMetrics!.height);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator(".metric-label-short").first()).toBeHidden();
  await expect(page.locator(".metric-label-full").first()).toBeVisible();
});
test("refresh changes counts and accessible descriptions without sending a door command", async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, "modern"), preference);
  await page.goto("/");
  await expect(page.locator(".metric bdi")).toHaveText(["8 / 9", "1", "6", "3"]);
  await page.evaluate(() => {
    window.demoData.stations[0].online = false;
    window.demoData.stations[0].call_state = "idle";
    window.demoData.stations.forEach((station) => (station.pending_user_count = 0));
    window.demoData.users = [];
    window.demoNotify();
  });
  await expect(page.locator(".metric bdi")).toHaveText(["7 / 9", "0", "0", "0"]);
  await expect(page.locator(".metric").first()).toHaveAccessibleName("Stations online: 7 / 9");
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => /test_unlock|sync\/|users\/(create|update)/.test(c.type)),
    ),
  ).toBe(false);
});
test("large counts fit a narrow HA panel inside a desktop browser", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.addInitScript((key) => localStorage.setItem(key, "modern"), preference);
  await page.goto("/");
  await expect(page.locator(".metric")).toHaveCount(4);
  await page.evaluate(() => {
    (document.querySelector("hikvision-intercom-panel") as HTMLElement).style.width = "320px";
    window.demoData.users = Array.from({ length: 20000 }, (_, i) => ({
      ...window.demoData.users[0],
      id: `synthetic-${i}`,
    }));
    window.demoData.stations.forEach((station) => (station.pending_user_count = 20000));
    window.demoNotify();
  });
  await expect(page.locator(".metric bdi")).toHaveText(["8 / 9", "1", "20000", "180000"]);
  expect(
    await page
      .locator(".metric")
      .evaluateAll((nodes) => nodes.every((el) => el.scrollWidth <= el.clientWidth)),
  ).toBe(true);
  expect(await page.locator(".app-shell").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.locator("hikvision-intercom-panel").evaluate((el) => {
    (el as HTMLElement).style.width = "1200px";
  });
  await expect(page.locator(".metric bdi")).toHaveText(["8 / 9", "1", "20000", "180000"]);
});
