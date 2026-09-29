import { test, expect, type Page, type Locator } from "@playwright/test";
import { navigate } from "./navigation";
async function editor(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.profile_settings.photo_enabled = true;
    window.demoNotify();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  return page.getByRole("dialog").locator("hikvision-user-photo");
}
async function raster(page: Page, mime: string) {
  const encoded = await page.evaluate((mime) => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 400;
    const x = c.getContext("2d")!;
    for (const [color, left, top] of [
      ["red", 0, 0],
      ["green", 0, 200],
      ["yellow", 400, 0],
      ["blue", 400, 200],
    ] as const) {
      x.fillStyle = color;
      x.fillRect(left, top, 400, 200);
    }
    return c.toDataURL(mime).split(",")[1];
  }, mime);
  return Buffer.from(encoded, "base64");
}
async function setFile(photo: Locator, buffer: Buffer, mimeType = "image/png") {
  await photo
    .locator('input[type="file"]')
    .setInputFiles({ name: "portrait." + mimeType.split("/")[1], mimeType, buffer });
}
async function pixel(photo: Locator) {
  return photo
    .getByRole("img", { name: "Photo preview", exact: true })
    .evaluate(async (element: HTMLImageElement) => {
      await element.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const x = c.getContext("2d")!;
      x.drawImage(element, 0, 0);
      return Array.from(x.getImageData(128, 128, 1, 1).data);
    });
}
for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
  test(`local ${mime} crop is normalized and saved only explicitly`, async ({ page }) => {
    const photo = await editor(page, mime === "image/png" ? 390 : 1440);
    await setFile(photo, await raster(page, mime), mime);
    await expect(photo.getByRole("img", { name: "Photo preview", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/update")).length),
    ).toBe(0);
    if (mime === "image/png") {
      await photo.getByRole("slider", { name: "Crop zoom", exact: true }).fill("2");
      await photo
        .getByRole("slider", { name: "Horizontal crop position", exact: true })
        .fill("100");
      await photo.getByRole("slider", { name: "Vertical crop position", exact: true }).fill("100");
      const p = await pixel(photo);
      expect(p[0]).toBeLessThan(8);
      expect(p[1]).toBeLessThan(8);
      expect(p[2]).toBeGreaterThan(245);
      expect(await photo.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
    await photo.getByRole("button", { name: "Use this photo", exact: true }).click();
    expect(
      await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/update")).length),
    ).toBe(0);
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    const data = await page.evaluate(
      () => window.calls.find((c) => c.type.endsWith("users/update")).data.photo,
    );
    expect(data).toMatch(/^data:image\/jpeg;base64,/);
    expect(data.length).toBeLessThanOrEqual(43715);
    const dimensions = await page.evaluate(async (data) => {
      const i = new Image();
      i.src = data;
      await i.decode();
      return [i.naturalWidth, i.naturalHeight];
    }, data);
    expect(dimensions).toEqual([256, 256]);
    expect(await page.evaluate(() => JSON.stringify(window.demoData))).not.toContain(data);
  });
}
test("invalid, oversized and excessive-pixel files never change the person", async ({ page }) => {
  const photo = await editor(page);
  const png = await raster(page, "image/png");
  const largePixels = Buffer.from(png);
  largePixels.writeUInt32BE(9000, 16);
  const cases = [
    {
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      mime: "image/svg+xml",
      error: "Choose a JPEG",
    },
    { buffer: png.subarray(0, 33), mime: "image/png", error: "could not be decoded" },
    { buffer: largePixels, mime: "image/png", error: "exceeds 16 million" },
    { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mime: "image/jpeg", error: "up to 5 MB" },
    { buffer: png, mime: "image/jpeg", error: "Choose a JPEG" },
  ];
  for (const item of cases) {
    await setFile(photo, item.buffer, item.mime);
    await expect(photo.getByRole("alert")).toContainText(item.error);
    await expect(photo.getByRole("img", { name: "Photo preview", exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update")))).toBe(
    false,
  );
});
for (const reason of ["cancel", "readonly", "connection", "close"] as const) {
  test(`delayed decode is discarded and blob released on ${reason}`, async ({ page }) => {
    const photo = await editor(page);
    const png = await raster(page, "image/png");
    await page.evaluate(() => {
      const state = window as typeof window & { finishPhoto?: () => void; revokedPhoto?: number };
      state.revokedPhoto = 0;
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () {
        await original.call(this);
        if (this.src.startsWith("blob:"))
          await new Promise<void>((resolve) => {
            state.finishPhoto = resolve;
          });
      };
      const revoke = URL.revokeObjectURL;
      URL.revokeObjectURL = (url) => {
        state.revokedPhoto!++;
        revoke.call(URL, url);
      };
    });
    await setFile(photo, png);
    await expect.poll(() => page.evaluate(() => !!(window as any).finishPhoto)).toBe(true);
    if (reason === "cancel")
      await photo.getByRole("button", { name: "Cancel", exact: true }).click();
    if (reason === "readonly")
      await photo.evaluate((el: any) => {
        el.compact = true;
      });
    if (reason === "connection")
      await photo.evaluate((el: any) => {
        el.hass = { ...el.hass, connection: { ...el.hass.connection, connected: false } };
      });
    if (reason === "close")
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => (window as any).finishPhoto());
    await expect(page.getByRole("img", { name: "Photo preview", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).revokedPhoto)).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update"))),
    ).toBe(false);
  });
}
