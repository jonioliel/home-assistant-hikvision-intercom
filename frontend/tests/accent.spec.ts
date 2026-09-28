import { test, expect } from "@playwright/test";
import { openAppearance } from "./navigation";

for (const design of ["WisKey · light", "WisKey · dark"]) {
  test(`leading color persists without changing semantic status: ${design}`, async ({ page }) => {
    await page.goto("/");
    await openAppearance(page);
    const picker = page.locator("hikvision-appearance-picker");
    // Theme names are localized in the same existing picker.
    const value = design.endsWith("dark") ? "wiskey-dark" : "wiskey-light";
    await picker.locator(`input[name=appearance][value=${value}]`).check();
    await picker.getByRole("radio", { name: "Blue", exact: true }).check();
    await picker.getByRole("button", { name: "Apply design" }).click();
    const panel = page.locator("hikvision-intercom-panel");
    await expect(panel).toHaveAttribute("data-accent", "blue");
    const colors = await panel.evaluate((el) => ({
      accent: getComputedStyle(el).getPropertyValue("--wk4-accent").trim(),
      error: getComputedStyle(el).getPropertyValue("--wk4-red").trim(),
    }));
    expect(colors.accent).toBe(value === "wiskey-dark" ? "#a9c7ff" : "#235abb");
    expect(colors.error).toBe(value === "wiskey-dark" ? "#ffb2b7" : "#b84045");
    await page.reload();
    await expect(panel).toHaveAttribute("data-accent", "blue");
  });
}

test("shared accent follows default on first load, invalid browser value ignored", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("hikvision-intercom:accent:v1:demo-admin", "url(secret)"),
  );
  await page.goto("/?shared-accent");
  const panel = page.locator("hikvision-intercom-panel");
  await expect(panel).toHaveAttribute("data-accent", "purple");
  await expect(panel).toHaveAttribute("data-appearance", "wiskey-dark");
  await page.reload();
  await expect(panel).toHaveAttribute("data-accent", "purple");
});
