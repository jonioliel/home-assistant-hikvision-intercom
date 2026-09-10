import { type Page } from "@playwright/test";
/** Use the same management hub navigation as an administrator, in either language. */
export async function navigate(page: Page, name: string) {
  const direct = page.locator(".nav").getByRole("button", { name, exact: true });
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await page
    .locator(".nav")
    .getByRole("button", { name: /^(Management tools|כלי ניהול)$/ })
    .click();
  await page.locator(".tools-grid").getByRole("button", { name, exact: true }).click();
}
export async function openAppearance(page: Page) {
  await page
    .locator(".nav")
    .getByRole("button", { name: /^(Management tools|כלי ניהול)$/ })
    .click();
  await page.locator(".tools-grid .appearance-button").click();
}
