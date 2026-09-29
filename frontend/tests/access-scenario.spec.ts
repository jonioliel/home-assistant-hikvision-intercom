import { test, expect } from "@playwright/test";
async function setup(page) {
  await page.goto("/");
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    const view = document.createElement("wiskey-access-scenario");
    const original = panel.hass;
    view.hass = {
      ...original,
      callWS: async (msg) => {
        window.calls.push(msg);
        if (window.delayScenario)
          return new Promise((resolve) => (window.resolveScenario = resolve));
        return window.scenarioResponse;
      },
    };
    view.person = {
      id: "u1",
      revision: 4,
      active: true,
      assignments: { front: { enabled: true, allowed_locks: [1], sync_state: "pending" } },
    };
    view.stations = [{ id: "front", name: "Front entrance" }];
    window.scenarioResponse = {
      desired: { allowed: false, reason: "outside_schedule", draft_ignored: false },
      observed: {
        sync_state: "pending",
        revision_matches: false,
        last_sync_at: null,
        timing: { status: "unavailable" },
      },
      physical_result: "not_verified",
      station_status: "offline",
    };
    document.body.append(view);
  });
  const view = page.locator("wiskey-access-scenario");
  await view.getByText("Check access scenario", { exact: true }).click();
  return view;
}
for (const width of [390, 1440])
  test(`read-only explicit scenario and no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const view = await setup(page);
    await view.getByLabel("Date and time with UTC offset").fill("2026-09-29T12:00:00+03:00");
    await view.getByRole("button", { name: "Check scenario", exact: true }).click();
    await expect(view.getByText("Expected to deny", { exact: true })).toBeVisible();
    await expect(view).toContainText("Outside allowed days or hours");
    await expect(view).toContainText("No verified time interval available");
    expect(await view.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    const calls = await page.evaluate(() =>
      window.calls.filter((c) => c.type.endsWith("users/access_scenario")),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].at).toBe("2026-09-29T12:00:00+03:00");
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => c.type.endsWith("users/update") || c.type.endsWith("doors/open")),
      ),
    ).toBe(false);
    await view.getByLabel("Door", { exact: true }).selectOption("2");
    await expect(view.getByText("Expected to deny", { exact: true })).toHaveCount(0);
  });
test("late scenario result is discarded on input, person and connection changes", async ({
  page,
}) => {
  const view = await setup(page);
  await page.evaluate(() => (window.delayScenario = true));
  await view.getByRole("button", { name: "Check scenario", exact: true }).click();
  await view.getByLabel("Door", { exact: true }).selectOption("2");
  await page.evaluate(() => window.resolveScenario(window.scenarioResponse));
  await expect(view.locator('[role="status"]')).toHaveCount(0);
  await view.getByRole("button", { name: "Check scenario", exact: true }).click();
  await view.evaluate((e) => {
    e.person = { ...e.person, revision: 5 };
  });
  await page.evaluate(() => window.resolveScenario(window.scenarioResponse));
  await expect(view.locator('[role="status"]')).toHaveCount(0);
  await view.getByRole("button", { name: "Check scenario", exact: true }).click();
  await view.evaluate((e) => {
    e.hass = { ...e.hass, connection: { ...e.hass.connection, connected: false } };
  });
  await page.evaluate(() => window.resolveScenario(window.scenarioResponse));
  await expect(view.locator('[role="status"]')).toHaveCount(0);
});
test("hidden access field never offers scenario query", async ({ page }) => {
  const view = await setup(page);
  await view.evaluate((e) => {
    e.person = { ...e.person, redacted_fields: ["access"] };
  });
  await expect(view.locator("details")).toHaveCount(0);
});

for (const width of [390, 1440])
  test(`scenario is folded in the existing Hebrew person details at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "access-dark"),
    );
    await page.goto("/?lang=he&lifecycle=1");
    if (width === 1440)
      await page.evaluate(() => {
        const p = window.demoData.users[0];
        window.demoData.profile_settings.fields = [
          { id: "department", label: "מחלקה", enabled: true },
          { id: "role", label: "תפקיד", enabled: true },
        ];
        p.profile = { department: "הנהלה", role: "מנהל" };
        p.assignments = Object.fromEntries(
          window.demoData.stations
            .slice(0, 8)
            .map((s) => [s.id, { enabled: true, allowed_locks: [1], sync_state: "synced" }]),
        );
        window.demoNotify();
      });
    await page.locator(".nav").getByRole("button", { name: "משתמשים", exact: true }).click();
    await page.locator(".access-people-table .user-detail-link").first().click();

    if (width === 1440)
      await expect(
        page.locator("wiskey-user-details").getByRole("button", { name: "עריכה", exact: true }),
      ).toBeInViewport();
    await page
      .locator("wiskey-user-details")
      .getByRole("button", { name: "תרחיש", exact: true })
      .click();
    const view = page.locator("wiskey-user-details wiskey-access-scenario");
    await expect(view).toBeVisible();
    expect(
      await page.evaluate(
        () => window.calls.filter((c) => c.type.endsWith("users/access_scenario")).length,
      ),
    ).toBe(0);
    await view.getByText("בדיקת תרחיש גישה", { exact: true }).click();
    await view.getByRole("button", { name: "בדוק תרחיש", exact: true }).click();
    await expect(view).toContainText("צפי להרשאה");
    await expect(view).toContainText("כניסה בפועל בדלת");
    expect(await view.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
