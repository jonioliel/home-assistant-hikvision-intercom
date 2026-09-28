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
