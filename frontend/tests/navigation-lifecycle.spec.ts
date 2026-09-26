import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";

test("repeated navigation releases connection listeners and never replays a device action", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const listeners = new Map<string, Set<() => void>>();
    const base = window.demoHass.callWS;
    window.listenerCount = () =>
      [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
    window.demoHass.connection = {
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
    window.demoHass.callWS = async function (message) {
      if (message.type.includes("/health/"))
        return {
          generated_at: new Date().toISOString(),
          model: "test",
          media: { call_commands: ["answer", "reject", "hangUp"] },
        };
      return base.call(this, message);
    };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  const count = () => page.evaluate(() => window.listenerCount());
  await expect(
    page
      .locator("hikvision-intercom-call-controls")
      .first()
      .getByRole("button", { name: "Answer signal", exact: true }),
  ).toBeEnabled();
  const baseline = await count();
  expect(baseline).toBeGreaterThan(0);
  for (let cycle = 0; cycle < 12; cycle++) {
    await navigate(page, "Health & field tests");
    const health = page.locator("hikvision-intercom-health");
    await health
      .locator(".health-card")
      .first()
      .getByText("Call signaling", { exact: true })
      .click();
    await expect(
      health
        .locator("hikvision-intercom-call-controls")
        .getByRole("button", { name: "Refresh call state", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Events", exact: true }).click();
    await expect(page.locator("hikvision-intercom-events .audit-row")).toHaveCount(2);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect.poll(count).toBe(baseline);
    await expect(page.locator("hikvision-intercom-health")).toHaveCount(0);
    await expect(page.locator("hikvision-intercom-event-tools")).toHaveCount(0);
  }
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.type.includes("unlock") ||
          c.type.endsWith("media/signal") ||
          c.type.endsWith("acceptance/update") ||
          c.type.endsWith("trace_start"),
      ),
    ),
  ).toBe(false);
});
