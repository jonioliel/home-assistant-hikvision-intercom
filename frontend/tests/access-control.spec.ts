import { expect, test } from "@playwright/test";

test("delegated viewer sees only granted screens and no door controls", async ({ page }) => {
  await page.goto("/?reader=1&grant=overview:view,users:view");
  await expect(page.getByRole("heading", { name: "Doors & cameras" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Events" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Management tools" })).toHaveCount(0);
  await expect(
    page.getByText("View-only access: changes and control actions are disabled for this area."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Open/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View camera/ }).first()).toBeVisible();
});

test("administrator can configure HA user permissions responsively", async ({ page }) => {
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "כלי ניהול" }).click();
  await page.getByRole("button", { name: /הרשאות משתמשי HA/ }).click();
  await expect(page.getByRole("heading", { name: "הרשאות משתמשי Home Assistant" })).toBeVisible();
  const reception = page.locator("wiskey-access-control article").filter({ hasText: "Reception" });
  await reception.getByRole("checkbox").check();
  await reception.getByLabel("משתמשים").selectOption("manage");
  await page.getByRole("button", { name: "שמירת הרשאות" }).click();
  await expect(page.getByText("ההרשאות נשמרו והוחלו מיד.")).toBeVisible();
  const update = await page.evaluate(() =>
    window.calls.find(
      (call) => call.type === "smplwise_access_control/authorization/settings_update",
    ),
  );
  expect(update.users["reader-user"].enabled).toBe(true);
  expect(update.users["reader-user"].areas.users).toBe("manage");
});
