import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [390, 768, 1440]) {
  test(`call dock keeps actions below undistorted video at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() =>
      localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "modern"),
    );
    await page.goto("/?lang=he");
    await page.locator(".camera-wrap > button").first().click();
    const dialog = page.getByRole("dialog");
    const audio = dialog.locator("hikvision-intercom-audio-controls");
    await expect(audio).toHaveAttribute("dock", "");
    await expect(audio.locator(".audio-options")).not.toHaveAttribute("open", "");
    await expect(dialog.getByRole("button", { name: "פקודת מענה", exact: true })).toBeVisible();
    const video = await dialog.locator("hikvision-intercom-camera").boundingBox();
    const dock = await audio.locator(".session-buttons").boundingBox();
    expect(dock!.y).toBeGreaterThan(video!.y + video!.height);
    expect(video!.width / video!.height).toBeCloseTo(16 / 9, 1);
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(dialog.locator(".camera-door-actions button").first()).toBeInViewport();
    await expect(audio.getByRole("button", { name: "הפעל שמע", exact: true })).toBeInViewport();
    expect(
      await dialog
        .locator("hikvision-intercom-camera")
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--camera-object-fit").trim()),
    ).toBe("contain");
    expect(
      await page.evaluate(
        () =>
          window.calls.filter(
            (c) =>
              c.type.endsWith("media/signal") ||
              c.type.endsWith("stations/test_unlock") ||
              c.type.endsWith("audio/start"),
          ).length,
      ),
    ).toBe(0);
  });
}

test("sync matrix keeps diagnostic references out of labels but available on demand", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.stations[0].sync_reference = "station-reference-example";
    window.demoData.users[0].sync_reference = "person-reference-example";
    window.demoNotify();
  });
  await navigate(page, "Sync");
  const matrix = page.locator(".matrix");
  await expect(matrix.getByText("station-reference-example", { exact: true })).toBeHidden();
  await expect(matrix.getByText("person-reference-example", { exact: true })).toBeHidden();
  await matrix.locator("th .sync-reference summary").first().click();
  await expect(matrix.getByText("station-reference-example", { exact: true })).toBeVisible();
  await expect(matrix.getByText("person-reference-example", { exact: true })).toBeHidden();
});
