import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, command: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const events = page.locator("hikvision-intercom-events");
  await expect(events.locator(".audit-row").first()).toBeVisible();
  await page.evaluate((command) => {
    const base = window.demoHass.callWS;
    window.eventOriginalApi = base;
    window.demoHass.callWS = async function (message) {
      const result = await base.call(this, message);
      if (message.type === "hikvision_intercom/events/" + command)
        return await new Promise((resolve) => (window.lateEventResponse = () => resolve(result)));
      return result;
    };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  }, command);
  return events;
}

test("a missing event list reply becomes retryable and leaves the previous records visible", async ({
  page,
}) => {
  const events = await setup(page, "list");
  await page.clock.install();
  await events.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.clock.fastForward(21000);
  await expect(events.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(events.getByRole("alert")).toBeVisible();
  await expect(events.locator(".audit-row").first()).toBeVisible();
  await page.evaluate(() => window.lateEventResponse());
  await expect(events.getByRole("alert")).toBeVisible();
});

test("a missing event CSV response releases report controls and its late result cannot download", async ({
  page,
}) => {
  const events = await setup(page, "export");
  const downloads = [];
  page.on("download", (download) => downloads.push(download));
  await page.clock.install();
  const exportButton = events.getByRole("button", {
    name: "Export filtered events CSV",
    exact: true,
  });
  await exportButton.click();
  await page.clock.fastForward(61000);
  await expect(exportButton).toBeEnabled();
  await expect(events.getByRole("alert")).toBeVisible();
  await events.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(events.getByRole("alert")).toContainText("report response did not arrive");
  await page.evaluate(() => window.lateEventResponse());
  await expect(events.locator(".activity-report")).toHaveCount(0);
  expect(downloads).toHaveLength(0);
});

test("station updates during a slow event read coalesce into one subsequent refresh", async ({
  page,
}) => {
  const events = await setup(page, "list");
  const count = () =>
    page.evaluate(() => window.calls.filter((c) => c.type.endsWith("events/list")).length);
  const before = await count();
  await events.getByRole("button", { name: "Refresh", exact: true }).click();
  for (let n = 0; n < 4; n++)
    await events.evaluate(async (node: any) => {
      node.stations = structuredClone(node.stations);
      await node.updateComplete;
    });
  expect(await count()).toBe(before + 1);
  await page.evaluate(() => window.lateEventResponse());
  await expect.poll(count).toBe(before + 2);
  await page.evaluate(() => window.lateEventResponse());
  await expect(events.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  expect(await count()).toBe(before + 2);
});

test("new filters replace a slow list request and ignore its previous unfiltered rows", async ({
  page,
}) => {
  const events = await setup(page, "list");
  await events.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.evaluate(() => {
    window.demoHass.callWS = window.eventOriginalApi;
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  await events.getByLabel("Result", { exact: true }).selectOption("denied");
  await events.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(events.locator(".audit-row")).toHaveCount(1);
  await page.evaluate(() => window.lateEventResponse());
  await expect(events.locator(".audit-row")).toHaveCount(1);
  await expect(events.getByRole("alert")).toHaveCount(0);
});

test("reattaching an event view abandons its old load and starts a fresh list", async ({
  page,
}) => {
  const events = await setup(page, "list");
  await events.getByRole("button", { name: "Refresh", exact: true }).click();
  await events.evaluate((node: any) => {
    window.demoHass.callWS = window.eventOriginalApi;
    node.remove();
    node.hass = { ...window.demoHass };
    document.body.append(node);
  });
  await expect(events.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(events.locator(".audit-row")).toHaveCount(2);
  await page.evaluate(() => window.lateEventResponse());
  await expect(events.locator(".audit-row")).toHaveCount(2);
  await expect(events.getByRole("alert")).toHaveCount(0);
});

test("HA disconnect discards an event export and reconnect never repeats the download", async ({
  page,
}) => {
  const events = await setup(page, "export");
  await page.evaluate(() => {
    const listeners = new Map<string, Set<() => void>>();
    const connection = {
      ...window.demoHass.connection,
      connected: true,
      addEventListener(name, callback) {
        const set = listeners.get(name) ?? new Set();
        set.add(callback);
        listeners.set(name, set);
      },
      removeEventListener(name, callback) {
        listeners.get(name)?.delete(callback);
      },
    };
    window.eventConnectionState = (online) => {
      connection.connected = online;
      for (const callback of listeners.get(online ? "ready" : "disconnected") ?? []) callback();
    };
    window.demoHass.connection = connection;
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  await expect(events.locator(".audit-row")).toHaveCount(2);
  let downloads = 0;
  page.on("download", () => downloads++);
  const button = events.getByRole("button", { name: "Export filtered events CSV", exact: true });
  await button.click();
  await expect.poll(() => page.evaluate(() => typeof window.lateEventResponse)).toBe("function");
  await page.evaluate(() => window.eventConnectionState(false));
  await expect(button).toBeDisabled();
  await expect(events.getByRole("alert")).toContainText("report response did not arrive");
  await expect(events.locator(".audit-row")).toHaveCount(2);
  await page.evaluate(() => {
    window.eventConnectionState(true);
    window.lateEventResponse();
  });
  await expect(button).toBeEnabled();
  await expect(events.locator(".activity-report")).toHaveCount(0);
  expect(downloads).toBe(0);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("events/export")).length),
  ).toBe(1);
});
