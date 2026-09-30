import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const evidence = "../docs/evidence/arx-rc37";
mkdirSync(evidence, { recursive: true });

async function seedStations(frame: import("@playwright/test").Frame, count = 12) {
  await frame.evaluate((count) => {
    const panel = document.querySelector("hikvision-intercom-panel") as any;
    const source = panel._data.stations;
    panel._data = {
      ...panel._data,
      stations: Array.from({ length: count }, (_, index) => ({
        ...source[index % source.length],
        id: `arx-camera-${index + 1}`,
        name: `Camera ${index + 1}`,
        online: true,
      })),
    };
  }, count);
}

for (const [width, height, frameWidth, frameHeight] of [
  [1440, 900, 1354, 729],
  [1920, 1080, 1834, 909],
  [390, 844, 390, 844],
]) {
  test(`Arx embedded camera wall at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(
      "/embed-host.html?frame=" +
        encodeURIComponent("/hikvision-intercom?embed=1&chrome=none&tab=camera_wall&wall=12"),
    );
    const iframe = page.locator("iframe");
    await iframe.evaluate(
      (element, size) => {
        element.style.width = `${size.width}px`;
        element.style.height = `${size.height}px`;
        document.body.style.background = "white";
      },
      { width: frameWidth, height: frameHeight },
    );
    const frame = page.frames().find((item) => item.url().includes("/hikvision-intercom"))!;
    const wall = frame.locator("wiskey-camera-wall");
    await expect(wall).toBeVisible();
    await expect(wall.getByRole("combobox", { name: "Maximum streams" })).toHaveValue("12");
    await seedStations(frame);
    await wall.evaluate((element: any) => {
      element.selected = element.stations.map((station: any) => station.id);
    });
    await expect(wall.locator("hikvision-intercom-camera")).toHaveCount(12);
    await wall.getByRole("button", { name: "Start camera wall" }).click();
    expect(
      await wall
        .locator("hikvision-intercom-camera")
        .evaluateAll((items: any[]) => items.filter((item) => item.live).length),
    ).toBe(12);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(
      await wall
        .locator(".wall")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    if (width === 1440) {
      const visible = await wall
        .locator(".tile")
        .evaluateAll(
          (items) => items.filter((item) => item.getBoundingClientRect().bottom <= 729).length,
        );
      expect(visible).toBeGreaterThanOrEqual(10);
    }
    await page.screenshot({ path: `${evidence}/camera-wall-${width}x${height}.png` });
  });
}

for (const height of [730, 760]) {
  test(`Arx automatic overview measures available space at ${height}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    await page.addInitScript(() =>
      localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "wiskey-light"),
    );
    await page.goto("/hikvision-intercom?embed=1&tab=overview");
    await expect(page.locator(".wk4-door-grid")).toBeVisible();
    await seedStations(page.mainFrame());
    await expect.poll(() => page.locator(".wk4-door").count()).toBeGreaterThanOrEqual(6);
    const rows = await page
      .locator(".wk4-door")
      .evaluateAll(
        (items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size,
      );
    expect(rows).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `${evidence}/overview-auto-1440x${height}.png` });
  });
}

test("explicit twelve survives short embed and frame background is transparent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "wiskey-light"),
  );
  await page.goto(
    "/embed-host.html?frame=" +
      encodeURIComponent("/hikvision-intercom?embed=1&chrome=none&tab=overview&density=12"),
  );
  const iframe = page.locator("iframe");
  await iframe.evaluate((element) => {
    element.style.width = "1354px";
    element.style.height = "730px";
    document.body.style.background = "white";
  });
  const frame = page.frames().find((item) => item.url().includes("/hikvision-intercom"))!;
  await expect(frame.locator(".wk4-door-grid")).toBeVisible();
  await seedStations(frame);
  await expect(frame.locator(".wk4-door")).toHaveCount(12);
  expect(
    await frame.evaluate(() => [
      getComputedStyle(document.documentElement).backgroundColor,
      getComputedStyle(document.body).backgroundColor,
    ]),
  ).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
  expect(
    await frame
      .locator("hikvision-intercom-panel")
      .evaluate(
        (element) =>
          getComputedStyle(element.shadowRoot!.querySelector(".app-shell")!).backgroundColor,
      ),
  ).toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: `${evidence}/embed-transparent-1440x900.png` });
});

test("overview URL density stays explicit across reloads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 730 });
  await page.addInitScript(() =>
    localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "wiskey-light"),
  );
  await page.goto("/hikvision-intercom?embed=1&tab=overview&density=8");
  await expect(page.locator(".wk4-door-grid")).toBeVisible();
  await seedStations(page.mainFrame());
  await expect(page.locator(".wk4-door")).toHaveCount(8);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Tiles per view" })).toHaveValue("8");
  await expect(page.locator(".wk4-door")).toHaveCount(8);
});
