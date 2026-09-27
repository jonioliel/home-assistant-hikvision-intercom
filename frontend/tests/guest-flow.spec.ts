import { test, expect } from "@playwright/test";

test("temporary access uses the existing user creation and synchronization path", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "wiskey-light"),
  );
  await page.goto("/?lang=he");
  await page.locator(".nav").getByRole("button", { name: "אנשים", exact: true }).click();
  await page.getByRole("button", { name: /הקמת גישה זמנית/ }).click();
  const dialog = page.locator(".editor-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("שם", { exact: true }).fill("אורח זמני");
  await dialog.getByRole("button", { name: "המשך: דלתות" }).click();
  await expect(dialog.getByRole("alert")).toContainText("PIN או כרטיס");
  await dialog.getByRole("button", { name: "יצירת PIN ייחודי אוטומטית" }).click();
  await dialog.getByRole("button", { name: "המשך: דלתות" }).click();
  await expect(dialog.getByText("דלתות מורשות")).toBeVisible();
  await dialog.getByRole("button", { name: "יצירה וסנכרון" }).click();
  await expect(dialog.getByRole("alert")).toContainText("דלת מורשית");
  await dialog.locator('.assignment-list input[type="checkbox"]').first().check();
  await dialog.getByRole("button", { name: "יצירה וסנכרון" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.filter((call) => call.type.endsWith("users/create")).length),
    )
    .toBe(1);
  const call = await page.evaluate(() =>
    window.calls.find((item) => item.type.endsWith("users/create")),
  );
  expect(call.sync_now).toBe(true);
  expect(call.data.display_name).toBe("אורח זמני");
  expect(Date.parse(call.data.valid_until)).toBeGreaterThan(Date.parse(call.data.valid_from));
  expect(call.data.pin).toBe("482615");
  expect(Object.values(call.data.door_permissions ?? {}).length).toBe(1);
});
