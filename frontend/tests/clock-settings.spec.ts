import { test, expect } from "@playwright/test";

async function setup(page: any) {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    w.clockCalls = [];
    let policy = { revision: 0, server: "time.windows.com", port: 123, interval: 60 };
    const el = document.createElement("hikvision-clock-settings") as any;
    el.hass = {
      ...w.demoHass,
      language: "en",
      callWS: async (m: any) => {
        w.clockCalls.push(m);
        if (m.type.endsWith("settings_get")) return policy;
        if (m.type.endsWith("settings_update"))
          return (policy = { ...m.values, revision: policy.revision + 1 });
        if (m.type.endsWith("host_status")) return { supported: false, synchronized: false };
        if (m.station_id === "one") throw { code: "device_unavailable" };
        return { configuration_verified: true, clock_verified: false };
      },
    };
    el.stations = [
      { id: "one", name: "First", loaded: true, online: true },
      { id: "two", name: "Second", loaded: true, online: true },
    ];
    document.body.append(el);
  });
  return page.locator("body > hikvision-clock-settings");
}

test("central settings save separately and bulk failure does not stop next station", async ({
  page,
}) => {
  const panel = await setup(page);
  await panel.getByLabel("NTP server", { exact: true }).fill("time.google.com");
  await expect(
    panel.getByRole("button", { name: "Apply NTP to all stations", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(panel.getByText("Settings saved; not yet applied.")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).clockCalls.filter((x: any) => x.type.endsWith("station_sync")).length,
    ),
  ).toBe(0);
  await panel.getByRole("button", { name: "Apply NTP to all stations", exact: true }).click();
  await expect(
    panel.getByText("NTP configuration verified; waiting for clock alignment."),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).clockCalls.filter((x: any) => x.type.endsWith("station_sync")),
  );
  expect(calls.map((x: any) => x.station_id)).toEqual(["one", "two"]);
  expect(calls.every((x: any) => x.revision === 1 && !x.copy_system)).toBe(true);
  await expect(
    panel.getByRole("button", { name: "Apply NTP to Home Assistant", exact: true }),
  ).toHaveCount(0);
});

test("per-station immediate sync only targets selected station on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await setup(page);
  await panel
    .locator(".clock-row")
    .nth(1)
    .getByRole("button", { name: "Synchronize clock to system", exact: true })
    .click();
  await expect(
    panel.getByText("NTP configuration verified; waiting for clock alignment."),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).clockCalls.filter((x: any) => x.type.endsWith("station_sync")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].copy_system).toBe(true);
  expect(calls[0].station_id).toBe("two");
});
