import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
test("global microphone mode persists through admin settings", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Camera playback options");
  const form = page.locator("hikvision-media-settings");
  await form.getByLabel("Microphone control (all stations)").selectOption("toggle");
  await form.getByRole("button", { name: "Save for all cameras" }).click();
  await expect(form).toContainText("Saved globally");
  expect(await page.evaluate(() => window.demoData.media_settings.talk_mode)).toBe("toggle");
});
test("event portrait uses the server owner reference and unknown events get none", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("users/photo_get"))
        return { photo: canvas.toDataURL("image/jpeg") };
      const result = await base(message);
      if (message.type.endsWith("events/list"))
        result.records = result.records.map((row, i) => ({
          ...row,
          portrait: i === 0 ? { user_id: "verified-owner", revision: 1 } : null,
        }));
      return result;
    };
  });
  await navigate(page, "Events");
  const rows = page.locator(".audit-row");
  await expect(rows.first().locator("hikvision-user-photo img")).toBeVisible();
  await expect(rows.nth(1).locator("hikvision-user-photo")).toHaveCount(0);
  await expect(rows.first().locator("hikvision-user-photo")).toHaveAttribute(
    "title",
    "Current employee photo",
  );
});
