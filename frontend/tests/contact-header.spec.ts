import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("phone edits preserve international prefix and appear in table and search", async ({
  page,
}) => {
  await page.goto("/");
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mobile phone", { exact: true }).fill("+972 50-123-4567");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".desktop-users")).toContainText("+972 50-123-4567");
  await page.locator('input[type="search"]').first().fill("050");
  await page.locator('input[type="search"]').first().fill("501234567");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
});

for (const appearance of ["current", "modern"]) {
  for (const width of [360, 768, 1440]) {
    test(`horizontal navigation ${appearance} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (appearance) =>
          localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", appearance),
        appearance,
      );
      await page.goto("/?lang=he");
      const head = page.locator(".head");
      await expect(head.locator(".nav")).toBeVisible();
      await expect(head.locator(".nav button")).toHaveCount(4);
      const boxes = await head
        .locator(".nav button")
        .evaluateAll((els) =>
          els.map((el) => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })),
        );
      expect(Math.max(...boxes.map((b) => b.y)) - Math.min(...boxes.map((b) => b.y))).toBeLessThan(
        2,
      );
      expect(new Set(boxes.map((b) => b.x)).size).toBe(4);
      await expect
        .poll(() => page.locator(".app-shell").evaluate((el) => el.scrollWidth - el.clientWidth))
        .toBeLessThanOrEqual(1);
      if (width === 1440) {
        const title = await head.locator("h1").boundingBox();
        expect(Math.abs(boxes[0].y - title!.y)).toBeLessThan(30);
      }
    });
  }
}

test("compact photo is large and has no internal scrolling", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const photo = document.createElement("hikvision-user-photo") as any;
    photo.compact = true;
    photo.hass = { user: { is_admin: true } };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    photo.image = canvas.toDataURL("image/jpeg");
    document.body.append(photo);
  });
  const photo = page.locator("body > hikvision-user-photo");
  await expect(photo.locator("img")).toBeVisible();
  expect(await photo.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  expect((await photo.locator("img").boundingBox())!.width).toBe(60);
});
