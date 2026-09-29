import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, supported = true) {
  await page.goto("/");
  await page.evaluate((enabled) => {
    const w = window as any,
      base = w.demoHass.callWS;
    w.demoData.api.commands = [
      ...w.demoData.api.commands.filter((c: string) => c !== "users/bulk_renewal_preview"),
      ...(enabled ? ["users/bulk_renewal_preview"] : []),
    ];
    w.demoData.default_zone = { kind: "iana", name: "Asia/Jerusalem" };
    w.demoHass.callWS = async function (message: any) {
      if (message.type.endsWith("users/bulk_renewal_preview")) {
        w.calls.push(structuredClone(message));
        return {
          operation_id: "renew-1",
          action: "renew",
          selected: 1,
          changed: 1,
          stations: [],
          rows: [
            {
              user_id: "person-0",
              display_name: "Or Levy",
              employee_no: "1000",
              changed: true,
              stations: [],
              changed_fields: ["valid_until"],
              valid_until_before: "2035-01-01T00:00:00Z",
              valid_until_after: message.until,
            },
          ],
          capacity: [],
        };
      }
      if (message.type.endsWith("users/bulk_apply")) {
        w.calls.push(structuredClone(message));
        return {
          operation_id: message.operation_id,
          action: "bulk/renew",
          saved_at: new Date().toISOString(),
          changed: 1,
          stations: [],
          user_ids: ["person-0"],
        };
      }
      return base.call(this, message);
    };
    w.demoNotify();
  }, supported);
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select user Or Levy", exact: true }).check();
  return page.locator("hikvision-bulk-users");
}

test("renewal converts facility time and stays read-only until explicit confirmation", async ({
  page,
}) => {
  const bulk = await setup(page);
  await bulk.getByRole("combobox", { name: "Group action" }).selectOption("renew");
  await bulk.getByLabel("New expiry", { exact: true }).fill("2036-01-01T12:00");
  await bulk.getByRole("button", { name: "Review group action", exact: true }).click();
  await expect(bulk.locator(".preview")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).calls.find((c: any) => c.type.endsWith("bulk_renewal_preview")).until,
    ),
  ).toBe("2036-01-01T10:00:00.000Z");
  await expect(bulk.getByRole("button", { name: "Apply reviewed action" })).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.type.endsWith("bulk_apply")).length,
    ),
  ).toBe(0);
  await bulk
    .getByRole("checkbox", { name: "I reviewed the selected users and affected stations" })
    .check();
  await bulk.getByRole("button", { name: "Apply reviewed action" }).click();
  await expect(bulk).toContainText("Saved centrally");
});

test("editing expiry discards the reviewed renewal", async ({ page }) => {
  const bulk = await setup(page);
  await bulk.getByRole("combobox", { name: "Group action" }).selectOption("renew");
  await bulk.getByLabel("New expiry", { exact: true }).fill("2036-01-01T12:00");
  await bulk.getByRole("button", { name: "Review group action", exact: true }).click();
  await expect(bulk.locator(".preview")).toBeVisible();
  await bulk.getByLabel("New expiry", { exact: true }).fill("2036-01-02T12:00");
  await expect(bulk.locator(".preview")).toHaveCount(0);
});

test("unsupported backend hides renewal while preserving other bulk actions", async ({ page }) => {
  const bulk = await setup(page, false);
  expect(
    await bulk
      .getByRole("combobox", { name: "Group action" })
      .locator('option[value="renew"]')
      .count(),
  ).toBe(0);
  await expect(
    bulk.getByRole("button", { name: "Review group action", exact: true }),
  ).toBeEnabled();
});
