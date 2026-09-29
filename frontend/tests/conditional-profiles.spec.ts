import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [390, 1440]) {
  test(`conditional edit preserves inactive data and validates activation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      window.demoData.profile_settings.fields = [
        { id: "role", label: "Role", enabled: true, options: ["visitor", "staff"], type: "select" },
        {
          id: "badge",
          label: "Badge",
          enabled: true,
          options: [],
          type: "number",
          required: true,
          depends_on: { field_id: "role", value: "staff" },
        },
      ];
      window.demoData.users[0].profile = { role: "visitor", badge: "legacy" };
      window.demoNotify();
    });
    await navigate(page, "Users");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: /^Badge/ })).toHaveCount(0);
    await dialog.getByRole("combobox", { name: "Role", exact: true }).selectOption("staff");
    await expect(dialog.getByRole("combobox", { name: /^Badge/ })).toHaveValue("legacy");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update"))),
    ).toBe(false);
    await dialog.getByRole("combobox", { name: /^Badge/ }).fill("2");
    await dialog.getByRole("combobox", { name: "Role", exact: true }).selectOption("visitor");
    await expect(dialog.getByRole("combobox", { name: /^Badge/ })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const saved = await page.evaluate(
      () => window.calls.find((c) => c.type.endsWith("users/update"))?.data.profile,
    );
    expect(saved).toEqual({ role: "visitor", badge: "2" });
  });
}

test("settings store an explicit predicate and unknown applicability remains read-only", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.profile_settings.fields = [
      { id: "role", label: "Role", enabled: true, options: [] },
      { id: "badge", label: "Badge", enabled: true, options: [] },
    ];
    window.demoNotify();
  });
  await navigate(page, "User profile options");
  const settings = page.locator("hikvision-profile-settings");
  await settings
    .getByRole("combobox", { name: "Show when field", exact: true })
    .nth(1)
    .selectOption("role");
  await settings.getByLabel("Equals exactly", { exact: true }).fill("staff");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("Saved");
  expect(await page.evaluate(() => window.demoData.profile_settings.fields[1].depends_on)).toEqual({
    field_id: "role",
    value: "staff",
  });
  await page.evaluate(() => {
    window.demoData.profile_settings.fields = [
      { id: "badge", label: "Badge", enabled: true, options: [], applicability_unknown: true },
    ];
    window.demoData.users[0].profile = { badge: "private-context" };
    window.demoNotify();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: /^Badge/ })).toBeDisabled();
  await expect(dialog).toContainText("outside your viewing permissions");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await page.evaluate(
    () => window.calls.find((c) => c.type.endsWith("users/update"))?.data.profile,
  );
  expect(saved).toEqual({});
});

test("text predicates and required values follow stored whitespace normalization", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.profile_settings.fields = [
      { id: "role", label: "Role", enabled: true, options: [] },
      {
        id: "badge",
        label: "Badge",
        enabled: true,
        options: [],
        required: true,
        depends_on: { field_id: "role", value: "staff" },
      },
    ];
    window.demoData.users[0].profile = { role: "visitor", badge: "" };
    window.demoNotify();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Role", exact: true }).fill(" staff ");
  const badge = dialog.getByRole("combobox", { name: /^Badge/ });
  await expect(badge).toBeVisible();
  await badge.fill("   ");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update")))).toBe(
    false,
  );
  await badge.fill("complete");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
