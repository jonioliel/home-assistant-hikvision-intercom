import { test, expect } from "@playwright/test";

test("empty filters recover without claiming the user database is empty", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.locator("details.user-filters > summary").click();
  await page.getByRole("combobox", { name: "Sort users" }).selectOption("name");
  await page.getByRole("checkbox", { name: "Select user Or Levy", exact: true }).check();
  await page.getByRole("combobox", { name: "Filter by user state" }).selectOption("upcoming");
  await expect(page.getByRole("heading", { name: "No matching people." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your central user list is empty." })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(6);
  await expect(page.getByRole("combobox", { name: "Sort users" })).toHaveValue("name");
  await expect(page.locator(".desktop-users .user-selection:checked")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear search and filters" })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) =>
        /users\/(create|update|set_active|delete)$/.test(c.type),
      ),
    ),
  ).toBe(false);
});

for (const [name, width, language, dark] of [
  ["desktop-he", 1440, "he", false],
  ["desktop-dark", 1440, "en", true],
  ["mobile-he", 390, "he", false],
] as const) {
  test(`users layout and device card padding: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`/?lang=${language}${dark ? "&dark=1" : ""}`);
    await page
      .getByRole("button", { name: language === "he" ? "משתמשים" : "Users", exact: true })
      .click();
    await expect(page.locator(".users-heading .primary")).toBeInViewport();
    expect(
      await page.locator(".app-shell").evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/users-${name}.png`, fullPage: true });
    await page
      .getByRole("button", { name: language === "he" ? "אינטרקומים" : "Intercoms", exact: true })
      .click();
    const card = page.locator("article.station").first();
    expect(
      await card.evaluate((el) => parseFloat(getComputedStyle(el).paddingInlineStart)),
    ).toBeGreaterThanOrEqual(16);
    await expect(card.getByRole("heading", { level: 3 })).toBeVisible();
  });
}
