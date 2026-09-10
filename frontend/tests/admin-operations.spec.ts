import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function setup(page, he = false) {
  await page.goto(he ? "/?lang=he" : "/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    let next = 0;
    const receipts = {};
    window.demoHass.callWS = async (message) => {
      const type = message.type.replace("hikvision_intercom/", "");
      if (type.startsWith("users/bulk_")) {
        window.calls.push(structuredClone(message));
        if (type === "users/bulk_preview") {
          const result = {
            operation_id: "operation-" + ++next,
            action: message.request.action,
            selected: message.request.selection.length,
            changed: message.request.selection.length,
            stations: ["station-0"],
            capacity: [
              {
                station_id: "station-0",
                users_now: 6,
                users_projected: 4,
                max_users: 2000,
                cards_now: 5,
                cards_projected: 3,
                max_cards: 10000,
                checked_at: "2026-09-09T10:00:00Z",
                capacity_warning: false,
              },
            ],
            rows: message.request.selection.map(({ user_id }) => {
              const u = window.demoData.users.find((x) => x.id === user_id);
              return {
                user_id,
                display_name: u.display_name,
                employee_no: u.employee_no,
                changed: true,
                changed_fields: ["active"],
                stations: ["station-0"],
              };
            }),
          };
          if (window.bulkDelay)
            return await new Promise((resolve) => (window.bulkResolve = () => resolve(result)));
          return result;
        }
        if (type === "users/bulk_apply") {
          const result = {
            operation_id: message.operation_id,
            action: "bulk/disable",
            saved_at: "2026-09-09T11:00:00Z",
            changed: 1,
            stations: ["station-0"],
            user_ids: ["person-0"],
          };
          receipts[message.operation_id] = result;
          if (window.bulkLost) throw { code: "connection_lost" };
          return result;
        }
        if (type === "users/bulk_receipt") return receipts[message.operation_id];
        return Object.values(receipts);
      }
      if (type.startsWith("audit/")) {
        window.calls.push(structuredClone(message));
        const record = {
          sequence: 3,
          time: "2026-09-09T11:00:00Z",
          actor: "admin-1",
          action: "users/update",
          user_id: "person-0",
          stations: ["station-0"],
          fields: ["pin"],
          before: {
            display_name: "Or Levy",
            employee_no: "1000",
            active: true,
            pin_configured: true,
            card_count: 1,
            assignments: { "station-0": { enabled: true } },
          },
          after: {
            display_name: "Or Levy",
            employee_no: "1000",
            active: true,
            pin_configured: false,
            card_count: 1,
            assignments: { "station-0": { enabled: true } },
          },
          revision_before: 1,
          revision_after: 2,
        };
        return {
          records: [record],
          actors: { "admin-1": "Test administrator" },
          total: 1,
          next_cursor: null,
          ...(type === "audit/export"
            ? { csv: '"action","name"\r\n"users/update","Or Levy"\r\n' }
            : {}),
        };
      }
      if (type === "stations/permission_audit") {
        window.calls.push(structuredClone(message));
        return {
          station_id: message.station_id,
          checked_at: "2026-09-09T11:00:00Z",
          complete: true,
          total_candidates: 1,
          counts: { matched: 0, drift: 1, unmanaged: 0, unverified: 0 },
          rows: [
            {
              user_id: "person-0",
              display_name: "Or Levy",
              employee_no: "1000",
              status: "drift",
              differences: ["display_name"],
              error: null,
            },
          ],
        };
      }
      return base(message);
    };
  });
}
async function users(page) {
  await page.getByRole("button", { name: "Users", exact: true }).click();
}
async function choose(page) {
  await page.getByRole("checkbox", { name: "Select user Or Levy", exact: true }).check();
  await expect(page.getByRole("combobox", { name: "Group action", exact: true })).toHaveValue(
    "disable",
  );
  await page.getByRole("button", { name: "Review group action", exact: true }).click();
}

test("filters combine, sorting is stable and filter changes clear selection", async ({ page }) => {
  await setup(page);
  await users(page);
  await page.locator("details.user-filters > summary").click();
  await expect(page.getByRole("combobox", { name: "Sort users" })).toHaveValue("employee");
  await page.getByRole("combobox", { name: "Sort users" }).selectOption("name");
  await expect(page.locator(".desktop-users tbody tr").first()).toContainText("Dana Cohen");
  await page.getByRole("combobox", { name: "Sort users" }).selectOption("employee");
  await expect(page.locator(".desktop-users tbody tr").first()).toContainText("Or Levy");
  await page.getByRole("checkbox", { name: "Select user Or Levy", exact: true }).check();
  await page.getByRole("combobox", { name: "Filter by user state" }).selectOption("inactive");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
  await expect(page.locator("hikvision-bulk-users")).toContainText("Selected users: 0");
  await page.getByRole("combobox", { name: "Filter by user state" }).selectOption("");
  await page.getByRole("combobox", { name: "Filter by station" }).selectOption("station-6");
  await page.getByRole("combobox", { name: "Filter by assignment" }).selectOption("unassigned");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(5);
  await page.getByRole("combobox", { name: "Filter by credential" }).selectOption("no_card");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
  await expect(page.locator(".desktop-users tbody")).toContainText("Maintenance");
});

test("bulk apply requires explicit review and cannot repeat itself", async ({ page }) => {
  await setup(page);
  await users(page);
  await choose(page);
  await expect(page.getByRole("button", { name: "Apply reviewed action" })).toBeDisabled();
  await expect(page.locator("hikvision-bulk-users .preview")).toContainText("Or Levy");
  await page
    .getByRole("checkbox", { name: "I reviewed the selected users and affected stations" })
    .check();
  await page.getByRole("button", { name: "Apply reviewed action" }).click();
  await expect(page.locator("hikvision-bulk-users")).toContainText("Saved centrally");
  expect(
    await page.evaluate(() => window.calls.filter((m) => m.type.endsWith("/bulk_apply")).length),
  ).toBe(1);
  expect(await page.evaluate(() => window.calls.some((m) => m.type.includes("unlock")))).toBe(
    false,
  );
});

test("changing a reviewed selection removes confirmation", async ({ page }) => {
  await setup(page);
  await users(page);
  await choose(page);
  await page
    .getByRole("checkbox", { name: "I reviewed the selected users and affected stations" })
    .check();
  await page.getByRole("checkbox", { name: "Select user Dana Cohen", exact: true }).check();
  await expect(page.getByRole("button", { name: "Apply reviewed action" })).toHaveCount(0);
});

test("lost apply response checks durable receipt without repeating mutation", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window.bulkLost = true));
  await users(page);
  await choose(page);
  await page
    .getByRole("checkbox", { name: "I reviewed the selected users and affected stations" })
    .check();
  await page.getByRole("button", { name: "Apply reviewed action" }).click();
  await expect(page.locator("hikvision-bulk-users")).toContainText("The response was lost");
  await page.getByRole("button", { name: "Check saved operation" }).click();
  await expect(page.locator("hikvision-bulk-users")).toContainText("Saved centrally");
  expect(
    await page.evaluate(() => window.calls.filter((m) => m.type.endsWith("/bulk_apply")).length),
  ).toBe(1);
});

test("late bulk preview cannot repopulate a closed user screen", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window.bulkDelay = true));
  await users(page);
  await page.getByRole("checkbox", { name: "Select user Or Levy", exact: true }).check();
  await page.getByRole("button", { name: "Review group action", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.bulkResolve)).toBe(true);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.evaluate(() => window.bulkResolve());
  await users(page);
  await expect(page.locator("hikvision-bulk-users .preview")).toHaveCount(0);
});

test("per-user history shows administrator and export uses applied filters", async ({ page }) => {
  await setup(page);
  await users(page);
  await page
    .locator(".desktop-users tbody tr")
    .filter({ hasText: "Or Levy" })
    .getByRole("button", { name: "User change history" })
    .click();
  const audit = page.locator("hikvision-admin-audit");
  await expect(audit).toContainText("Test administrator");
  await expect(audit.getByRole("combobox", { name: "Filter change history by user" })).toHaveValue(
    "person-0",
  );
  await audit
    .getByRole("combobox", { name: "Filter change history by user" })
    .selectOption("person-1");
  const downloading = page.waitForEvent("download");
  await audit.getByRole("button", { name: "Export change history CSV" }).click();
  const content = await readFile((await (await downloading).path())!, "utf8");
  expect(content).toContain("Or Levy");
  const exported = await page.evaluate(() =>
    window.calls.findLast((m) => m.type.endsWith("audit/export")),
  );
  expect(exported.filters.user_id).toBe("person-0");
});

test("permission audit reports drift and opens existing per-user conflict review", async ({
  page,
}) => {
  await setup(page);
  await navigate(page, "Change history");
  const audit = page.locator("hikvision-admin-audit");
  await audit
    .getByRole("combobox", { name: "Read-only permission audit" })
    .selectOption("station-0");
  await audit.getByRole("button", { name: "Compare station permissions" }).click();
  await expect(audit).toContainText("Differences found: 1");
  await audit.getByRole("button", { name: "Review this difference" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((m) => m.type.endsWith("conflicts/resolve"))),
  ).toBe(false);
});

test("Hebrew bulk preview and history fit a mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, true);
  await page.getByRole("button", { name: "משתמשים", exact: true }).click();
  await page.getByRole("checkbox", { name: "בחירת משתמש אור לוי", exact: true }).check();
  await page.getByRole("button", { name: "בדיקת הפעולה הקבוצתית", exact: true }).click();
  await expect(page.locator("hikvision-bulk-users .preview")).toBeVisible();
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((e) => e.shadowRoot.querySelector("main").scrollWidth > 390),
  ).toBe(false);
  await page.screenshot({ path: "test-results/bulk-he-mobile.png", fullPage: true });
  await navigate(page, "יומן שינויים");
  await expect(page.locator("hikvision-admin-audit .history article")).toHaveCount(1);
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((e) => e.shadowRoot.querySelector("main").scrollWidth > 390),
  ).toBe(false);
  await page.screenshot({ path: "test-results/audit-he-mobile.png", fullPage: true });
});
