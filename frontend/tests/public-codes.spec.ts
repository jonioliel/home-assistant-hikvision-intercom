import { test, expect } from "@playwright/test";

test("public code add replace remove uses current code and clears secrets", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    const base = w.demoHass.callWS.bind(w.demoHass);
    let state = false;
    w.codeCalls = [];
    w.demoHass.callWS = async (m: any) => {
      if (!m.type.includes("technical_codes_")) return base(m);
      w.codeCalls.push(structuredClone(m));
      if (m.type.endsWith("write")) state = m.action !== "remove";
      return {
        status: { states: { public1Configured: state }, checked_at: "2026-09-16T00:00:00Z" },
        capabilities: { advertised: true, slots: [1], min: 4, max: 6 },
      };
    };
    const el = document.createElement("wiskey-public-codes") as any;
    el.hass = w.demoHass;
    el.station = { id: "station-1", integrated_locks: [{ physical_index: 1, api_id: 1 }] };
    document.body.append(el);
  });
  page.on("dialog", (d) => d.accept());
  const panel = page.locator("body > wiskey-public-codes");
  const slot = panel.locator("article").first();
  await slot.getByRole("button", { name: "Add code" }).click();
  await panel.getByLabel("New public code", { exact: true }).fill("654321");
  await panel.getByLabel("Repeat new code").fill("654321");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.locator("form")).toHaveCount(0);
  await slot.getByRole("button", { name: "Edit", exact: true }).click();
  await panel.getByLabel("Current public code").fill("654321");
  await panel.getByLabel("New public code", { exact: true }).fill("456789");
  await panel.getByLabel("Repeat new code").fill("456789");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await slot.getByRole("button", { name: "Remove", exact: true }).click();
  await panel.getByLabel("Current public code").fill("456789");
  await panel.locator("form").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(slot.getByRole("button", { name: "Add code" })).toBeEnabled();
  const calls = await page.evaluate(() =>
    (window as any).codeCalls.filter((c: any) => c.type.endsWith("write")),
  );
  expect(calls.map((c: any) => c.action)).toEqual(["add", "replace", "remove"]);
  expect(calls[1].old_pin).toBe("654321");
  expect(calls[2].old_pin).toBe("456789");
  await expect(panel.locator('input[type="password"]')).toHaveCount(0);
});

test("unsupported capability requires compatibility opt in and unknown slots remain disabled", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    const el = document.createElement("wiskey-public-codes") as any;
    el.hass = {
      ...w.demoHass,
      callWS: async () => ({
        status: { states: { public1Configured: false } },
        capabilities: { advertised: false, slots: [1, 2], min: 4, max: 6 },
      }),
    };
    el.station = { id: "station-1", integrated_locks: [{ physical_index: 1, api_id: 1 }] };
    document.body.append(el);
  });
  const panel = page.locator("body > wiskey-public-codes");
  await expect(panel.locator("article").first().getByRole("button")).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await expect(panel.locator("article").first().getByRole("button")).toBeEnabled();
  await expect(panel.locator("article").nth(1).getByRole("button")).toBeDisabled();
});
