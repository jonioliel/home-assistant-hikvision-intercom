import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [360, 768, 1440]) {
  test(`camera wall enforces stream budget and suspends for a single camera at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?lang=he");
    await navigate(page, "קיר מצלמות חי");
    const wall = page.locator("wiskey-camera-wall");
    await expect(wall.locator("hikvision-intercom-camera")).toHaveCount(4);
    expect(
      await wall
        .locator("hikvision-intercom-camera")
        .evaluateAll((els) => els.some((el) => el.live)),
    ).toBe(false);
    await wall.getByRole("button", { name: "הפעל קיר מצלמות" }).click();
    expect(
      await wall
        .locator("hikvision-intercom-camera")
        .evaluateAll((els) => els.every((el) => el.live)),
    ).toBe(true);
    await wall.getByRole("combobox", { name: "מספר זרמים מרבי" }).selectOption("9");
    await wall.locator("summary").click();
    for (const checkbox of await wall.getByRole("checkbox").all()) await checkbox.check();
    await expect(wall.locator("hikvision-intercom-camera")).toHaveCount(9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/beta-wall-${width}.png`, fullPage: true });
    await wall.getByRole("button", { name: "צפייה במצלמה", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await wall
        .locator("hikvision-intercom-camera")
        .evaluateAll((els) => els.some((el) => el.live)),
    ).toBe(false);
    await page.getByRole("dialog").getByRole("button", { name: "סגירה", exact: true }).click();
    await wall.getByRole("combobox", { name: "מספר זרמים מרבי" }).selectOption("4");
    await expect(wall.locator("hikvision-intercom-camera")).toHaveCount(4);
    await wall.getByRole("button", { name: "עצור קיר מצלמות" }).click();
    expect(
      await wall
        .locator("hikvision-intercom-camera")
        .evaluateAll((els) => els.some((el) => el.live)),
    ).toBe(false);
  });
}
