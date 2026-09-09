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
  await page.getByRole("button", { name: "Health & field tests", exact: true }).click();
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
