import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function setup(page) {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    const results = {};
    let revision = 0;
    window.demoHass.callWS = async (message) => {
      if (message.type.includes("/health/")) {
        window.calls.push(message);
        return {
          integration_version: "test",
          generated_at: "2026-09-09T12:00:00Z",
          model: "DS-KV6124-E1",
          firmware: "V3.9.0",
          online: true,
          access: { queue_depth: 2, errors: { readback_mismatch: 1 } },
          events: {
            stream: "connected",
            history: "recovered",
            reconnects: 0,
            telemetry: {
              stream_arrival_delay: { samples: 3, median: 1, p95: 2 },
              accepted: 4,
              duplicates: 1,
            },
          },
          clock: { skew_seconds: 1 },
          media: {
            call_commands: ["answer", "reject", "hangUp"],
            audio_channels: [{ id: 1, codec: "G.711ulaw", enabled: false }],
          },
        };
      }
      if (message.type.includes("/acceptance/")) {
        window.calls.push(message);
        const rows = (results[message.station_id] ??= {});
        if (message.type.endsWith("/update")) {
          if (message.revision !== revision) throw Error("revision");
          revision++;
          rows[message.step] = {
            state: message.state,
            checked_at: "2026-09-09T12:00:00Z",
            basis: "operator_report",
          };
        }
        return {
          revision,
          steps: ["relay", "pin_remove", "webrtc"],
          results: structuredClone(rows),
          basis: "operator_report",
        };
      }
      if (message.type.endsWith("events/list")) {
        const result = await base(message);
        result.records = result.records.map((row) => ({
          ...row,
          received_at: row.timestamp,
          time_source: "device",
          evidence: {
            identity_state: row.person_name ? "identified" : "identity_unavailable",
            origin: row.recovered ? "history_query" : "live_stream",
            arrival_delay_seconds: 0,
          },
        }));
        return result;
      }
      if (message.type.endsWith("events/support")) {
        window.calls.push(message);
        return {
          format: "hikvision_intercom.event_support",
          event: { major: 5, minor: 1 },
          evidence: { identity_state: "identity_unavailable" },
        };
      }
      if (message.type.endsWith("media/signal")) {
        window.calls.push(message);
        return {
          command: message.command,
          acknowledged: true,
          physical_result: "unverified",
          observation: "unchanged",
          observed_state: "ringing",
          checked_at: new Date().toISOString(),
        };
      }
      return base(message);
    };
  });
}

test("health shows queue reasons and refreshes selected stations only", async ({ page }) => {
  await setup(page);
  await navigate(page, "Health & field tests");
  const health = page.locator("hikvision-intercom-health");
  await expect(health.locator(".health-card")).toHaveCount(9);
  await expect(health.locator(".health-card").first()).toContainText("Pending sync jobs: 2");
  await health.getByRole("checkbox", { name: "Main gate", exact: true }).check();
  await health.getByRole("checkbox", { name: "Lobby entrance", exact: true }).check();
  await health.getByRole("button", { name: "Refresh selected stations" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.filter((c) => c.type.endsWith("health/refresh")).length),
    )
    .toBe(2);
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => c.type.includes("unlock") || c.type.includes("media/signal")),
    ),
  ).toBeFalsy();
});

test("field checklist starts unverified and records only an explicit save", async ({ page }) => {
  await setup(page);
  await navigate(page, "Health & field tests");
  const card = page.locator(".health-card").first();
  await card.getByRole("button", { name: "Record field tests" }).click();
  const select = card.getByRole("combobox", { name: "PIN removed, user retained, PIN rejected" });
  await expect(select).toHaveValue("unverified");
  await select.selectOption("passed");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("acceptance/update"))),
  ).toHaveLength(0);
  await card
    .locator("form")
    .filter({ hasText: "PIN removed, user retained, PIN rejected" })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.filter((c) => c.type.endsWith("acceptance/update")).length),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await navigate(page, "Health & field tests");
  await page
    .locator(".health-card")
    .first()
    .getByRole("button", { name: "Record field tests" })
    .click();
  await expect(
    page
      .locator(".health-card")
      .first()
      .getByRole("combobox", { name: "PIN removed, user retained, PIN rejected" }),
  ).toHaveValue("passed");
});

test("event evidence distinguishes history and exports no identity", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const row = page.locator(".audit-row").nth(1);
  await expect(row).toContainText("Retrieved from device history");
  await expect(row).toContainText("No user identity is available");
  await row.getByText("Event evidence", { exact: true }).click();
  const pending = page.waitForEvent("download");
  await row.getByRole("button", { name: "Export event diagnostics" }).click();
  const download = await pending;
  const content = await readFile((await download.path())!, "utf8");
  expect(content).toContain("event_support");
  expect(content).not.toContain("Dana");
  expect(content).not.toContain("station_id");
});

test("call signals require explicit action and reflect current call state", async ({ page }) => {
  await setup(page);
  await navigate(page, "Health & field tests");
  const first = page.locator(".health-card").first();
  await first.getByText("Call signaling", { exact: true }).click();
  await expect(first.getByRole("button", { name: "Hang up signal" })).toBeDisabled();
  await first.getByRole("button", { name: "Reject signal" }).click();
  await expect(first).toContainText("Command acknowledged · Device state has not changed");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/signal"))),
  ).toHaveLength(1);
  const second = page.locator(".health-card").nth(1);
  await second.getByText("Call signaling", { exact: true }).click();
  await expect(second.getByRole("button", { name: "Answer signal" })).toBeDisabled();
});

test("health data clears on administrator role loss", async ({ page }) => {
  await setup(page);
  await navigate(page, "Health & field tests");
  await expect(page.locator(".health-card")).toHaveCount(9);
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = { ...window.demoHass, user: { is_admin: false } };
  });
  await expect(page.locator(".health-card")).toHaveCount(0);
});

test("Hebrew health on mobile has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    window.demoHass.language = "he";
    panel.hass = { ...window.demoHass };
  });
  await page.getByRole("button", { name: "בריאות ובדיקות שטח", exact: true }).click();
  await expect(page.locator(".health-card")).toHaveCount(9);
  expect(
    await page.locator("hikvision-intercom-health").evaluate((el) => el.scrollWidth > 390),
  ).toBeFalsy();
  await page.screenshot({ path: "test-results/health-he-mobile.png", fullPage: true });
});

test("a lost health call command stops waiting and requires an explicit state refresh", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const base = window.demoHass.callWS;
    window.demoHass.callWS = async function (message) {
      const result = await base.call(this, message);
      if (message.type.endsWith("media/signal"))
        return await new Promise((resolve) => (window.healthLateSignal = () => resolve(result)));
      return result;
    };
  });
  await navigate(page, "Health & field tests");
  const card = page.locator(".health-card").first();
  await card.getByText("Call signaling", { exact: true }).click();
  await page.clock.install();
  await card.getByRole("button", { name: "Reject signal", exact: true }).click();
  await page.clock.fastForward(41000);
  await expect(card).toContainText("Command result could not be verified");
  await expect(card.getByRole("button", { name: "Refresh call state", exact: true })).toBeEnabled();
  await page.evaluate(() => window.healthLateSignal());
  await expect(card).not.toContainText("Command acknowledged");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/signal")).length),
  ).toBe(1);
});

test("a pending health call command remains owned by its station after switching to Overview", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const base = window.demoHass.callWS;
    window.demoHass.callWS = async function (message) {
      const result = await base.call(this, message);
      if (message.type.endsWith("media/signal"))
        return await new Promise((resolve) => (window.healthLateSignal = () => resolve(result)));
      return result;
    };
  });
  await navigate(page, "Health & field tests");
  const card = page.locator(".health-card").first();
  await card.getByText("Call signaling", { exact: true }).click();
  await card.getByRole("button", { name: "Reject signal", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  const controls = page.locator("hikvision-intercom-call-controls").first();
  await expect(controls.getByRole("button", { name: "Answer signal", exact: true })).toBeDisabled();
  await page.evaluate(() => window.healthLateSignal());
  await expect(controls.getByRole("button", { name: "Answer signal", exact: true })).toBeEnabled();
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/signal")).length),
  ).toBe(1);
});

test("health reads call state only after opening that station's call controls", async ({
  page,
}) => {
  await setup(page);
  await navigate(page, "Health & field tests");
  const health = page.locator("hikvision-intercom-health");
  await expect(
    health.getByRole("button", { name: "Export compatibility report", exact: true }).last(),
  ).toBeEnabled();
  await expect(health.locator("hikvision-intercom-call-controls")).toHaveCount(0);
  const count = () =>
    page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/call")).length);
  const before = await count();
  const first = health.locator(".health-card").first();
  await first.getByText("Call signaling", { exact: true }).click();
  await expect(first.getByRole("button", { name: "Reject signal", exact: true })).toBeEnabled();
  expect(await count()).toBe(before + 1);
  await first.getByText("Call signaling", { exact: true }).click();
  await expect(health.locator("hikvision-intercom-call-controls")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/signal")).length),
  ).toBe(0);
});
