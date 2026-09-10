import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation";
async function setup(page: Page, he = false) {
  await page.goto(he ? "/?lang=he" : "/");
  await page.evaluate((he) => {
    window.demoData.profile_settings = {
      revision: 3,
      photo_enabled: false,
      fields: [
        { id: "dept", label: he ? "מחלקה" : "Department", enabled: true, options: [] },
        { id: "role", label: he ? "תפקיד" : "Role", enabled: true, options: [] },
        { id: "hidden", label: "Hidden", enabled: false, options: [] },
      ],
      groups: [
        {
          id: "management",
          label: he ? "הנהלה" : "Management",
          enabled: true,
          station_ids: ["station-0", "station-1"],
        },
        {
          id: "maintenance",
          label: he ? "אחזקה" : "Maintenance",
          enabled: true,
          station_ids: ["station-1", "station-2"],
        },
      ],
    };
    const u = window.demoData.users[0];
    u.profile = { dept: he ? "עובדים" : "Staff", role: he ? "מדריך" : "Guide", hidden: "Secret" };
    u.group_ids = ["management"];
    u.permission_overrides = {};
    u.assignments = {
      "station-0": { enabled: true, allowed_locks: [1] },
      "station-1": { enabled: true, allowed_locks: [1] },
    };
    window.demoNotify();
  }, he);
  await navigate(page, he ? "משתמשים" : "Users");
}
for (const width of [360, 768, 1440]) {
  test(`custom fields and groups visible in responsive Hebrew users list ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page, true);
    const visible = page
      .locator(width < 900 ? ".mobile-users .person" : ".desktop-users tbody tr")
      .first();
    await expect(visible).toContainText("עובדים");
    await expect(visible).toContainText("מדריך");
    await expect(visible).toContainText("הנהלה");
    await expect(visible).not.toContainText("Secret");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/groups-users-${width}-he.png`, fullPage: true });
  });
}
test("group union, personal deny, manual addition and reset send explicit overrides", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  const a = dialog.locator(".assignment").filter({ hasText: "Main gate" });
  const b = dialog.locator(".assignment").filter({ hasText: "Lobby entrance" });
  const c = dialog.locator(".assignment").filter({ hasText: "North parking" });
  await expect(a.getByRole("checkbox")).toBeChecked();
  await expect(a.locator(".permission-source")).toContainText("Management");
  await dialog.getByLabel("Maintenance", { exact: true }).check();
  await expect(c.getByRole("checkbox")).toBeChecked();
  await b.getByRole("checkbox").uncheck();
  await expect(b.locator(".permission-source")).toContainText("Personally blocked");
  await dialog.getByLabel("Management", { exact: true }).uncheck();
  await expect(a.getByRole("checkbox")).not.toBeChecked();
  await expect(b.getByRole("checkbox")).not.toBeChecked();
  await a.getByRole("checkbox").check();
  await b.getByRole("button", { name: "Use group permissions" }).click();
  await expect(b.getByRole("checkbox")).toBeChecked();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const patch = await page.evaluate(
    () => window.calls.filter((c) => c.type.endsWith("users/update")).at(-1).data,
  );
  expect(patch.permission_overrides).toEqual({ "station-0": "allow" });
  expect(patch.group_ids).toEqual(["maintenance"]);
  expect(patch.access_policy_revision).toBe(3);
  expect(patch.assignments).toBeUndefined();
});
test("group settings save selected station doors with renamed group and disabled state", async ({
  page,
}) => {
  await setup(page);
  await navigate(page, "User profile options");
  const settings = page.locator("hikvision-profile-settings");
  const group = settings
    .locator(".profile-definition")
    .filter({ has: page.getByLabel("Group name", { exact: true }) })
    .first();
  await group.getByLabel("Group name", { exact: true }).fill("Leadership");
  await group.getByLabel("Main gate", { exact: true }).uncheck();
  await group.getByLabel("Warehouse", { exact: true }).check();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("profiles/settings_preview")).at(-1),
  );
  expect(saved.values.groups[0].label).toBe("Leadership");
  expect(saved.values.groups[0].station_ids).toEqual(["station-1", "station-4"]);
  await expect(
    settings.getByRole("heading", { name: "Review group permission changes" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("profiles/settings_apply"))),
  ).toBe(false);
  await settings.getByRole("button", { name: "Apply reviewed policy" }).click();
  await expect(settings.getByRole("status")).toContainText("Saved");
});
test("stale group policy cannot overwrite newer permission decisions", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.evaluate(() => {
    window.demoData.profile_settings.revision++;
    window.demoNotify();
  });
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("hikvision-intercom-panel")).toContainText("Group settings changed");
});

test("modern users table contains many configured fields without page overflow", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "modern"),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, true);
  await page.evaluate(() => {
    for (let i = 2; i < 12; i++)
      window.demoData.profile_settings.fields.push({
        id: `field_${i}`,
        label: `שדה נוסף ${i}`,
        enabled: true,
        options: [],
      });
    window.demoNotify();
  });
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
    "data-appearance",
    "modern",
  );
  await expect(page.locator(".desktop-users thead th.custom-user-field")).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/groups-users-modern-he.png", fullPage: true });
});
