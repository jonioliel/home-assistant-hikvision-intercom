import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
for (const width of [390, 1440]) {
  test(`station reader is in Cards beside USB at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/?lang=he");
    await navigate(page, "משתמשים");
    await page.getByRole("button", { name: "עריכה", exact: true }).first().click();
    const cards = page.locator(".editor-cards");
    const read = cards.getByRole("button", { name: "קריאת כרטיס מהאינטרקום", exact: true });
    await expect(read).toBeEnabled();
    await expect(cards.locator("wiskey-usb-card-input")).toBeVisible();
    await read.click();
    await expect(page.getByRole("dialog").locator("select").first()).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => c.type.endsWith("cards/reader_capabilities")),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.calls.some((c) => c.type.endsWith("cards/capture_start"))),
    ).toBe(false);
  });
}
test("new user explains save-first and unsaved edits cannot start capture", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(
    page.locator(".editor-cards").getByRole("button", { name: "Read card from station" }),
  ).toBeDisabled();
  await expect(page.locator(".editor-cards")).toContainText("Save the new user first");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Changed name");
  await page
    .locator(".editor-cards")
    .getByRole("button", { name: "Read card from station" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Save or discard your edits");
  await expect(page.getByRole("dialog").getByLabel("Name", { exact: true })).toHaveValue(
    "Changed name",
  );
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => c.type.endsWith("cards/reader_capabilities")),
    ),
  ).toBe(false);
});
