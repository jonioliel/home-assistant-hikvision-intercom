import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [390, 1440]) {
  test(`archive confirmation and inactive restoration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?people-archive");
    await navigate(page, "Users");
    const link = page
      .locator(width < 700 ? ".mobile-users .user-detail-link" : ".desktop-users .user-detail-link")
      .first();
    const initialCount = await page.evaluate(() => window.demoData.users.length);
    await link.click();
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "Archive person", exact: true }).click();
    expect(
      await page.evaluate(
        () => window.calls.filter((c) => c.type.endsWith("users/archive")).length,
      ),
    ).toBe(0);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Archive person", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.demoData.users.filter((u) => !!u.archived_at).length))
      .toBe(1);
    expect(await page.evaluate(() => window.demoData.users.length)).toBe(initialCount);
    await page.locator(".user-filters summary").click();
    await page.getByLabel("Filter by user state").selectOption("archived");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("dialog")).toContainText("Archived");
    page.once("dialog", (d) => {
      expect(d.message()).toContain("inactive");
      return d.accept();
    });
    await page.getByRole("button", { name: "Restore from archive", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.demoData.users.filter((u) => !!u.archived_at).length))
      .toBe(0);
    const restored = await page.evaluate(() => window.demoData.users[0]);
    expect(restored.active).toBe(false);
    expect(restored.assignments).not.toEqual({});
  });
}

test("old servers keep existing details without unsupported archive actions", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Users");
  await page.locator(".desktop-users .user-detail-link").first().click();
  await expect(page.getByRole("button", { name: "Archive person", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true }).last()).toBeVisible();
});

test("archived editor cannot silently reactivate the retained identity", async ({ page }) => {
  await page.goto("/?people-archive");
  await page.evaluate(() => {
    window.demoData.users[0].archived_at = new Date().toISOString();
    window.demoData.users[0].active = false;
    window.demoNotify();
  });
  await navigate(page, "Users");
  await page.locator(".user-filters summary").click();
  await page.getByLabel("Filter by user state").selectOption("archived");
  await page.locator(".desktop-users .user-detail-link").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("checkbox", { name: "Active", exact: true }),
  ).toBeDisabled();
});
