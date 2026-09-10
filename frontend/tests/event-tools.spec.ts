import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function setup(page) {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    let trace = { format: "hikvision_intercom.event_trace", capture: null, remaining_seconds: 0 };
    window.demoData.stations[0].clock = { zone: { kind: "iana", name: "UTC" } };
    window.demoHass.callWS = async (message) => {
      if (message.type.includes("health/"))
        return { integration_version: "test", generated_at: new Date().toISOString() };
      if (message.type.includes("events/trace_")) {
        window.calls.push(message);
        if (message.type.endsWith("trace_start"))
          trace = {
            format: "hikvision_intercom.event_trace",
            capture: {
              capture_id: "synthetic",
              state: "recording",
              records: [{ observation: { kind: "call_baseline", state: "idle" } }],
              dropped: 0,
            },
            remaining_seconds: 90,
          };
        if (message.type.endsWith("trace_stop")) trace.capture.state = "stopped";
        return structuredClone(trace);
      }
      if (message.type.endsWith("events/history_inspect")) {
        window.calls.push(message);
        return {
          format: "hikvision_intercom.history_inspection",
          complete: true,
          filter_honored: null,
          records: 0,
          start: message.start,
          end: message.end,
        };
      }
      return base(message);
    };
  });
  await navigate(page, "Health & field tests");
  const tools = page.locator("hikvision-intercom-event-tools").first();
  await tools.getByText("Event and call investigation", { exact: true }).click();
  return tools;
}

test("capture only starts explicitly and exports a stopped trace", async ({ page }) => {
  const tools = await setup(page);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.includes("events/trace_")).length),
  ).toBe(0);
  await tools.getByRole("button", { name: "Start 90-second capture" }).click();
  await expect(tools.getByRole("button", { name: "Start 90-second capture" })).toBeDisabled();
  await tools.getByRole("button", { name: "Stop capture", exact: true }).click();
  await expect(tools).toContainText("Capture stopped");
  const downloaded = page.waitForEvent("download");
  await tools.getByRole("button", { name: "Export event capture" }).click();
  const data = JSON.parse(await readFile((await (await downloaded).path())!, "utf8"));
  expect(data.capture.state).toBe("stopped");
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => c.type.includes("unlock") || c.type.endsWith("media/signal")),
    ),
  ).toBe(false);
});

test("history uses selected time window and preserves input after response", async ({ page }) => {
  const tools = await setup(page);
  await tools.locator('input[name="start"]').fill("2026-09-09T08:00");
  await tools.locator('input[name="end"]').fill("2026-09-09T09:00");
  await tools.getByRole("button", { name: "Inspect device history" }).click();
  await expect(tools).toContainText("Query complete; no records found");
  await expect(tools.locator('input[name="start"]')).toHaveValue("2026-09-09T08:00");
  const calls = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("events/history_inspect")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].start).toBe("2026-09-09T08:00:00.000Z");
  await tools.locator('input[name="end"]').fill("2026-09-11T09:00");
  await tools.getByRole("button", { name: "Inspect device history" }).click();
  await expect(tools).toContainText("Choose a valid time range");
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("events/history_inspect")).length,
    ),
  ).toBe(1);
});

async function hold(page, action) {
  await page.evaluate((action) => {
    const base = window.demoHass.callWS;
    window.originalEventToolsApi = base;
    window.demoHass.callWS = async function (message) {
      const result = await base.call(this, message);
      if (message.type === "hikvision_intercom/events/" + action)
        return await new Promise((resolve) => (window.lateToolsReply = () => resolve(result)));
      return result;
    };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  }, action);
}

test("missing capture status has a deadline and its late response is discarded", async ({
  page,
}) => {
  const tools = await setup(page);
  await tools.getByRole("button", { name: "Start 90-second capture" }).click();
  await hold(page, "trace_get");
  await page.clock.install();
  await tools.getByRole("button", { name: "Refresh capture status" }).click();
  await page.clock.fastForward(21000);
  await expect(tools.getByRole("button", { name: "Refresh capture status" })).toBeEnabled();
  await expect(tools.getByRole("alert")).toBeVisible();
  await page.evaluate(() => window.lateToolsReply());
  await expect(tools.getByRole("alert")).toBeVisible();
});

test("missing history inspection releases its controls after the server budget", async ({
  page,
}) => {
  const tools = await setup(page);
  await hold(page, "history_inspect");
  await page.clock.install();
  await tools.getByRole("button", { name: "Inspect device history" }).click();
  await page.clock.fastForward(61000);
  await expect(tools.getByRole("button", { name: "Inspect device history" })).toBeEnabled();
  await page.evaluate(() => window.lateToolsReply());
  await expect(tools.getByRole("button", { name: "Export history inspection" })).toHaveCount(0);
});

test("changing the station display zone preserves the selected history instants", async ({
  page,
}) => {
  const tools = await setup(page);
  await tools.locator('input[name="start"]').fill("2026-09-09T08:00");
  await tools.locator('input[name="end"]').fill("2026-09-09T09:00");
  await tools.evaluate(async (node) => {
    node.station = { ...node.station, clock: { zone: { kind: "iana", name: "Asia/Jerusalem" } } };
    await node.updateComplete;
  });
  await expect(tools.locator('input[name="start"]')).toHaveValue("2026-09-09T11:00");
  await expect(tools.locator('input[name="end"]')).toHaveValue("2026-09-09T12:00");
  await tools.getByRole("button", { name: "Inspect device history" }).click();
  const calls = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("events/history_inspect")),
  );
  expect(calls.at(-1).start).toBe("2026-09-09T08:00:00.000Z");
});

test("a capture response from the previous HA connection cannot populate investigation", async ({
  page,
}) => {
  const tools = await setup(page);
  await hold(page, "trace_start");
  await tools.getByRole("button", { name: "Start 90-second capture" }).click();
  await page.evaluate(() => {
    window.demoHass.callWS = window.originalEventToolsApi;
    window.demoHass.connection = { ...window.demoHass.connection };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  await expect(tools.getByRole("button", { name: "Refresh capture status" })).toBeEnabled();
  await page.evaluate(() => window.lateToolsReply());
  await expect(tools.getByRole("button", { name: "Export event capture" })).toHaveCount(0);
});

test("an unconfirmed capture start requires a status read without starting again", async ({
  page,
}) => {
  const tools = await setup(page);
  await hold(page, "trace_start");
  await page.clock.install();
  await tools.getByRole("button", { name: "Start 90-second capture" }).click();
  await page.clock.fastForward(21000);
  await expect(tools.getByRole("button", { name: "Refresh capture status" })).toBeEnabled();
  await expect(tools.getByRole("button", { name: "Start 90-second capture" })).toBeDisabled();
  await expect(tools).toContainText("The capture change could not be confirmed");
  await page.evaluate(() => {
    window.demoHass.callWS = window.originalEventToolsApi;
    window.lateToolsReply();
  });
  await expect(tools.getByRole("button", { name: "Export event capture" })).toHaveCount(0);
  await tools.getByRole("button", { name: "Refresh capture status" }).click();
  await expect(tools.getByRole("button", { name: "Stop capture", exact: true })).toBeEnabled();
  await expect(tools.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("trace_start")).length),
  ).toBe(1);
});

test("ambiguous local draft times are cleared on a station zone change", async ({ page }) => {
  const tools = await setup(page);
  await tools.evaluate(async (node) => {
    node.station = { ...node.station, clock: { zone: { kind: "iana", name: "America/New_York" } } };
    await node.updateComplete;
  });
  await tools.locator('input[name="start"]').fill("2026-11-01T01:30");
  await tools.locator('input[name="end"]').fill("2026-11-01T03:00");
  await tools.evaluate(async (node) => {
    node.station = { ...node.station, clock: { zone: { kind: "iana", name: "UTC" } } };
    await node.updateComplete;
  });
  await expect(tools.locator('input[name="start"]')).toHaveValue("");
  await expect(tools.locator('input[name="end"]')).toHaveValue("");
  await expect(tools.getByRole("alert")).toContainText("Enter the history range again");
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("history_inspect")).length,
    ),
  ).toBe(0);
});

test("disconnect cancels investigation waits and reconnect does not start capture", async ({
  page,
}) => {
  const tools = await setup(page);
  await page.evaluate(() => {
    const listeners = new Map();
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
    window.toolsConnectionState = (connected) => {
      connection.connected = connected;
      for (const callback of listeners.get(connected ? "ready" : "disconnected") ?? []) callback();
    };
    window.demoHass.connection = connection;
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  await hold(page, "trace_start");
  await tools.getByRole("button", { name: "Start 90-second capture" }).click();
  await page.evaluate(() => window.toolsConnectionState(false));
  await expect(tools.getByRole("button", { name: "Refresh capture status" })).toBeDisabled();
  await page.evaluate(() => {
    window.toolsConnectionState(true);
    window.lateToolsReply();
  });
  await expect(tools.getByRole("button", { name: "Refresh capture status" })).toBeEnabled();
  await expect(tools.getByRole("button", { name: "Start 90-second capture" })).toBeDisabled();
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("trace_start")).length),
  ).toBe(1);
});
