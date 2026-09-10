import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
const key = "wiskey:camera-layouts:v1:demo-admin";
async function wallPage(page) {
  await page.goto("/");
  await navigate(page, "Live camera wall");
  const wall = page.locator("wiskey-camera-wall");
  await wall.locator(".saved-layouts > summary").click();
  return wall;
}
async function live(page) {
  return page
    .locator("wiskey-camera-wall hikvision-intercom-camera")
    .evaluateAll((els) => els.some((el) => el.live));
}

test("named layouts preserve order and budget across reload, and load stops live playback", async ({
  page,
}) => {
  let wall = await wallPage(page);
  await wall.locator(".camera-choices > summary").click();
  const firstCamera = wall.getByRole("checkbox").first();
  await firstCamera.uncheck();
  await firstCamera.check();
  const order = await wall
    .locator("hikvision-intercom-camera")
    .evaluateAll((els) => els.map((el) => el.stationId));
  await wall.getByRole("textbox", { name: "Layout name", exact: true }).fill("Entrances");
  await wall.getByRole("button", { name: "Save layout", exact: true }).click();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  expect(stored[0].stations).toEqual(order);
  expect(stored[0].limit).toBe(4);
  wall = await wallPage(page);
  await wall
    .getByRole("combobox", { name: "Saved layout", exact: true })
    .selectOption({ label: "Entrances" });
  await wall.getByRole("button", { name: "Start camera wall", exact: true }).click();
  expect(await live(page)).toBe(true);
  await wall.getByRole("button", { name: "Load layout", exact: true }).click();
  expect(await live(page)).toBe(false);
  expect(
    await wall
      .locator("hikvision-intercom-camera")
      .evaluateAll((els) => els.map((el) => el.stationId)),
  ).toEqual(order);
  await page.evaluate((id) => {
    window.demoData.stations = window.demoData.stations.filter((s) => s.id !== id);
    window.demoNotify();
  }, order[0]);
  await wall.getByRole("button", { name: "Load layout", exact: true }).click();
  await expect(wall.getByRole("alert")).toContainText("no longer available");
  await expect(wall.locator("hikvision-intercom-camera")).toHaveCount(3);
  expect(await live(page)).toBe(false);
  await wall.getByRole("button", { name: "Delete layout", exact: true }).click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).toEqual([]);
});

test("stale saved layout writes cannot overwrite another browser edit", async ({ page }) => {
  const wall = await wallPage(page);
  await wall.getByRole("textbox", { name: "Layout name", exact: true }).fill("My layout");
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify([{ id: "external", name: "Elsewhere", limit: 4, stations: [] }]),
      ),
    key,
  );
  await wall.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(wall.getByRole("alert")).toBeVisible();
  expect(
    (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).map((x) => x.name),
  ).toEqual(["Elsewhere"]);
  await expect(wall.getByRole("textbox", { name: "Layout name", exact: true })).toHaveValue("");
});

test("malformed saved layouts are not overwritten and actor changes isolate preferences", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, '[{"id":"bad"}]'), key);
  await navigate(page, "Live camera wall");
  const wall = page.locator("wiskey-camera-wall");
  await wall.locator(".saved-layouts > summary").click();
  await expect(wall.getByRole("alert")).toBeVisible();
  await wall
    .getByRole("textbox", { name: "Layout name", exact: true })
    .fill("Preserve corrupt data");
  await expect(wall.getByRole("button", { name: "Save layout", exact: true })).toBeDisabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe('[{"id":"bad"}]');
  await wall.evaluate((el) => {
    el.hass = { ...el.hass, user: { ...el.hass.user, id: "second-admin" } };
  });
  await expect(wall.getByRole("textbox", { name: "Layout name", exact: true })).toHaveValue("");
  await expect(wall.getByRole("alert")).toHaveCount(0);
  await wall.getByRole("textbox", { name: "Layout name", exact: true }).fill("Second");
  await wall.getByRole("button", { name: "Save layout", exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("wiskey:camera-layouts:v1:second-admin"))[0].name,
    ),
  ).toBe("Second");
  await wall.evaluate((el) => {
    el.hass = { ...el.hass, user: { ...el.hass.user, is_admin: false } };
  });
  await expect(wall.locator("input,button,select,video")).toHaveCount(0);
  expect(await live(page)).toBe(false);
});

test("layout count is bounded and duplicate camera IDs are rejected", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify(
          Array.from({ length: 20 }, (_, i) => ({
            id: String(i),
            name: `Layout ${i}`,
            limit: 4,
            stations: [],
          })),
        ),
      ),
    key,
  );
  await navigate(page, "Live camera wall");
  const wall = page.locator("wiskey-camera-wall");
  await wall.locator(".saved-layouts > summary").click();
  await wall.getByRole("textbox", { name: "Layout name", exact: true }).fill("Overflow");
  await expect(wall.getByRole("button", { name: "Save layout", exact: true })).toBeDisabled();
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify([{ id: "one", name: "Duplicate", limit: 4, stations: ["a", "a"] }]),
      ),
    key,
  );
  await wall.getByRole("button", { name: "Reload layouts", exact: true }).click();
  await expect(wall.getByRole("alert")).toBeVisible();
});
