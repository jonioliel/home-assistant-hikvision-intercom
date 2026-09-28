import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation";

test("account filters retain edits to hidden operators when saving the full grant map", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.evaluate(() => {
    const base = window.demoHass.callWS;
    window.demoHass.callWS = async function (message) {
      const result = await base.call(this, message);
      if (
        message.type.endsWith("authorization/settings_get") ||
        message.type.endsWith("authorization/settings_update")
      ) {
        result.directory.push({
          id: "technician",
          name: "Technician",
          active: true,
          admin: false,
          owner: false,
        });
        if (message.type.endsWith("authorization/settings_get"))
          result.users.technician = {
            enabled: true,
            areas: {
              overview: "view",
              users: "none",
              events: "view",
              stations: "manage",
              management: "none",
            },
            station_ids: ["station-0"],
            fields: {
              phone: "manage",
              photo: "manage",
              credentials: "manage",
              profile: "manage",
              access: "manage",
            },
          };
      }
      return result;
    };
  });
  await navigate(page, "הרשאות משתמשי תשתית המערכת");
  const view = page.locator("wiskey-access-control");
  await expect(view.locator("article")).toHaveCount(3);
  await view.getByLabel("גישה לחשבון", { exact: true }).selectOption("denied");
  await expect(view.locator("article")).toHaveCount(1);
  await view.getByLabel("תבנית תפקיד עבור Reception").selectOption("security");
  await expect(view.locator("article")).toHaveCount(0);
  await expect(view.getByText("אין חשבונות התואמים לחיפוש ולסינון.")).toBeVisible();
  await view.getByLabel("גישה לחשבון", { exact: true }).selectOption("restricted");
  await expect(view.locator("article")).toHaveCount(1);
  await expect(view.locator("article")).toContainText("Technician");
  await view.getByRole("searchbox", { name: "חיפוש חשבון" }).fill("missing account");
  await expect(view.locator("article")).toHaveCount(0);
  await view.getByRole("searchbox", { name: "חיפוש חשבון" }).fill("tech");
  await expect(view.locator("article")).toHaveCount(1);
  expect(
    await view.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await view.getByRole("button", { name: "שמירת הרשאות" }).click();
  await expect(view.getByRole("status")).toContainText("ההרשאות נשמרו והוחלו מיד.");
  const saved = await page.evaluate(
    () => window.calls.find((call) => call.type.endsWith("authorization/settings_update")).users,
  );
  expect(saved["reader-user"].areas.overview).toBe("manage");
  expect(saved["reader-user"].areas.users).toBe("view");
  expect(saved.technician.station_ids).toEqual(["station-0"]);
  await view.getByRole("searchbox", { name: "חיפוש חשבון" }).fill("");
  await view.getByLabel("גישה לחשבון", { exact: true }).selectOption("granted");
  await expect(view.locator("article")).toHaveCount(3);
});

async function scopedOperator(page: Page, shared = false) {
  await page.goto(
    "/?reader=1&grant=overview:manage,users:manage,events:view,stations:view,management:view",
  );
  await page.evaluate((shared) => {
    const data = window.demoData;
    data.access.station_ids = ["station-0"];
    data.access.fields = {
      phone: "view",
      photo: "view",
      credentials: "none",
      profile: "view",
      access: "view",
    };
    data.api.commands = [
      "overview",
      "users/get",
      "users/list",
      "users/update",
      "stations/list",
      "stations/get",
      "profiles/settings_get",
      "events/list",
    ];
    data.stations = data.stations.slice(0, 1);
    data.users = data.users.slice(0, 1);
    const user = data.users[0];
    user.phone = "050-123-4567";
    user.pin_configured = false;
    user.cards = [];
    user.redacted_fields = ["credentials"];
    user.operator_editable = !shared;
    user.assignments = { "station-0": user.assignments["station-0"] };
    window.demoNotify();
  }, shared);
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
}

for (const width of [1440, 390]) {
  test(`administrator edits station and field scopes without expanding them through presets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?lang=he");
    await page.getByRole("button", { name: "כלי ניהול", exact: true }).click();
    await page.getByRole("button", { name: /הרשאות משתמשי תשתית המערכת/ }).click();
    const operator = page.locator("wiskey-access-control article").filter({ hasText: "Reception" });
    await operator.getByLabel("תבנית תפקיד עבור Reception").selectOption("personnel");
    await operator.locator(".scope-editor > summary").click();
    await operator.getByRole("checkbox", { name: "גישה לכל התחנות הקיימות והעתידיות" }).uncheck();
    await operator.getByRole("checkbox", { name: "שער ראשי", exact: true }).check();
    await operator.getByLabel("טלפון ליצירת קשר", { exact: true }).selectOption("view");
    await operator.getByLabel("קוד אישי וכרטיסים", { exact: true }).selectOption("none");
    await operator.getByLabel("תבנית תפקיד עבור Reception").selectOption("security");
    await expect(operator.getByRole("checkbox", { name: "שער ראשי", exact: true })).toBeChecked();
    await expect(operator.getByLabel("טלפון ליצירת קשר", { exact: true })).toHaveValue("view");
    await expect(operator.getByLabel("קוד אישי וכרטיסים", { exact: true })).toHaveValue("none");
    expect(
      await operator.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await operator.getByRole("button", { name: "תצוגה מקדימה של ההרשאות" }).click();
    const preview = operator.locator(".permission-preview");
    for (const [label, allowed] of [
      ["קריאת כרטיס מהתחנה למשתמש", "false"],
      ["ניהול תקופות תחזוקה והתראות", "false"],
      ["סנכרון שעוני תחנות", "false"],
      ["הקראת הודעה בתחנה", "true"],
    ])
      await expect(preview.locator("span").filter({ hasText: label })).toHaveAttribute(
        "data-allowed",
        allowed,
      );
    await page.getByRole("button", { name: "שמירת הרשאות" }).click();
    await expect(page.getByText("ההרשאות נשמרו והוחלו מיד.")).toBeVisible();
    const saved = await page.evaluate(
      () =>
        window.calls.find((call) => call.type.endsWith("authorization/settings_update")).users[
          "reader-user"
        ],
    );
    expect(saved.station_ids).toEqual(["station-0"]);
    expect(saved.fields.phone).toBe("view");
    expect(saved.fields.credentials).toBe("none");
  });
}

test("read-only person fields stay disabled and are omitted from a name edit", async ({ page }) => {
  await scopedOperator(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Mobile phone", { exact: true })).toBeDisabled();
  await expect(dialog.locator("fieldset.editor-pin")).toBeHidden();
  await expect(dialog.locator("fieldset.editor-cards")).toBeHidden();
  await expect(dialog.locator("fieldset.editor-validity")).toHaveAttribute("disabled", "");
  await dialog.getByLabel("Name", { exact: true }).fill("Renamed operator person");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const patch = await page.evaluate(
    () => window.calls.filter((call) => call.type.endsWith("users/update")).at(-1).data,
  );
  expect(patch.display_name).toBe("Renamed operator person");
  for (const field of [
    "phone",
    "photo",
    "pin",
    "cards",
    "profile",
    "assignments",
    "valid_from",
    "valid_until",
    "group_ids",
    "access_timing_policy",
    "access_timing_draft",
  ])
    expect(patch).not.toHaveProperty(field);
});

test("shared person stays view-only and restricted tools do not offer global operations", async ({
  page,
}) => {
  await scopedOperator(page, true);
  await expect(page.getByRole("button", { name: "Edit", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "+ Add user", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Management tools", exact: true }).click();
  await expect(page.getByRole("button", { name: "Users", exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Time & NTP", exact: true })).toHaveCount(0);
  await expect(page.locator("wiskey-investigations")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Media & audio", exact: true })).toHaveCount(0);
});

test("permission refresh closes person details and discards a delayed detail response", async ({
  page,
}) => {
  await scopedOperator(page);
  await page.evaluate(() => {
    const base = window.demoHass.callWS;
    window.releaseDetail = undefined;
    window.demoHass.callWS = async function (message) {
      if (message.type.endsWith("users/get")) {
        const result = await base.call(this, message);
        return new Promise((resolve) => {
          window.releaseDetail = () => resolve(result);
        });
      }
      return base.call(this, message);
    };
  });
  await page.getByRole("button", { name: "Or Levy", exact: true }).click();
  await expect(page.locator("wiskey-user-details").getByRole("dialog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.releaseDetail)).toBe(true);
  await page.evaluate(() => {
    window.demoData.access.fields.phone = "none";
    window.demoData.access.revision++;
    window.demoData.users[0].phone = "";
    window.demoData.users[0].redacted_fields.push("phone");
    window.demoNotify();
  });
  await expect(page.locator("wiskey-user-details")).toHaveCount(0);
  await page.evaluate(() => window.releaseDetail());
  await page.getByRole("button", { name: "Or Levy", exact: true }).click();
  await expect(page.locator("wiskey-user-details")).not.toContainText("050-123-4567");
  expect(
    await page.evaluate(() => document.querySelector("hikvision-intercom-panel").detailCache.size),
  ).toBe(0);
});

test("scoped station operator keeps the alert and maintenance workflow", async ({ page }) => {
  await page.goto("/?reader=1&grant=stations:manage,management:view&fleet-alerts=1");
  await page.evaluate(() => {
    window.demoData.access.station_ids = ["station-0"];
    window.demoData.access.fields = {
      phone: "none",
      photo: "none",
      credentials: "none",
      profile: "none",
      access: "none",
    };
    window.demoData.api.commands = [
      "overview",
      "stations/list",
      "stations/get",
      "fleet/alerts",
      "fleet/alerts_action",
    ];
    window.demoData.stations = window.demoData.stations.slice(0, 1);
    window.fleetAlerts.items = window.fleetAlerts.items.filter(
      (item) => item.station_id === "station-0",
    );
    window.demoNotify();
  });
  await navigate(page, "Station alerts");
  const view = page.locator("wiskey-fleet-alerts");
  await expect(view.locator("article")).toHaveCount(1);
  await view
    .getByRole("combobox", { name: "Station maintenance", exact: true })
    .selectOption("station-0");
  await view.getByRole("button", { name: "Set maintenance period" }).click();
  await view.getByRole("button", { name: "Confirm suppression" }).click();
  await expect(view.getByRole("status")).toContainText("Device operation was preserved");
  const write = await page.evaluate(() =>
    window.calls.filter((call) => call.type.endsWith("fleet/alerts_action")).at(-1),
  );
  expect(write.station_id).toBe("station-0");
  expect(write.kind).toBe("maintenance");
});
