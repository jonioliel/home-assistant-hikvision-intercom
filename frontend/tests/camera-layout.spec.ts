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

        video: box(".camera-video"),
        controls: box("hikvision-intercom-audio-controls"),
        width: node.scrollWidth,
        client: node.clientWidth,
      };
    });
    expect(bounds.video.right - bounds.video.left).toBeGreaterThanOrEqual(159);
    expect(bounds.head.top).toBeGreaterThanOrEqual(0);
    await expect(dialog.locator(".dialog-foot")).toBeHidden();
    expect(bounds.width).toBe(bounds.client);
    expect(bounds.controls.top).toBeGreaterThanOrEqual(bounds.video.bottom);
    await expect(dialog.locator(".camera-door-actions button").first()).toBeVisible();
    await expect(dialog.locator(".camera-fullscreen")).toBeVisible();
    const start = dialog.getByRole("button", {
      name: language === "he" ? "פתח האזנה" : "Start listening",
      exact: true,
    });
    await dialog.locator(".audio-options > summary").click();
    await dialog.getByText(/^(Audio diagnostics|אבחון שמע)$/, { exact: true }).click();
    const exportButton = dialog.getByRole("button", {
      name: language === "he" ? "הורד קובץ אבחון" : "Download audio diagnostics",
      exact: true,
    });
    await exportButton.scrollIntoViewIfNeeded();
    await expect(exportButton).toBeInViewport();
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
