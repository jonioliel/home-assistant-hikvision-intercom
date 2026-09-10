import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [360, 768, 1440]) {
  test(`reverse permissions show source and applied status at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/?lang=he");
    await page.evaluate(() => {
      const base = window.demoHass.callWS.bind(window.demoHass);
      window.demoHass.callWS = async (message) => {
        if (!message.type.endsWith("permissions/directory")) return base(message);
        window.calls.push(message);
        const u = window.demoData.users[0];
        return {
          total: 1,
          offset: 0,
          limit: 50,
          generated_at: new Date().toISOString(),
          rows: [
            {
              user_id: u.id,
              display_name: u.display_name,
              employee_no: u.employee_no,
              condition: "active",
              doors: [
                {
                  station_id: "station-0",
                  selected: true,
                  allowed: true,
                  override: null,
                  groups: ["הנהלה"],
                  sync_state: "pending",
                  desired_revision: 4,
                  applied_revision: 2,
                },
              ],
            },
          ],
        };
      };
    });
    await navigate(page, "הרשאות לפי דלת");
    const panel = page.locator("hikvision-permission-directory");
    await panel.getByRole("button", { name: "הצגת דוח הרשאות" }).click();
    await expect(panel).toContainText("הנהלה");
    await expect(panel).toContainText("גרסה רצויה");
    await expect(panel).toContainText("גרסה שהוחלה");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/beta-permissions-${width}.png`, fullPage: true });
    await panel.getByRole("button", { name: "עריכה", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

test("bulk profile and membership requests preserve action payload and invalidate edited review", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.profile_settings = {
      revision: 1,
      fields: [{ id: "dept", label: "Department", enabled: true, options: [] }],
      groups: [{ id: "staff", label: "Staff", enabled: true, station_ids: [] }],
      photo_enabled: false,
    };
    window.demoNotify();
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (!message.type.endsWith("users/bulk_preview")) return base(message);
      window.calls.push(message);
      return {
        operation_id: "preview-1",
        action: message.request.action,
        selected: 1,
        changed: 1,
        stations: [],
        rows: [],
        capacity: [],
      };
    };
  });
  await navigate(page, "Users");
  await page.getByRole("checkbox", { name: "Select user Or Levy", exact: true }).check();
  const bulk = page.locator("hikvision-bulk-users");
  await bulk.getByRole("combobox", { name: "Group action", exact: true }).selectOption("profile");
  await bulk.getByRole("combobox", { name: "Field or group" }).selectOption("dept");
  await bulk
    .getByRole("textbox", { name: "New value (blank clears the field)" })
    .fill("Operations");
  await bulk.getByRole("button", { name: "Review group action" }).click();
  expect(await page.evaluate(() => window.calls.at(-1).request.profile)).toEqual({
    dept: "Operations",
  });
  await bulk.getByRole("combobox", { name: "Group action", exact: true }).selectOption("group_add");
  await expect(bulk.locator(".preview")).toHaveCount(0);
  await bulk.getByRole("combobox", { name: "Field or group" }).selectOption("staff");
  await bulk.getByRole("button", { name: "Review group action" }).click();
  const payload = await page.evaluate(() => window.calls.at(-1).request);
  expect(payload.group_ids).toEqual(["staff"]);
  expect(payload.profile).toBeUndefined();
});

test("typed fields and onboarding defaults only populate a new draft", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.profile_settings = {
      revision: 1,
      photo_enabled: false,
      fields: [
        {
          id: "dept",
          label: "Department",
          enabled: true,
          type: "select",
          required: true,
          options: ["Staff", "Maintenance"],
        },
        {
          id: "arrival",
          label: "Arrival",
          enabled: true,
          type: "date",
          required: false,
          options: [],
        },
      ],
      groups: [{ id: "staff", label: "Staff", enabled: true, station_ids: ["station-0"] }],
      templates: [
        {
          id: "employee",
          label: "New employee",
          enabled: true,
          profile: { dept: "Staff", arrival: "2026-09-11" },
          group_ids: ["staff"],
        },
      ],
    };
    window.demoNotify();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Onboarding template", exact: true })
    .selectOption("employee");
  await dialog.getByRole("button", { name: "Apply defaults to draft" }).click();
  await expect(dialog.getByRole("combobox", { name: /Department/ })).toHaveValue("Staff");
  await expect(dialog.getByLabel("Arrival", { exact: true })).toHaveValue("2026-09-11");
  await expect(
    dialog.locator(".assignment").filter({ hasText: "Main gate" }).getByRole("checkbox"),
  ).toBeChecked();
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/create")).length),
  ).toBe(0);
  await dialog.getByLabel("Name", { exact: true }).fill("New employee example");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const data = await page.evaluate(
    () => window.calls.find((c) => c.type.endsWith("users/create")).data,
  );
  expect(data.profile).toEqual({ dept: "Staff", arrival: "2026-09-11" });
  expect(data.group_ids).toEqual(["staff"]);
  expect(data.pin).toBeUndefined();
  expect(data.cards).toEqual([]);
  expect(data.photo).toBeUndefined();
});
