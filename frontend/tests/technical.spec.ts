import { test, expect } from "@playwright/test";
test("station audit shows unknown separately and changes require confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    const base = w.demoHass.callWS.bind(w.demoHass);
    w.demoHass.callWS = async (m: any) => {
      if (m.type.endsWith("stations/technical_get"))
        return {
          checked_at: "2026-09-15T00:00:00Z",
          passwords: { public_pin_state: "unknown", states: {} },
          features: [],
          doors: [
            {
              door: 1,
              values: { openDuration: 2 },
              constraints: { openDuration: { type: "integer", min: 1, max: 255 } },
            },
            { door: 2, error: "operation_unsupported" },
          ],
        };
      return base(m);
    };
    const el = document.createElement("hikvision-station-technical") as any;
    el.hass = w.demoHass;
    el.station = { id: "station-1", integrated_locks: [{ physical_index: 1, api_id: 1 }] };
    document.body.append(el);
  });
  const panel = page.locator("body > hikvision-station-technical");
  await panel.locator(":scope > details > summary").click();
  await panel.getByRole("button", { name: "Read station settings" }).click();
  await expect(panel.getByText("Public PIN status is unknown.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await panel.getByRole("spinbutton").fill("5");
  await expect(panel.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await panel.locator("form").getByRole("checkbox").check();
  await expect(panel.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("hold-open draft is per door, copied explicitly and cannot activate a station", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    const base = w.demoHass.callWS.bind(w.demoHass);
    w.holdCalls = [];
    w.demoHass.callWS = async (m: any) => {
      w.holdCalls.push(m);
      if (m.type.endsWith("technical_hold_get"))
        return { draft: null, timezone: "Asia/Jerusalem", active: false };
      if (m.type.endsWith("schedules/list"))
        return [
          {
            id: "cleaning",
            name: "Cleaning",
            weekly: { Monday: [{ start: "12:00", end: "18:00" }] },
            holidays: [],
          },
        ];
      if (m.type.endsWith("technical_hold_save"))
        return { draft: { revision: 1, policy: m.policy }, active: false };
      return base(m);
    };
    const el = document.createElement("hikvision-hold-open") as any;
    el.hass = w.demoHass;
    el.station = {
      id: "station-1",
      integrated_locks: [
        { physical_index: 1, api_id: 1 },
        { physical_index: 2, api_id: 2 },
      ],
    };
    document.body.append(el);
  });
  const panel = page.locator("body > hikvision-hold-open");
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "Load door draft" }).click();
  await expect(panel.getByText(/Draft only/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save draft only" })).toBeDisabled();
  await panel.getByLabel("Schedule to copy").selectOption("cleaning");
  await panel.getByRole("button", { name: "Save draft only" }).click();
  await expect(panel.getByText("Saved draft: Cleaning")).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).holdCalls.filter((m: any) => m.type.endsWith("technical_hold_save")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].door).toBe(1);
  expect(calls[0].policy.timezone).toBe("Asia/Jerusalem");
  expect(calls[0]).not.toHaveProperty("enabled");
});

test("two relays have distinct labels and independent pending commands", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    w.demoData.stations[0].integrated_locks = [
      { physical_index: 1, api_id: 2 },
      { physical_index: 2, api_id: 1 },
    ];
    const base = w.demoHass.callWS.bind(w.demoHass);
    w.relayWrites = [];
    w.demoHass.callWS = (m: any) => {
      if (m.type.endsWith("stations/test_unlock")) {
        w.relayWrites.push(m);
        return new Promise(() => {});
      }
      return base(m);
    };
    return (document.querySelector("smplwise-access-control-panel") as any).refresh();
  });
  const card = page.locator("article.station").first();
  const buttons = card.locator("button[aria-label^='Open ']");
  await expect(buttons).toHaveCount(2);
  expect(await buttons.nth(0).getAttribute("aria-label")).not.toBe(
    await buttons.nth(1).getAttribute("aria-label"),
  );
  await buttons.nth(1).click();
  await expect(buttons.nth(1)).toBeDisabled();
  await expect(buttons.nth(0)).toBeEnabled();
  expect(await page.evaluate(() => (window as any).relayWrites)).toEqual([
    { type: "smplwise_access_control/stations/test_unlock", station_id: "station-0", lock: 2 },
  ]);
});
