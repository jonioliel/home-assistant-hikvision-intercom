import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function open(page: Page) {
  await page.goto("/?platform");
  await page.evaluate(async () => {
    await customElements.whenDefined("wiskey-station-lifecycle-review");
    window.lifecycleCalls = [];
    window.lifecycleResult = {
      affected_people: 2,
      rows_complete: true,
      row_budget: 200,
      known_bindings: 1,
      unknown_owners: null,
      pending_cleanup: { tombstones: 1, retired_cards: 0, retired_pins: 0 },
      blockers: [],
      groups: [{ label: "Staff group", enabled: true, before: ["old"], after: ["new"] }],
      stations: [
        {
          id: "old",
          name: "Old station",
          identity_verified: true,
          error: null,
          mappings: [{ physical_index: 1, api_id: 2, name: "Main door" }],
        },
      ],
      rows: [
        {
          user_id: "a",
          display_name: "Inherited person",
          active: true,
          source_permission: "group",
          locks: [1],
          before: ["old"],
          after: ["new"],
          native_schedule: false,
        },
        {
          user_id: "b",
          display_name: "Blocked person",
          active: false,
          source_permission: "deny",
          locks: [],
          before: [],
          after: [],
          native_schedule: false,
        },
      ],
    };
    const node = document.createElement("wiskey-station-lifecycle-review");
    node.id = "lifecycle-test";
    node.style.width = "100%";
    node.catalog = { old: "Old station", new: "New station" };
    node.hass = {
      ...window.demoHass,
      callWS: async (message) => {
        window.lifecycleCalls.push(message);
        return window.lifecycleResult;
      },
    };
    document.body.append(node);
  });
  return page.locator("#lifecycle-test");
}
test("impact review is explicit, read only and shows permission origin with physical/API mapping", async ({
  page,
}) => {
  const node = await open(page);
  expect(await page.evaluate(() => window.lifecycleCalls)).toHaveLength(0);
  await node.getByLabel("Source station", { exact: true }).selectOption("old");
  await node.getByLabel("Replacement station", { exact: true }).selectOption("new");
  await node.getByRole("button", { name: "Review impact", exact: true }).click();
  await expect(node.getByRole("table")).toContainText("Inherited person");
  await expect(node.getByRole("table")).toContainText("Personal denial");
  await expect(node).toContainText("Physical lock 1 → API 2");
  await expect(node).toContainText("Unknown ownership in cached inventory: Unknown");
  await expect(node.getByRole("button")).toHaveCount(1);
  expect(await page.evaluate(() => window.lifecycleCalls.map((c) => c.type))).toEqual([
    "hikvision_intercom/platform/lifecycle_review",
  ]);
});
test("changing station clears projected details and mobile layout has no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const node = await open(page);
  await node.getByLabel("Source station", { exact: true }).selectOption("old");
  await node.getByRole("button", { name: "Review impact", exact: true }).click();
  await expect(node.getByRole("table")).toBeVisible();
  expect(await node.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await node.getByLabel("Source station", { exact: true }).selectOption("new");
  await expect(node.getByRole("table")).toHaveCount(0);
});
test("role loss discards an in-flight response and clears person details", async ({ page }) => {
  const node = await open(page);
  await page.evaluate(() => {
    const node = document.querySelector("#lifecycle-test");
    node.hass = {
      ...node.hass,
      callWS: () =>
        new Promise((resolve) => {
          window.releaseLifecycle = resolve;
        }),
    };
  });
  await node.getByLabel("Source station", { exact: true }).selectOption("old");
  await node.getByRole("button", { name: "Review impact", exact: true }).click();
  await expect(node.getByRole("button", { name: "Reading…", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    const node = document.querySelector("#lifecycle-test");
    node.hass = { ...node.hass, user: { ...node.hass.user, is_admin: false } };
    window.releaseLifecycle(window.lifecycleResult);
  });
  await expect(node.getByRole("table")).toHaveCount(0);
  await expect(node).not.toContainText("Inherited person");
});

test("saved plans require reading and explicit confirmation before apply and removal", async ({
  page,
}) => {
  const node = await open(page);
  await page.evaluate(() => {
    const el = document.querySelector("#lifecycle-test");
    el.transactions = true;
    window.savedJob = {
      id: "saved",
      source_id: "old",
      target_id: "new",
      state: "prepared",
      fingerprint: "bound-plan",
      own_request: true,
      require_approval: false,
      approval_state: "pending",
      source_name: "Old station",
      target_name: "New station",
      metadata_applied: false,
    };
    el.hass = {
      ...el.hass,
      callWS: async (message) => {
        window.lifecycleCalls.push(message);
        if (message.type.endsWith("lifecycle_plan"))
          return { job: window.savedJob, impact: window.lifecycleResult };
        if (message.type.endsWith("lifecycle_apply")) {
          window.savedJob.state = "applied";
          window.savedJob.metadata_applied = true;
        }
        if (message.type.endsWith("lifecycle_verify")) window.savedJob.state = "verified";
        if (message.type.endsWith("lifecycle_remove")) window.savedJob.state = "removed";
        return { records: [{ ...window.savedJob }] };
      },
    };
  });
  await node.getByRole("button", { name: "Reload saved plans", exact: true }).click();
  await expect(
    node.getByRole("button", { name: "Apply reviewed transfer", exact: true }),
  ).toBeDisabled();
  await expect(node.getByRole("checkbox")).toBeDisabled();
  await node.getByRole("button", { name: "Read this saved plan", exact: true }).click();
  await expect(node.getByRole("table")).toContainText("Personal denial");
  await node.getByRole("checkbox").check();
  await node.getByRole("button", { name: "Apply reviewed transfer", exact: true }).click();
  await expect(node).toContainText("Waiting for verification");
  await expect(
    node.getByRole("button", { name: "Remove verified source connection", exact: true }),
  ).toHaveCount(0);
  await node.getByRole("checkbox").check();
  await node
    .getByRole("button", { name: "Verify synchronization and cleanup", exact: true })
    .click();
  await expect(
    node.getByRole("button", { name: "Remove verified source connection", exact: true }),
  ).toBeDisabled();
  await node.getByRole("checkbox").check();
  await node
    .getByRole("button", { name: "Remove verified source connection", exact: true })
    .click();
  await expect(node).toContainText("Connection removed");
  const calls = await page.evaluate(() =>
    window.lifecycleCalls.filter((c) => /lifecycle_(apply|remove)$/.test(c.type)),
  );
  expect(calls).toHaveLength(2);
  expect(calls.every((c) => c.confirmed && c.fingerprint === "bound-plan")).toBe(true);
});
test("saved plan approval stays manual and role loss clears the plans", async ({ page }) => {
  const node = await open(page);
  await page.evaluate(() => {
    const el = document.querySelector("#lifecycle-test");
    el.transactions = true;
    window.savedJob = {
      id: "second",
      source_id: "old",
      target_id: "new",
      state: "prepared",
      fingerprint: "review",
      own_request: false,
      require_approval: true,
      approval_state: "pending",
      source_name: "Old station",
      target_name: "New station",
    };
    el.hass = {
      ...el.hass,
      callWS: async (message) => {
        window.lifecycleCalls.push(message);
        if (message.type.endsWith("lifecycle_plan")) return { impact: window.lifecycleResult };
        if (message.type.endsWith("lifecycle_decide")) window.savedJob.approval_state = "approved";
        return { records: [{ ...window.savedJob }] };
      },
    };
  });
  await node.getByRole("button", { name: "Reload saved plans", exact: true }).click();
  await node.getByRole("button", { name: "Read this saved plan", exact: true }).click();
  await node.getByRole("checkbox").check();
  await node.getByRole("button", { name: "Approve plan", exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.lifecycleCalls.some((c) => c.type.endsWith("lifecycle_apply")),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const el = document.querySelector("#lifecycle-test");
    el.hass = { ...el.hass, user: { ...el.hass.user, is_admin: false } };
  });
  await expect(node.getByRole("article")).toHaveCount(0);
  await expect(node.getByRole("table")).toHaveCount(0);
});
