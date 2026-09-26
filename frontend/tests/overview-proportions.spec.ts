import { test, expect } from "@playwright/test";
for (const [width, height, count] of [
  [2048, 1116, 8],
  [1440, 900, 12],
  [1366, 768, 8],
  [390, 844, 8],
]) {
  test(`camera proportions and full frame ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() =>
      localStorage.setItem("smplwise-access-control:appearance:v1:demo-admin", "modern"),
    );
    await page.goto("/?lang=he");
    await expect(page.locator(".overview-wall")).toBeVisible();
    await page.evaluate((n) => {
      const p = document.querySelector("smplwise-access-control-panel") as any;
      const src = p._data.stations;
      p._data = {
        ...p._data,
        stations: Array.from({ length: n }, (_, i) => ({
          ...src[i % src.length],
          id: `aspect-${i}`,
          online: true,
        })),
      };
    }, count);
    const camera = page.locator(".overview-wall smplwise-access-control-camera").first();
    await expect(camera.locator("img")).toBeVisible();
    await expect
      .poll(async () => {
        const b = await camera.boundingBox();
        return Math.abs(b!.width / b!.height - 16 / 9);
      })
      .toBeLessThan(0.03);
    expect(await camera.locator("img").evaluate((el) => getComputedStyle(el).objectFit)).toBe(
      "contain",
    );
    if (width === 2048) {
      await expect(page.locator(".overview-wall article")).toHaveCount(8);
      const tiles = await page
        .locator(".overview-wall article")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().y));
      expect(new Set(tiles).size).toBe(2);
      await page.screenshot({ path: "test-results/corrected-eight-stations.png" });
    }
  });
}
