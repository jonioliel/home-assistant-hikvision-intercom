import { test, expect } from "@playwright/test";

async function setup(page, width = 1440, language = "en") {
  await page.setViewportSize({ width, height: 950 });
  await page.goto("/?lang=" + language);
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    const job = {
      id: "job",
      revision: 1,
      kind: "csv",
      state: "paused",
      total: 1,
      saved: 0,
      failed: 0,
      pending: 1,
      errors: [],
      approval: null,
    };
    window.demoHass.callWS = async (message) => {
      if (!message.type.includes("/jobs/")) return base(message);
      window.calls.push(message);
      const owner = window.demoHass.user.id !== "second";
      if (message.type.endsWith("jobs/list"))
        return {
          records: owner ? [structuredClone(job)] : [],
          reviews: !owner && job.approval?.state === "pending" ? [structuredClone(job)] : [],
          dual_approval: true,
        };
      if (message.type.endsWith("approval_request")) {
        job.approval = { state: "pending", action: "resume", expires_at: "2030-01-01T00:00:00Z" };
        job.revision++;
        return structuredClone(job);
      }
      if (message.type.endsWith("approval_review"))
        return {
          ...structuredClone(job),
          review_id: "reviewed-version",
          own_request: owner,
          impact: [
            {
              fields: ["active"],
              delete: false,
              before: {
                display_name: "Reviewed person",
                active: true,
                pin_configured: true,
                card_count: 1,
                assignments: { "station-0": { enabled: true, allowed_locks: [1] } },
              },
              after: {
                display_name: "Reviewed person",
                active: false,
                pin_configured: true,
                card_count: 1,
                assignments: {},
              },
            },
          ],
        };
      if (message.type.endsWith("approval_decide")) {
        job.approval.state = message.approve ? "approved" : "rejected";
        job.revision++;
        return structuredClone(job);
      }
      if (message.type.endsWith("jobs/action")) {
        job.state = "completed";
        job.saved = 1;
        job.pending = 0;
        return structuredClone(job);
      }
      throw { code: "unknown_command" };
    };
    const node = document.createElement("wiskey-checkpoint-jobs");
    node.hass = { ...window.demoHass };
    node.stations = window.demoData.stations;
    document.body.append(node);
  });
  return page.locator("wiskey-checkpoint-jobs").last();
}

test("a requester waits for a reviewed second approval and never starts automatically", async ({
  page,
}) => {
  const jobs = await setup(page);
  await expect(jobs.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
  await jobs.getByRole("button", { name: "Request second approval", exact: true }).click();
  await expect(jobs).toContainText("Awaiting review");
  await jobs.getByRole("button", { name: "Review job", exact: true }).click();
  await expect(jobs.locator(".job-approval-review")).toContainText("Reviewed person");
  await expect(jobs.getByRole("button", { name: "Approve reviewed job", exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => window.calls.some((call) => call.type.endsWith("jobs/action"))),
  ).toBe(false);
  await page.evaluate(() => {
    window.demoHass.user = { ...window.demoHass.user, id: "second" };
    document.querySelector("wiskey-checkpoint-jobs").hass = { ...window.demoHass };
  });
  await jobs.getByRole("button", { name: "Review job", exact: true }).click();
  await jobs.getByRole("button", { name: "Approve reviewed job", exact: true }).click();
  expect(
    await page.evaluate(() => window.calls.some((call) => call.type.endsWith("jobs/action"))),
  ).toBe(false);
  await page.evaluate(() => {
    window.demoHass.user = { ...window.demoHass.user, id: "admin" };
    document.querySelector("wiskey-checkpoint-jobs").hass = { ...window.demoHass };
  });
  await expect(jobs.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await jobs.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(jobs).toContainText("Completed");
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("jobs/action")).length,
    ),
  ).toBe(1);
});

test("Hebrew review fits a phone and role revocation clears it", async ({ page }) => {
  const jobs = await setup(page, 390, "he");
  await jobs.getByRole("button", { name: "בקשת אישור נוסף", exact: true }).click();
  await jobs.getByRole("button", { name: "סקירת עבודה", exact: true }).click();
  await jobs.getByText("לפני", { exact: true }).click();
  await expect(jobs.locator(".job-approval-review")).toContainText("Reviewed person");
  expect(await jobs.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await jobs.evaluate(
    (node: any) => (node.hass = { ...node.hass, user: { ...node.hass.user, is_admin: false } }),
  );
  await expect(jobs).not.toContainText("Reviewed person");
  expect(await jobs.evaluate((node: any) => node.rows.length === 0 && !node.review)).toBe(true);
});

test("fleet review approves only a preview and never dispatches settings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    let state = "pending";
    window.demoHass.callWS = async (message) => {
      if (!message.type.includes("/platform/config_")) return base(message);
      window.calls.push(message);
      const row = {
        review_id: "fleet-review",
        own_request: false,
        state,
        station_count: 1,
        remaining_seconds: 300,
      };
      if (message.type.endsWith("config_pending"))
        return { records: state === "pending" ? [row] : [] };
      if (message.type.endsWith("config_review"))
        return {
          ...row,
          fingerprint: "exact-plan",
          rows: [
            { name: "Lobby", door: 1, before: { openDuration: 5 }, after: { openDuration: 7 } },
          ],
        };
      if (message.type.endsWith("config_decide")) {
        state = "approved";
        return row;
      }
      throw { code: "unexpected_write" };
    };
    const node = document.createElement("wiskey-fleet-approval");
    node.hass = { ...window.demoHass };
    document.body.append(node);
  });
  const fleet = page.locator("wiskey-fleet-approval");
  await fleet.getByRole("button", { name: "Review fleet changes", exact: true }).click();
  await expect(fleet.locator(".fleet-consent-plan")).toContainText("Lobby");
  expect(await fleet.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await fleet.getByRole("button", { name: "Approve fleet changes", exact: true }).click();
  const messages = await page.evaluate(() =>
    window.calls.filter((call) => call.type.includes("/platform/config_")),
  );
  expect(messages.find((call) => call.type.endsWith("config_decide"))).toMatchObject({
    fingerprint: "exact-plan",
    confirmed: true,
    approve: true,
  });
  expect(messages.some((call) => call.type.endsWith("config_apply"))).toBe(false);
});
