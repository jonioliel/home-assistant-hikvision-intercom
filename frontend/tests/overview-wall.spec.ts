import { test, expect } from "@playwright/test";

for (const count of [4, 6, 9, 12]) {
  test(`wall fits ${count} stations without desktop scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("smplwise-access-control:appearance:v1:demo-admin", "modern"),
    );
    await page.goto("/?lang=he");
    await expect(page.locator(".overview-wall")).toBeVisible();
    await page.evaluate((n) => {
      const p = document.querySelector("smplwise-access-control-panel") as any;
      const source = p._data.stations;
      p._data = {
        ...p._data,
        stations: Array.from({ length: n }, (_, i) => ({
          ...source[i % source.length],
          id: `wall-${i}`,
          name: `תחנה ${i + 1}`,
        })),
      };
    }, count);
    await expect(page.locator(".overview-wall article")).toHaveCount(count);
    await expect
      .poll(() =>
        page.locator(".wall-pagination").evaluate((el) => el.getBoundingClientRect().bottom),
      )
      .toBeLessThanOrEqual(900);
    expect(
      await page
        .locator(".overview-wall article")
        .evaluateAll((nodes) => nodes.every((el) => el.scrollHeight <= el.clientHeight + 1)),
    ).toBe(true);
    await page.screenshot({ path: `test-results/wall-${count}.png` });
  });
}

test("mobile pages all stations and search resets page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem("smplwise-access-control:appearance:v1:demo-admin", "modern"),
  );
  await page.goto("/");
  await expect(page.locator(".overview-wall")).toBeVisible();
  const first = await page.locator(".overview-wall h3").first().innerText();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".overview-wall h3").first()).not.toHaveText(first);
  await page.getByRole("searchbox", { name: "Search entrances" }).fill(first);
  await expect(page.locator(".overview-wall article")).toHaveCount(1);
  await expect(page.locator(".overview-wall h3")).toHaveText(first);
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
});

test("ringing does not move tiles and activity remains available", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() =>
    localStorage.setItem("smplwise-access-control:appearance:v1:demo-admin", "modern"),
  );
  await page.goto("/");
  await expect(page.locator(".overview-wall article")).toHaveCount(9);
  const names = await page.locator(".overview-wall h3").allTextContents();
  await page.evaluate(() => {
    const p = document.querySelector("smplwise-access-control-panel") as any;
    p._data = {
      ...p._data,
      stations: p._data.stations.map((s: any, i: number) => ({
        ...s,
        call_state: i === 5 ? "ringing" : "idle",
      })),
    };
  });
  await expect(page.locator(".overview-wall h3")).toHaveText(names);
  await page.locator(".wall-details").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
