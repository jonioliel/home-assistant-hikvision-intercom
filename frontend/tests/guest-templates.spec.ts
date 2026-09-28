import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("preset management requires explicit save and deletion keeps users untouched", async ({
  page,
}) => {
  await page.goto("/?guest-templates=1");
  const users = await page.evaluate(() => structuredClone(window.demoData.users));
  await navigate(page, "Visit templates");
  const view = page.locator("wiskey-guest-templates");
  await expect(view.getByRole("heading", { name: "Weekly maintenance" })).toBeVisible();
  await view.getByRole("button", { name: "Add visit template" }).click();
  const editor = view.getByRole("region", { name: "Edit visit template" });
  await editor.getByLabel("Template name", { exact: true }).fill("Short visit");
  await editor.getByLabel("Responsible person", { exact: true }).fill("Reception");
  await editor.getByLabel("Visit duration in minutes (15–43200)", { exact: true }).fill("45");
  await editor.locator(".door").filter({ hasText: "Main gate" }).getByRole("checkbox").check();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("guest_templates/upsert")).length,
    ),
  ).toBe(0);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(view.getByRole("status")).toContainText("Visit template saved");
  const card = view.locator("article").filter({ hasText: "Short visit" });
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.getByLabel("Visit duration in minutes (15–43200)").fill("90");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card).toContainText("90 minutes");
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card.getByText("Delete this template?", { exact: false })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("guest_templates/delete")).length,
    ),
  ).toBe(0);
  await card.getByRole("button", { name: "Confirm template deletion" }).click();
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => window.demoData.users)).toEqual(users);
});

test("applying a preset changes only reviewed access inputs and never sends messages", async ({
  page,
}) => {
  await page.goto("/?guest-templates=1");
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Create temporary access", exact: false }).click();
  const dialog = page.locator("hikvision-intercom-panel").getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Guest identity");
  await dialog.getByLabel("Mobile phone", { exact: true }).fill("050-123-4567");
  await dialog.getByLabel("PIN", { exact: true }).fill("654321");
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill("654321");
  const picker = dialog.locator("wiskey-guest-templates");
  await picker.getByRole("combobox").selectOption("a".repeat(32));
  await expect(dialog.getByLabel("Responsible person", { exact: true })).toHaveValue("");
  await picker.getByRole("button", { name: "Apply template" }).click();
  await expect(dialog.getByLabel("Responsible person", { exact: true })).toHaveValue("Facilities");
  await expect(dialog.getByLabel("Purpose of access", { exact: true })).toHaveValue("Inspection");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Guest identity");
  await expect(dialog.getByLabel("Mobile phone", { exact: true })).toHaveValue("050-123-4567");
  await expect(dialog.getByLabel("PIN", { exact: true })).toHaveValue("654321");
  const draft = await page
    .locator("hikvision-intercom-panel")
    .evaluate((element) => structuredClone(element._draft));
  expect(draft.assignments).toEqual({
    "station-0": { enabled: true, allowed_locks: [1], sync_state: "pending" },
    "station-1": { enabled: true, allowed_locks: [1], sync_state: "pending" },
  });
  expect(Date.parse(draft.valid_until) - Date.parse(draft.valid_from)).toBe(180 * 60000);
  expect(draft.access_timing_draft.days).toEqual(["Monday", "Thursday"]);
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((call) => /users\/(create|update)|whatsapp\/send/.test(call.type))
          .length,
    ),
  ).toBe(0);
});

test("stale configuration blocks a template instead of silently dropping a door", async ({
  page,
}) => {
  await page.goto("/?guest-templates=1");
  await page.evaluate(() => {
    window.guestTemplates.items[0].doors.missing = [1];
  });
  await navigate(page, "Visit templates");
  const view = page.locator("wiskey-guest-templates");
  await expect(
    view.getByText("A template door is no longer configured", { exact: false }),
  ).toBeVisible();
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Create temporary access", exact: false }).click();
  const picker = page.locator("wiskey-guest-templates[picker]");
  await picker.getByRole("combobox").selectOption("a".repeat(32));
  await expect(picker.getByRole("button", { name: "Apply template" })).toBeDisabled();
});

test("concurrent preset edit does not overwrite and requires a reload", async ({ page }) => {
  await page.goto("/?guest-templates=1");
  await navigate(page, "Visit templates");
  const view = page.locator("wiskey-guest-templates");
  await view.getByRole("button", { name: "Edit", exact: true }).click();
  await view.getByLabel("Template name", { exact: true }).fill("Changed label");
  await page.evaluate(() => window.guestTemplates.revision++);
  await view.getByRole("button", { name: "Save", exact: true }).click();
  await expect(view.getByRole("alert")).toContainText("changed while you were editing");
  await expect(view.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.guestTemplates.items[0].label)).toBe(
    "Weekly maintenance",
  );
});

test("delegated template viewer sees data without mutation and Hebrew mobile fits", async ({
  page,
}) => {
  await page.goto("/?guest-templates=1&reader=1&grant=users:view,management:view");
  await navigate(page, "Visit templates");
  const view = page.locator("wiskey-guest-templates");
  await expect(view.getByRole("heading", { name: "Weekly maintenance" })).toBeVisible();
  await expect(view.getByRole("button", { name: "Add visit template" })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?guest-templates=1&lang=he");
  await navigate(page, "תבניות ביקור");
  await view.getByRole("button", { name: "הוספת תבנית ביקור" }).click();
  expect(await view.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
