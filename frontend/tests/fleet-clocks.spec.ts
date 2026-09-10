import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation";

async function setup(page: Page, language = "en") {
  await page.clock.install({ time: new Date("2026-09-11T12:00:00Z") });
  await page.goto("/");
  await navigate(page, "Health & field tests");
  await expect(page.locator("hikvision-intercom-fleet-clocks")).toBeAttached();
  await page.evaluate((language) => {
    const hass = {
      ...window.demoHass,
      language,
      callWS: async () => {
        window.fleetCalls++;
        throw new Error("unexpected request");
      },
    };
    document.querySelector("hikvision-intercom-panel").remove();
    window.fleetCalls = 0;
    const view: any = document.createElement("hikvision-intercom-fleet-clocks");
    const clock = {
      status: "ready",
      source: "manual",
      zone: { kind: "iana", name: "Asia/Jerusalem" },
      device_zone: {
        kind: "device",
        name: "CST-2:00:00DST01:00:00,M4.1.0/02:00:00,M10.5.0/02:00:00",
        standard: 7200,
        delta: 3600,
        start: [4, 1, 0, 7200],
        end: [10, 5, 0, 7200],
      },
      checked_at: "2026-09-11T12:00:00Z",
      time_mode: "NTP",
      drift_state: "repeated_ahead",
      measurement: {
        status: "measured",
        estimated_skew_seconds: 121,
        uncertainty_seconds: 2,
        duration_seconds: 2,
      },
      next_transition: {
        status: "scheduled",
        at: "2026-10-24T23:00:00Z",
        before_seconds: 10800,
        after_seconds: 7200,
      },
    };
    view.hass = hass;
    view.stations = [
      { id: "first", name: "Entrance", clock },
      { id: "stale", name: "Garage", clock: { ...clock, checked_at: "2026-09-11T10:00:00Z" } },
      {
        id: "unknown",
        name: "Hall",
        clock: {
          ...clock,
          measurement: null,
          drift_state: "not_measured",
          time_mode: "manual",
          device_zone: { kind: "iana", name: "UTC" },
          next_transition: { status: "fixed" },
        },
      },
    ];
    document.body.append(view);
    window.fleetView = view;
  }, language);
  const view = page.locator("hikvision-intercom-fleet-clocks");
  await view.locator("summary").click();
  return view;
}

test("fleet clocks distinguish fresh, stale and unmeasured data without issuing requests", async ({
  page,
}) => {
  const view = await setup(page);
  const first = view.locator('[data-station="first"]');
  await expect(first).toContainText("Repeated observations");
  await expect(first).toContainText("121 ± 2");
  await expect(first).toContainText("Manual display time zone");
  await expect(first).toContainText("Asia/Jerusalem");
  await expect(first.locator(".transition")).toContainText("UTC+03:00 → UTC+02:00");
  await expect(view.locator('[data-station="stale"] .drift')).toContainText(
    "No current measurement",
  );
  await expect(view.locator('[data-station="stale"] .transition')).toContainText("Not computed");
  await expect(view.locator('[data-station="unknown"] .drift')).toContainText("not measured");
  await expect(view.locator(".notice")).toContainText("different time sources or zone rules");
  await page.clock.fastForward(31 * 60000);
  await expect(first.locator(".drift")).toContainText("No current measurement");
  expect(await page.evaluate(() => window.fleetCalls)).toBe(0);
  await view.evaluate((node: any) => {
    node.hass = { ...node.hass, user: { ...node.hass.user, is_admin: false } };
  });
  await expect(view.locator("summary")).toHaveCount(0);
});

test("newer overview supersedes cached health and same-sample failure cannot appear healthy", async ({
  page,
}) => {
  const view = await setup(page);
  await view.evaluate((node: any) => {
    node.reports = { first: { clock: { ...node.stations[0].clock, status: "stale" } } };
  });
  await expect(view.locator('[data-station="first"] .drift')).toContainText(
    "No current measurement",
  );
  await view.evaluate((node: any) => {
    node.stations = node.stations.map((s: any) =>
      s.id === "first"
        ? {
            ...s,
            clock: {
              ...s.clock,
              checked_at: "2026-09-11T12:00:01Z",
              drift_state: "within_tolerance",
            },
          }
        : s,
    );
  });
  await expect(view.locator('[data-station="first"] .drift')).toContainText(
    "Within the 90-second tolerance",
  );
  await view.evaluate((node: any) => node.remove());
  await page.clock.fastForward(3600000);
  expect(await page.evaluate(() => window.fleetCalls)).toBe(0);
});

for (const width of [360, 768, 1440])
  test("Hebrew fleet clock comparison fits " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const view = await setup(page, "he");
    await expect(view).toContainText("השוואת שעוני התחנות");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await expect(view.locator("article")).toHaveCount(3);
  });
