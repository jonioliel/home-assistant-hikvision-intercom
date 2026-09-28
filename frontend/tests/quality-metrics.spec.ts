import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const [width, language] of [
  [390, "he"],
  [1440, "en"],
] as const) {
  test(`quality is observational and fits ${width} ${language}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/?lang=" + language);
    await page.evaluate(() => {
      const base = window.demoHass.callWS.bind(window.demoHass);
      window.demoHass.callWS = async (message) => {
        if (message.type.endsWith("health/get")) {
          const metrics = {
            requests: 40,
            sample_count: 40,
            p95_ms: 200,
            failure_percent: 10,
            window_failure_percent: 10,
            baseline_samples: 20,
            baseline_p95_ms: 100,
            comparison_samples: 20,
            p95_delta_ms: 100,
          };
          return {
            generated_at: new Date().toISOString(),
            quality: {
              requests: metrics,
              synchronization: { ...metrics, repeat_attempts_after_failure: 2 },
              door_commands: {
                ...metrics,
                requests: 0,
                p95_ms: null,
                failure_percent: null,
                window_failure_percent: null,
                baseline_p95_ms: null,
                p95_delta_ms: null,
              },
            },
            events: {
              stream: "connected",
              history: "unknown",
              telemetry: {
                transport_gaps: {
                  count: 1,
                  disconnected_seconds: 5,
                  open: false,
                  lost_event_count: null,
                },
              },
            },
          };
        }
        return base(message);
      };
    });
    await navigate(page, language === "he" ? "בריאות ובדיקות שטח" : "Health & field tests");
    const card = page.locator("hikvision-intercom-health .health-card").first();
    await card.locator(".health-quality summary").click();
    await expect(card.locator(".health-quality")).toContainText("200 ms");
    await expect(card.locator(".health-quality")).toContainText(
      language === "he" ? "אינו מאמת פתיחה פיזית" : "does not verify physical opening",
    );
    await expect(card.locator(".health-quality section").last()).toContainText("—");
    expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() =>
        window.calls.some((call) => /test_unlock|media\/signal/.test(call.type)),
      ),
    ).toBe(false);
  });
}

test("legacy health response never fabricates a quality reference", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Health & field tests");
  await expect(page.locator("hikvision-intercom-health .health-quality")).toHaveCount(0);
});
