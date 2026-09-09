import { test, expect } from "@playwright/test";

for (const [width, height, language] of [
  [1280, 720, "he"],
  [1280, 720, "en"],
  [390, 844, "he"],
  [844, 390, "he"],
] as const) {
  test(`camera controls and footer remain usable at ${width}x${height} ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?lang=" + language);
    await page
      .getByRole("button", {
        name: language === "he" ? "צפייה במצלמה" : "View camera",
        exact: true,
      })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    const bounds = await dialog.evaluate((node) => {
      const box = (selector: string) => {
        const r = node.querySelector(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return {
        head: box(".dialog-head"),
        foot: box(".dialog-foot"),
        video: box(".camera-video"),
        controls: box(".camera-controls"),
        width: node.scrollWidth,
        client: node.clientWidth,
      };
    });
    expect(bounds.head.top).toBeGreaterThanOrEqual(0);
    expect(bounds.foot.bottom).toBeLessThanOrEqual(height);
    expect(bounds.width).toBe(bounds.client);
    if (width > 850) {
      expect(Math.abs(bounds.video.top - bounds.controls.top)).toBeLessThan(2);
      expect(bounds.controls.bottom).toBeLessThanOrEqual(bounds.foot.top + 1);
    }
    const start = dialog.getByRole("button", {
      name: language === "he" ? "הפעל שמע" : "Start audio",
      exact: true,
    });
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport();
    await dialog
      .getByRole("button", { name: language === "he" ? "סגירה" : "Close", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.calls.filter((c) => c.type.endsWith("/stations/test_unlock")).length,
      ),
    ).toBe(0);
  });
}
