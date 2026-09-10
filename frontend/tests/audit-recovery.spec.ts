import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, delayed: string) {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any,
      base = w.demoHass.callWS;
    w.auditDelayed = "";
    w.demoHass.callWS = async function (message: any) {
      if (!message.type.includes("/audit/") && !message.type.endsWith("permission_audit"))
        return base.call(this, message);
      w.calls.push(structuredClone(message));
      const result = message.type.endsWith("permission_audit")
        ? {
            station_id: message.station_id,
            checked_at: new Date().toISOString(),
            complete: true,
            rows: [],
            counts: {},
            total_candidates: 0,
          }
        : { records: [], actors: {}, next_cursor: null, total: 0, csv: "header" };
      if (message.type.endsWith(w.auditDelayed) && w.auditDelayed)
        return new Promise((resolve) => {
          w.auditLate = () => resolve(result);
        });
      return result;
    };
  });
  await page.getByRole("button", { name: "Change history", exact: true }).click();
  const audit = page.locator("hikvision-admin-audit");
  await expect(
    audit.getByRole("button", { name: "Export change history CSV", exact: true }),
  ).toBeEnabled();
  await page.evaluate((command) => {
    (window as any).auditDelayed = command;
  }, delayed);
  return audit;
}

for (const [command, timeout] of [
  ["audit/list", 21000],
  ["audit/export", 61000],
  ["permission_audit", 121000],
] as const) {
  test(`missing ${command} reply becomes retryable and late responses are discarded`, async ({
    page,
  }) => {
    const audit = await setup(page, command);
    const downloads: unknown[] = [];
    page.on("download", (value) => downloads.push(value));
    await page.clock.install();
    if (command === "audit/list") {
      await audit.locator(".audit-filters summary").click();
      await audit.locator("form button").click();
    } else if (command === "audit/export") {
      await audit.getByRole("button", { name: "Export change history CSV", exact: true }).click();
    } else {
      await audit.locator(".permission select").selectOption("station-0");
      await audit.getByRole("button", { name: "Compare station permissions", exact: true }).click();
    }
    await page.clock.fastForward(timeout);
    await expect(audit.getByRole("alert")).toBeVisible();
    await expect(
      audit.getByRole("button", { name: "Export change history CSV", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => (window as any).auditLate());
    await expect(audit.getByRole("alert")).toBeVisible();
    expect(downloads).toHaveLength(0);
  });
}

test("reattaching a busy history view loads a fresh list", async ({ page }) => {
  const audit = await setup(page, "audit/list");
  await audit.locator(".audit-filters summary").click();
  await audit.locator("form button").click();
  await audit.evaluate((node: any) => {
    (window as any).auditDelayed = "";
    node.remove();
    document.body.append(node);
  });
  await expect(
    audit.getByRole("button", { name: "Export change history CSV", exact: true }),
  ).toBeEnabled();
  const count = await page.evaluate(
    () => (window as any).calls.filter((c: any) => c.type.endsWith("audit/list")).length,
  );
  expect(count).toBe(3);
});

test("replacing the HA connection discards the previous history export", async ({ page }) => {
  const audit = await setup(page, "audit/export");
  const downloads: unknown[] = [];
  page.on("download", (value) => downloads.push(value));
  await audit.getByRole("button", { name: "Export change history CSV", exact: true }).click();
  await audit.evaluate(async (node: any) => {
    node.hass = { ...node.hass, connection: { ...node.hass.connection } };
    await node.updateComplete;
  });
  await page.evaluate(() => (window as any).auditLate());
  await expect(
    audit.getByRole("button", { name: "Export change history CSV", exact: true }),
  ).toBeEnabled();
  expect(downloads).toHaveLength(0);
});
