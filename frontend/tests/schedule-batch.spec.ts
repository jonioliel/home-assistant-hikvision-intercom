import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function prepare(page) {
  await page.goto("/");
  await navigate(page, "Access schedules");
  await page.getByRole("button", { name: "New schedule", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Fleet draft");
}

test("station queue isolates failure and exports reports without baseline tokens", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (msg) =>
      msg.type.endsWith("schedules/assess") && msg.station_id === "station-1"
        ? Promise.reject({ code: "connection_failed" })
        : original(msg);
  });
  await page.getByRole("button", { name: "Assess draft across stations", exact: true }).click();
  const queue = page.getByRole("region", { name: "Station assessment queue" });
  await expect(queue).toContainText("Finished: 9 / 9");
  await expect(queue).toContainText("Check failed");
  await expect(queue.getByRole("button", { name: "Show station report" })).toHaveCount(6);
  const download = page.waitForEvent("download");
  await queue.getByRole("button", { name: "Download station reports" }).click();
  const report = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(report.stations).toHaveLength(9);
  expect(JSON.stringify(report)).not.toContain("token");
  expect(JSON.stringify(report)).not.toContain("PRIVATE_BASELINE_TOKEN");
  expect(report.stations.filter((r) => r.state === "skipped")).toHaveLength(2);
  expect(report.can_apply).toBe(false);
});

test("cancel limits the queue to two in-flight reads and retains their results", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    window.pendingReads = [];
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (msg) =>
      msg.type.endsWith("schedules/assess")
        ? new Promise((resolve) => {
            window.pendingReads.push(async () => resolve(await original(msg)));
          })
        : original(msg);
  });
  await page.getByRole("button", { name: "Assess draft across stations", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(2);
  await page.getByRole("button", { name: "Cancel remaining checks" }).click();
  const queue = page.getByRole("region", { name: "Station assessment queue" });
  await expect(queue).toContainText("Cancelled before reading");
  await page.evaluate(() => Promise.all(window.pendingReads.map((fn) => fn())));
  await expect(queue).toContainText("Finished: 9 / 9");
  expect(await page.evaluate(() => window.pendingReads.length)).toBe(2);
  await expect(queue.getByRole("button", { name: "Show station report" })).toHaveCount(2);
});

test("editing invalidates queued work and late reports", async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    window.pendingReads = [];
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (msg) =>
      msg.type.endsWith("schedules/assess")
        ? new Promise((resolve) =>
            window.pendingReads.push(async () => resolve(await original(msg))),
          )
        : original(msg);
  });
  await page.getByRole("button", { name: "Assess draft across stations", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Changed draft");
  await page.evaluate(() => Promise.all(window.pendingReads.map((fn) => fn())));
  await expect(page.getByRole("region", { name: "Station assessment queue" })).toHaveCount(0);
  expect(await page.evaluate(() => window.pendingReads.length)).toBe(2);
});
