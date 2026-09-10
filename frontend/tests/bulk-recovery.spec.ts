import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any,
      base = w.demoHass.callWS,
      receipts: Record<string, any> = {};
    let counter = 0;
    const listeners = new Map<string, Set<() => void>>();
    w.demoHass.connection.addEventListener = (name: string, fn: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    };
    w.demoHass.connection.removeEventListener = (name: string, fn: () => void) =>
      listeners.get(name)?.delete(fn);
    w.bulkEvent = (name: string) => {
      w.demoHass.connection.connected = name === "ready";
      for (const fn of listeners.get(name) ?? []) fn();
    };
    w.demoHass.callWS = async function (message: any) {
      if (!message.type.includes("/users/bulk_")) return base.call(this, message);
      w.calls.push(structuredClone(message));
      const command = message.type.split("bulk_")[1];
      let result;
      if (command === "preview")
        result = {
          operation_id: "bulk-" + ++counter,
          action: "disable",
          selected: 1,
          changed: 1,
          stations: ["station-0"],
          rows: [],
          capacity: [],
        };
      else if (command === "apply") {
        if (w.bulkReject) throw { code: "bulk_review_expired" };
        result = {
          operation_id: message.operation_id,
          action: "bulk/disable",
          saved_at: new Date().toISOString(),
          changed: 1,
          stations: ["station-0"],
          user_ids: ["person-0"],
        };
        receipts[message.operation_id] = result;
      } else if (command === "receipt") {
        if (w.bulkNoReceipt) throw { code: "operation_not_found" };
        result = receipts[message.operation_id];
      } else result = Object.values(receipts);
      if (w.bulkHold === command)
        return new Promise((resolve) => {
          w.bulkLate = () => resolve(result);
        });
      return result;
    };
  });
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select user Or Levy", exact: true }).check();
  return page.locator("hikvision-bulk-users");
}
async function apply(page: Page) {
  await page.getByRole("button", { name: "Review group action", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the selected users and affected stations" })
    .check();
  await page.getByRole("button", { name: "Apply reviewed action", exact: true }).click();
}
async function writes(page: Page) {
  return page.evaluate(
    () => (window as any).calls.filter((c: any) => c.type.endsWith("bulk_apply")).length,
  );
}

test("a missing bulk preview releases its controls and cannot return after the deadline", async ({
  page,
}) => {
  const bulk = await setup(page);
  await page.evaluate(() => ((window as any).bulkHold = "preview"));
  await page.clock.install();
  await bulk.getByRole("button", { name: "Review group action", exact: true }).click();
  await page.clock.fastForward(31000);
  await expect(bulk.getByRole("alert")).toBeVisible();
  await expect(
    bulk.getByRole("button", { name: "Review group action", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => (window as any).bulkLate());
  await expect(bulk.locator(".preview")).toHaveCount(0);
});

test("a missing bulk save acknowledgement is recovered by receipt without replay", async ({
  page,
}) => {
  const bulk = await setup(page);
  await page.evaluate(() => ((window as any).bulkHold = "apply"));
  await page.clock.install();
  await apply(page);
  await page.clock.fastForward(61000);
  await expect(bulk).toContainText("The response was lost");
  await expect(
    bulk.getByRole("button", { name: "Review group action", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => (window as any).bulkLate());
  await expect(bulk).not.toContainText("Saved centrally");
  await bulk.getByRole("button", { name: "Check saved operation", exact: true }).click();
  await expect(bulk).toContainText("Saved centrally");
  expect(await writes(page)).toBe(1);
});

test("returning to Users retains a pending bulk operation and offers receipt recovery", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => ((window as any).bulkHold = "apply"));
  await apply(page);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  const bulk = page.locator("hikvision-bulk-users");
  await expect(bulk).toContainText("bulk-1");
  await bulk.getByRole("button", { name: "Check saved operation", exact: true }).click();
  await expect(bulk).toContainText("Saved centrally");
  await page.evaluate(() => (window as any).bulkLate());
  expect(await writes(page)).toBe(1);
});

test("HA disconnect releases a pending bulk save and reconnect does not replay it", async ({
  page,
}) => {
  const bulk = await setup(page);
  await page.evaluate(() => ((window as any).bulkHold = "apply"));
  await apply(page);
  await page.evaluate(() => (window as any).bulkEvent("disconnected"));
  await expect(bulk).toContainText("The response was lost");
  await page.evaluate(() => (window as any).bulkEvent("ready"));
  await expect(
    bulk.getByRole("button", { name: "Check saved operation", exact: true }),
  ).toBeEnabled();
  expect(await writes(page)).toBe(1);
  await bulk.getByRole("button", { name: "Check saved operation", exact: true }).click();
  await expect(bulk).toContainText("Saved centrally");
});

test("receipt lookup can time out and retry while retaining the original operation", async ({
  page,
}) => {
  const bulk = await setup(page);
  await page.evaluate(() => ((window as any).bulkHold = "apply"));
  await page.clock.install();
  await apply(page);
  await page.clock.fastForward(61000);
  await page.evaluate(() => ((window as any).bulkHold = "receipt"));
  await bulk.getByRole("button", { name: "Check saved operation", exact: true }).click();
  await page.clock.fastForward(31000);
  await expect(
    bulk.getByRole("button", { name: "Check saved operation", exact: true }),
  ).toBeEnabled();
  await expect(bulk).toContainText("bulk-1");
  await page.evaluate(() => ((window as any).bulkHold = ""));
  await bulk.getByRole("button", { name: "Check saved operation", exact: true }).click();
  await expect(bulk).toContainText("Saved centrally");
  expect(await writes(page)).toBe(1);
});

test("known rejected bulk review permits a fresh review without suggesting a saved change", async ({
  page,
}) => {
  const bulk = await setup(page);
  await page.evaluate(() => ((window as any).bulkReject = true));
  await apply(page);
  await expect(bulk.getByRole("alert")).toContainText("Review expired");
  await expect(
    bulk.getByRole("button", { name: "Check saved operation", exact: true }),
  ).toHaveCount(0);
  await expect(
    bulk.getByRole("button", { name: "Review group action", exact: true }),
  ).toBeEnabled();
});

test("a new HA connection cannot inherit a pending bulk operation", async ({ page }) => {
  const bulk = await setup(page);
  await page.evaluate(() => ((window as any).bulkHold = "apply"));
  await apply(page);
  await bulk.evaluate(async (node: any) => {
    node.hass = { ...node.hass, connection: { ...node.hass.connection } };
    await node.updateComplete;
  });
  await page.evaluate(() => (window as any).bulkLate());
  await expect(bulk).not.toContainText("bulk-1");
  await expect(bulk).not.toContainText("Saved centrally");
  await expect(
    bulk.getByRole("button", { name: "Review group action", exact: true }),
  ).toBeEnabled();
});
