import { test, expect } from "@playwright/test";

test("overview shows HA cameras and only enabled online release buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Intercom Manager" })).toBeVisible();
  await expect(page.locator("article.station")).toHaveCount(9);
  await expect(page.getByRole("button", { name: "Open active lock" })).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Open active lock", exact: true }).nth(5),
  ).toBeDisabled();
  await expect(page.locator("article.station").first()).toHaveClass(/ringing/);
  await expect(page.locator("hikvision-intercom-camera img").first()).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.includes("unlock"))),
  ).toBeFalsy();
  await page.screenshot({ path: "test-results/overview-en.png", fullPage: true });
});

test("Hebrew mobile users are RTL cards without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "משתמשים", exact: true }).click();
  await expect(page.locator(".mobile-users")).toBeVisible();
  await expect(page.locator(".desktop-users")).toBeHidden();
  const overflow = await page
    .locator("hikvision-intercom-panel")
    .evaluate((element) => element.shadowRoot.querySelector("main").scrollWidth > 390);
  expect(overflow).toBeFalsy();
  await expect(
    page.locator("hikvision-intercom-panel").locator("div[dir]").first(),
  ).toHaveAttribute("dir", "rtl");
  await page.screenshot({ path: "test-results/users-he-mobile.png", fullPage: true });
});

test("create user sends a PIN once and clears it from the editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("New resident");
  await dialog.getByLabel("New PIN", { exact: true }).fill("847291");
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill("847291");
  await dialog.getByLabel("Main gate", { exact: false }).check();
  await dialog.getByRole("button", { name: "Save & sync" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("New resident", { exact: true }).first()).toBeVisible();
  const calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("users/create")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].data.pin).toBe("847291");
  await page
    .getByRole("row")
    .filter({ hasText: "New resident" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByLabel("New PIN", { exact: true })).toHaveValue("");
  await expect(page.getByRole("dialog").getByLabel("Confirm PIN", { exact: true })).toHaveValue("");
});

test("mismatching PINs do not send changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Mismatch");
  await dialog.getByLabel("New PIN", { exact: true }).fill("847291");
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill("123478");
  await dialog.getByRole("button", { name: "Save & sync" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The PIN entries do not match.");
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.endsWith("users/create"))),
  ).toBeFalsy();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByRole("dialog").getByLabel("New PIN", { exact: true })).toHaveValue("");
});

test("existing cards stay masked during edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Masked", { exact: true })).toHaveValue(
    "•••• 4821",
  );
  await expect(page.getByRole("dialog").getByLabel("Employee ID", { exact: true })).toBeDisabled();
});

test("delete requires explicit confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("2 station(s)");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.endsWith("users/delete"))),
  ).toBeFalsy();
});

test("import and conflict inspection are available", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Import existing" }).click();
  await expect(
    page.getByRole("dialog").getByText("Existing resident", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await page.getByRole("button", { name: "Conflict", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Name changed on station", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/conflict-en.png", fullPage: true });
});

test("reader has no administrative data or subscription", async ({ page }) => {
  await page.goto("/?reader=1");
  await expect(page.getByText("Administrator access is required.")).toBeVisible();
  expect(await page.evaluate(() => window.calls)).toHaveLength(0);
});

test("empty and dark layouts render without application errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?empty=1&dark=1");
  await expect(page.getByText("Add your first intercom in Home Assistant settings.")).toBeVisible();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page.getByText("Your central user list is empty.")).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/empty-dark.png", fullPage: true });
});
