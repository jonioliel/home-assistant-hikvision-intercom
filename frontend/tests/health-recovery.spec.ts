import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS;
    const listeners = new Map<string, Set<() => void>>();
    const connection = {
      ...window.demoHass.connection,
      connected: true,
      addEventListener(name, callback) {
        const entries = listeners.get(name) ?? new Set();
        entries.add(callback);
        listeners.set(name, entries);
      },
      removeEventListener(name, callback) {
        listeners.get(name)?.delete(callback);
      },
    };
    window.healthConnectionState = (connected) => {
      connection.connected = connected;
      for (const callback of listeners.get(connected ? "ready" : "disconnected") ?? []) callback();
    };
    window.demoHass.connection = connection;
    window.healthPending = new Map();
    window.healthRequests = [];
    window.healthActive = 0;
    window.healthMaxActive = 0;
    window.demoHass.callWS = async function (message) {
      if (message.type.includes("/health/")) {
        window.healthRequests.push(message);
        if (window.healthAuto)
          return { generated_at: "2026-09-09T12:00:00Z", model: "current snapshot" };
        window.healthActive++;
        window.healthMaxActive = Math.max(window.healthMaxActive, window.healthActive);
        return await new Promise((resolve) =>
          window.healthPending.set(message.station_id, (model = "snapshot") => {
            window.healthActive--;
            resolve({ generated_at: "2026-09-09T12:00:00Z", model });
          }),
        );
      }
      return base.call(this, message);
    };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  await page.getByRole("button", { name: "Health & field tests", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.healthRequests.length)).toBe(3);
  return page.locator("hikvision-intercom-health");
}

test("one slow health snapshot does not hold the next station behind a completed peer", async ({
  page,
}) => {
  const health = await setup(page);
  await page.evaluate(() => window.healthPending.get("station-1")());
  await expect.poll(() => page.evaluate(() => window.healthRequests.length)).toBe(4);
  await expect(health.locator(".health-card").nth(1)).toContainText("snapshot");
  expect(await page.evaluate(() => window.healthMaxActive)).toBe(3);
});

test("station updates cannot create overlapping health batches", async ({ page }) => {
  const health = await setup(page);
  for (let n = 0; n < 4; n++)
    await health.evaluate(async (node: any) => {
      node.stations = structuredClone(node.stations);
      await node.updateComplete;
    });
  expect(await page.evaluate(() => window.healthRequests.length)).toBe(3);
  expect(await page.evaluate(() => window.healthMaxActive)).toBe(3);
});

test("a lost health snapshot has a deadline and its late result is discarded", async ({ page }) => {
  await page.clock.install();
  const health = await setup(page);
  await page.clock.fastForward(21000);
  await expect(
    health.locator(".health-card").first().getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.healthRequests.length)).toBe(6);
  await page.evaluate(() => window.healthPending.get("station-0")("late old snapshot"));
  await expect(health).not.toContainText("late old snapshot");
});

test("live health inspection has its own deadline and keeps cached diagnostics", async ({
  page,
}) => {
  const health = await setup(page);
  await page.evaluate(() => {
    window.healthAuto = true;
    for (const resolve of [...window.healthPending.values()]) resolve("current snapshot");
  });
  await expect(health.getByRole("button", { name: "Refresh", exact: true }).last()).toBeEnabled();
  await page.evaluate(() => (window.healthAuto = false));
  await page.clock.install();
  const first = health.locator(".health-card").first();
  await first.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.clock.fastForward(21000);
  await expect(first.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await page.clock.fastForward(25000);
  await expect(first.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(first).toContainText("Previous diagnostics remain visible");
  await expect(first).toContainText("current snapshot");
  await page.evaluate(() => window.healthPending.get("station-0")("outdated inspection"));
  await expect(first).not.toContainText("outdated inspection");
  await health.evaluate(async (node: any) => {
    node.stations = structuredClone(node.stations);
    await node.updateComplete;
  });
  expect(
    await page.evaluate(
      () => window.healthRequests.filter((c) => c.type.endsWith("health/refresh")).length,
    ),
  ).toBe(1);
});

test("disconnect stops queued health reads and reconnect requests cached data only", async ({
  page,
}) => {
  const health = await setup(page);
  await page.evaluate(() => window.healthPending.get("station-1")("cached station"));
  await expect(health).toContainText("cached station");
  await page.evaluate(() => {
    window.oldHealthResponse = window.healthPending.get("station-0");
    window.healthConnectionState(false);
  });
  await expect(health.getByRole("alert")).toContainText("Home Assistant is disconnected");
  await expect(health).toContainText("cached station");
  await expect(
    health.locator(".health-card").first().getByRole("button", { name: "Refresh", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.healthRequests.length)).toBe(4);
  await page.evaluate(() => {
    window.healthAuto = true;
    window.healthConnectionState(true);
    window.oldHealthResponse("from previous connection");
  });
  await expect(health.getByRole("alert")).toHaveCount(0);
  await expect(health.locator(".health-card").last()).toContainText("current snapshot");
  await expect(health).not.toContainText("from previous connection");
  expect(
    await page.evaluate(() => window.healthRequests.every((c) => c.type.endsWith("health/get"))),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.type.endsWith("media/signal") ||
          c.type.includes("unlock") ||
          c.type.endsWith("acceptance/update"),
      ),
    ),
  ).toBe(false);
});

test("replacing the HA connection discards pending diagnostics and starts a new three-slot queue", async ({
  page,
}) => {
  const health = await setup(page);
  await page.evaluate(() => {
    window.oldHealthResponse = window.healthPending.get("station-0");
    window.healthPending.clear();
    window.healthActive = 0;
    window.demoHass.connection = { ...window.demoHass.connection };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  await expect.poll(() => page.evaluate(() => window.healthRequests.length)).toBe(6);
  await page.evaluate(() => window.oldHealthResponse("old account snapshot"));
  await expect(health).not.toContainText("old account snapshot");
  expect(await page.evaluate(() => window.healthRequests.length)).toBe(6);
  await page.evaluate(() => window.healthPending.get("station-1")("new account snapshot"));
  await expect.poll(() => page.evaluate(() => window.healthRequests.length)).toBe(7);
  await expect(health).toContainText("new account snapshot");
});

test("a queued station removed from the panel is skipped without a request", async ({ page }) => {
  const health = await setup(page);
  await health.evaluate(async (node: any) => {
    node.stations = node.stations.filter((s) => s.id !== "station-5");
    await node.updateComplete;
  });
  await page.evaluate(() => {
    window.healthAuto = true;
    for (const resolve of [...window.healthPending.values()]) resolve();
  });
  await expect(health.locator(".health-card")).toHaveCount(8);
  await expect(health.getByRole("button", { name: "Refresh", exact: true }).last()).toBeEnabled();
  expect(
    await page.evaluate(() => window.healthRequests.some((c) => c.station_id === "station-5")),
  ).toBe(false);
});
