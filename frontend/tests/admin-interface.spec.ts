import { test, expect, type Page } from "@playwright/test";
async function auditFixture(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      original = w.demoHass.callWS.bind(w.demoHass);
    w.demoHass.callWS = async (message: any) => {
      if (message.type.endsWith("audit/list")) {
        w.calls.push(structuredClone(message));
        const before = {
          display_name: "Demo resident",
          employee_no: "1000",
          active: true,
          pin_configured: true,
          card_count: 1,
          assignments: { "station-0": { enabled: true } },
        };
        return {
          total: 1,
          next_cursor: null,
          actors: { admin: "Demo administrator" },
          records: [
            {
              sequence: 1,
              time: "2026-09-09T10:00:00Z",
              actor: "admin",
              action: "users/update",
              user_id: "person-0",
              stations: ["station-0"],
              fields: ["pin"],
              before,
              after: { ...before, pin_configured: false },
              revision_before: 1,
              revision_after: 2,
            },
          ],
        };
      }
      return original(message);
    };
  });
}

test("event draft filters stay distinct from applied results and reset restores all", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const events = page.locator("hikvision-intercom-events");
  await events.getByRole("combobox", { name: "Result", exact: true }).selectOption("denied");
  await expect(events.locator(".filter-pending")).toBeVisible();
  await expect(events.locator(".audit-row")).toHaveCount(2);
  await events.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(events.locator(".audit-row")).toHaveCount(1);
  await expect(events.locator(".filter-pending")).toHaveCount(0);
  await events.getByRole("combobox", { name: "Result", exact: true }).selectOption("granted");
  await events.getByRole("button", { name: "Generate report", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.findLast((c: any) => c.type.endsWith("events/report")).filters.result,
    ),
  ).toBe("denied");
  await events.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(events.locator(".audit-row")).toHaveCount(2);
  await expect(events.locator(".activity-report")).toHaveCount(0);
  await expect(events.getByRole("combobox", { name: "Result", exact: true })).toHaveValue("");
  expect(
    await page.evaluate(
      () => (window as any).calls.findLast((c: any) => c.type.endsWith("events/list")).filters,
    ),
  ).toEqual({ limit: 100 });
});

test("sync filters are local and retain all station options and removals", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  const station = page.getByRole("combobox", { name: "Show station" });
  await station.selectOption("station-2");
  await expect(station.locator("option")).toHaveCount(10);
  await page.getByRole("checkbox", { name: "Only items needing attention" }).check();
  await expect(page.locator(".matrix tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Conflict", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Find a person" }).fill("no such resident");
  await expect(page.getByText("No users match these sync filters.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending removals" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some(
        (c: any) => c.type.includes("sync/") || c.type.includes("conflicts/resolve"),
      ),
    ),
  ).toBe(false);
});

test("history comparison opens from keyboard without changing access", async ({ page }) => {
  await page.goto("/");
  await auditFixture(page);
  await page.getByRole("button", { name: "Change history", exact: true }).click();
  const audit = page.locator("hikvision-admin-audit");
  await expect(audit.locator(".record-person")).toHaveText("Demo resident");
  await expect(audit.locator(".comparison")).not.toBeVisible();
  await audit.locator(".audit-diff summary").focus();
  await page.keyboard.press("Enter");
  await expect(audit.locator(".comparison")).toBeVisible();
  await expect(audit.locator(".comparison")).toContainText("PIN");
  expect(
    await page.evaluate(() =>
      (window as any).calls.some(
        (c: any) => c.type.includes("users/update") || c.type.includes("sync/"),
      ),
    ),
  ).toBe(false);
});

for (const [name, width, lang, dark] of [
  ["desktop-he", 1440, "he", false],
  ["desktop-en-dark", 1440, "en", true],
  ["tablet-he-dark", 768, "he", true],
  ["mobile-he", 390, "he", false],
] as const) {
  test(`admin layouts retain controls and fit the panel: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`/?lang=${lang}${dark ? "&dark=1" : ""}`);
    await auditFixture(page);
    for (const [tab, he, en] of [
      ["events", "אירועים", "Events"],
      ["sync", "סנכרון", "Sync"],
      ["audit", "יומן שינויים", "Change history"],
    ]) {
      await page.getByRole("button", { name: lang === "he" ? he : en, exact: true }).click();
      const target =
        tab === "events"
          ? page.locator(".audit-row")
          : tab === "sync"
            ? page.locator(".matrix tbody tr")
            : page.locator("hikvision-admin-audit .history article");
      await expect(target.first()).toBeVisible();
      expect(
        await page.locator(".app-shell").evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      if (tab === "sync" && width <= 900) {
        await expect(page.locator(".sync-cell-station").first()).toBeVisible();
        expect(
          await page.locator(".matrix").evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
      }
      await page.screenshot({ path: `test-results/${tab}-${name}-025.png`, fullPage: true });
    }
  });
}
