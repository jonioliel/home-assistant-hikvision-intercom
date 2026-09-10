import { test, expect } from "@playwright/test";

for (const [name, width, lang, dark] of [
  ["desktop-he", 1440, "he", false],
  ["desktop-en-dark", 1440, "en", true],
  ["tablet-he-dark", 768, "he", true],
  ["mobile-he", 390, "he", false],
] as const) {
  test(`interface overview and editor remain usable: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`/?lang=${lang}${dark ? "&dark=1" : ""}`);
    const shell = page.locator(".app-shell");
    await expect(shell).toBeVisible();
    expect(await shell.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator(".nav-primary button")).toHaveCount(4);
    await expect(page.locator(".nav-secondary button")).toHaveCount(0);
    const station = page.locator("article.station").first();
    const action = await station.locator(".door-action").boundingBox();
    const history = await station.locator(".last-access").boundingBox();
    expect(action!.y + action!.height).toBeLessThan(history!.y);
    await page.screenshot({ path: `test-results/interface-${name}.png`, fullPage: true });
    await page
      .getByRole("button", { name: lang === "he" ? "משתמשים" : "Users", exact: true })
      .click();
    await page.getByRole("button", { name: lang === "he" ? "הוספת משתמש" : "Add user" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveClass(/editor-dialog/);
    await dialog
      .getByLabel(lang === "he" ? "שם" : "Name", { exact: true })
      .fill("Interface preview");
    await expect(page.locator(".editor-summary strong")).toHaveText("Interface preview");
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(
      dialog.getByRole("button", {
        name: lang === "he" ? "שמירה וסנכרון" : "Save & sync",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/editor-${name}.png`, fullPage: true });
    await dialog
      .getByRole("button", { name: lang === "he" ? "ביטול" : "Cancel", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as any).calls.some((c: any) => /users\/(create|update)$/.test(c.type)),
      ),
    ).toBe(false);
  });
}
