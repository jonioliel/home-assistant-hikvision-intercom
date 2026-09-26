import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [390, 1280]) {
  test(`sync error stays in its own expandable cell at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await navigate(page, "Sync");
    await page.evaluate(() => {
      const p = document.querySelector("smplwise-access-control-panel") as any;
      const data = structuredClone(p._data);
      for (const station of data.stations) station.last_error = null;
      for (const user of data.users)
        for (const assignment of Object.values(user.assignments) as any[]) {
          assignment.sync_state = "synced";
          assignment.last_error = null;
        }
      const first = Object.values(data.users[0].assignments)[0] as any;
      first.sync_state = "error";
      first.last_error = "Long diagnostic ".repeat(70);
      p._data = data;
    });
    const detail = page.locator(".matrix details.sync-error");
    await expect(detail).toHaveCount(1);
    await expect(detail.locator("p")).not.toBeVisible();
    await detail.locator("summary").click();
    await expect(detail.locator("p")).toBeVisible();
    expect(await detail.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(
      260,
    );
    await expect(page.locator(".matrix thead .danger")).toHaveCount(0);
    await expect(page.locator(".matrix .status.synced").first()).toBeVisible();
  });
}
