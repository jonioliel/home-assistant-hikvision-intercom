import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

async function open(page: import("@playwright/test").Page, he = false) {
  await page.goto("/?platform&maintenance" + (he ? "&lang=he" : ""));
  await navigate(page, he ? "תפעול צי ודוחות" : "Fleet and reporting");
  const center = page.locator("wiskey-platform-center");
  await center
    .getByRole("button", { name: he ? "הגדרות צי" : "Fleet configuration", exact: true })
    .click();
  return { center, queue: center.locator("wiskey-maintenance-queue") };
}

test("scheduled review is retained across infrastructure updates and queue needs explicit approval", async ({
  page,
}) => {
  const { center, queue } = await open(page);
  await center.getByLabel("Main gate", { exact: true }).check();
  await center.getByLabel("Opening duration in seconds (optional)", { exact: true }).fill("7");
  await queue.getByRole("button", { name: "Review scheduled job", exact: true }).click();
  await expect(queue.getByText("08:00–18:00 · Asia/Jerusalem", { exact: true })).toBeVisible();
  const enqueue = queue.getByRole("button", { name: "Queue approved plan", exact: true });
  await expect(enqueue).toBeDisabled();
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = { ...window.demoHass };
    panel.requestUpdate();
  });
  await expect(enqueue).toBeVisible();
  await queue.getByLabel("I approve this exact plan and its windows", { exact: true }).check();
  await enqueue.click();
  await expect(queue.getByText("Waiting for window", { exact: true })).toBeVisible();
  const cancel = queue.getByRole("button", { name: "Cancel pending changes", exact: true });
  await expect(cancel).toBeDisabled();
  await queue.getByLabel("I reviewed this saved plan", { exact: true }).check();
  await cancel.click();
  await expect(queue.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) => c.type.endsWith("config_apply") || c.type.endsWith("stations/unlock"),
      ),
    ),
  ).toBe(false);
});

test("changing selected values invalidates scheduled review without queueing", async ({ page }) => {
  const { center, queue } = await open(page);
  await center.getByLabel("Main gate", { exact: true }).check();
  await center.getByLabel("Opening duration in seconds (optional)", { exact: true }).fill("7");
  await queue.getByRole("button", { name: "Review scheduled job", exact: true }).click();
  await expect(
    queue.getByRole("button", { name: "Queue approved plan", exact: true }),
  ).toBeVisible();
  await center.getByLabel("Opening duration in seconds (optional)", { exact: true }).fill("8");
  await expect(queue.getByRole("button", { name: "Queue approved plan", exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("maintenance_enqueue"))),
  ).toBe(false);
});

test("another administrator approves only the exact saved plan", async ({ page }) => {
  const { queue } = await open(page);
  await page.evaluate(() => {
    window.maintenanceJobs = [
      {
        id: "other-job",
        fingerprint: "exact-other-plan",
        actor: "other",
        own_request: false,
        state: "awaiting_approval",
        created_at: "2026-09-29T02:00:00Z",
        expires_at: "2026-10-07T02:00:00Z",
        consent: null,
        rows: [
          {
            station_id: "station-0",
            name: "Main gate",
            before: { openDuration: 5 },
            after: { openDuration: 7 },
            state: "pending",
          },
        ],
      },
    ];
  });
  await queue.getByRole("button", { name: "Refresh saved jobs", exact: true }).click();
  const approve = queue.getByRole("button", { name: "Second approval", exact: true });
  await expect(approve).toBeDisabled();
  await queue.getByLabel("I reviewed this saved plan", { exact: true }).check();
  await approve.click();
  expect(
    await page.evaluate(() => window.calls.find((c) => c.type.endsWith("maintenance_decide"))),
  ).toMatchObject({
    job_id: "other-job",
    fingerprint: "exact-other-plan",
    confirmed: true,
    approve: true,
  });
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("config_apply")))).toBe(
    false,
  );
});

test("Hebrew mobile queue fits and clears when administrator access is removed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { queue } = await open(page, true);
  await expect(
    queue.getByRole("heading", { name: "תזמון שינויים שנסקרו", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => {
    window.demoHass.user = { id: "reader", is_admin: false };
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = { ...window.demoHass };
    panel.requestUpdate();
  });
  await expect(
    queue.getByRole("heading", { name: "תזמון שינויים שנסקרו", exact: true }),
  ).toHaveCount(0);
});
