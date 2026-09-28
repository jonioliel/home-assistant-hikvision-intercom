import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("approval requires review and explicit confirmation before activation", async ({ page }) => {
  await page.goto("/?visits=1");
  await navigate(page, "Visit approvals");
  const view = page.locator("wiskey-visit-requests");
  await expect(view.getByRole("button", { name: "Approve visit", exact: true })).toBeVisible();
  await view.getByRole("button", { name: "Approve visit", exact: true }).click();
  const review = view.getByRole("region", { name: "Review visit decision" });
  await expect(review).toContainText("Main gate");
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("visits/decide")).length,
    ),
  ).toBe(0);
  expect(await page.evaluate(() => window.demoData.users[3].active)).toBe(false);
  await review.getByRole("button", { name: "Confirm decision" }).click();
  await expect(view.getByRole("status")).toContainText("synchronization queued");
  expect(await page.evaluate(() => window.demoData.users[3].active)).toBe(true);
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.includes("whatsapp/send")).length,
    ),
  ).toBe(0);
});

test("stale request cannot be approved and fresh request reviews current data", async ({
  page,
}) => {
  await page.goto("/?visits=1");
  await page.evaluate(() => {
    window.visitRequests.items[0].stale = true;
    window.demoData.users[3].revision++;
    window.demoData.users[3].access_purpose = "Updated purpose";
  });
  await navigate(page, "Visit approvals");
  const view = page.locator("wiskey-visit-requests");
  await expect(view.getByRole("button", { name: "Approve visit", exact: true })).toBeDisabled();
  await view.getByRole("button", { name: "Submit a fresh request" }).click();
  const review = view.getByRole("region", { name: "Submit a fresh request" });
  await expect(review).toContainText("Updated purpose");
  await review.getByRole("combobox").selectOption("demo-host");
  await review.getByRole("button", { name: "Send approval request" }).click();
  await expect(view.getByRole("status")).toContainText("remains inactive");
  expect(await page.evaluate(() => window.visitRequests.items[0].approver_id)).toBe("demo-host");
  expect(await page.evaluate(() => window.demoData.users[3].active)).toBe(false);
});

test("concurrent decision requires refresh and is never resent automatically", async ({ page }) => {
  await page.goto("/?visits=1");
  await navigate(page, "Visit approvals");
  const view = page.locator("wiskey-visit-requests");
  await view.getByRole("button", { name: "Approve visit", exact: true }).click();
  await page.evaluate(() => window.visitRequests.items[0].revision++);
  await view
    .getByRole("region", { name: "Review visit decision" })
    .getByRole("button", { name: "Confirm decision" })
    .click();
  await expect(view.getByRole("alert")).toBeVisible();
  await expect(view.getByRole("button", { name: "Confirm decision" })).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("visits/decide")).length,
    ),
  ).toBe(1);
  expect(await page.evaluate(() => window.demoData.users[3].active)).toBe(false);
});

test("viewer has no actions and Hebrew mobile queue fits", async ({ page }) => {
  await page.goto("/?visits=1&reader=1&grant=users:view,management:view");
  await navigate(page, "Visit approvals");
  const view = page.locator("wiskey-visit-requests");
  await expect(view.locator("article")).toHaveCount(1);
  await expect(view.getByRole("button", { name: "Approve visit", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?visits=1&lang=he");
  await navigate(page, "אישורי ביקור");
  await expect(view.locator("article")).toHaveCount(1);
  expect(await view.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("deleted visitor is explained in Hebrew and cannot be approved or resubmitted", async ({
  page,
}) => {
  await page.goto("/?visits=1&lang=he");
  await page.evaluate(() => (window.visitRequests.items[0].user_deleted = true));
  await navigate(page, "אישורי ביקור");
  const view = page.locator("wiskey-visit-requests");
  await expect(view.locator("article")).toContainText("המשתמש נמחק או אינו זמין עוד.");
  await expect(view.getByRole("button", { name: "אישור ביקור", exact: true })).toBeDisabled();
  await expect(view.getByRole("button", { name: "הגשת בקשה מעודכנת", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("visits/decide")).length),
  ).toBe(0);
});

test("guest wizard keeps approval optional and sends an inactive request only on save", async ({
  page,
}) => {
  await page.goto("/?visits=1");
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Create temporary access", exact: false }).click();
  const dialog = page.locator("hikvision-intercom-panel").getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Approval visitor");
  await dialog.getByLabel("Responsible person", { exact: true }).fill("Reception");
  await dialog.getByLabel("PIN", { exact: true }).fill("654321");
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill("654321");
  const approver = dialog.locator("wiskey-visit-approver");
  await approver.getByRole("checkbox").check();
  await approver.getByRole("combobox").selectOption("demo-host");
  await dialog.getByRole("button", { name: "Next: doors", exact: true }).click();
  await dialog
    .locator(".assignment")
    .filter({ hasText: "Main gate" })
    .getByRole("checkbox")
    .check();
  await dialog.getByRole("button", { name: "Send approval request", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const calls = await page.evaluate(() =>
    window.calls.filter((call) => call.type.endsWith("visits/create")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].data.active).toBe(false);
  expect(calls[0].approver_id).toBe("demo-host");
});

test("visit status, own-request and search filters apply before paging and show matching counts", async ({
  page,
}) => {
  await page.goto("/?visits=1");
  await page.evaluate(() => {
    const pending = window.visitRequests.items[0];
    window.visitRequests.items = [
      ...Array.from({ length: 125 }, (_, i) => ({
        ...pending,
        id: `closed-${i}`,
        status: "approved",
        snapshot: { ...pending.snapshot, display_name: `Closed ${i}` },
      })),
      pending,
    ];
  });
  await navigate(page, "Visit approvals");
  const view = page.locator("wiskey-visit-requests");
  await expect(view.locator("article")).toHaveCount(1);
  await expect(view.getByRole("button", { name: "Approve visit", exact: true })).toBeVisible();
  await view
    .getByRole("combobox", { name: "Requests to show", exact: true })
    .selectOption("requester");
  await expect(view.locator("article")).toHaveCount(0);
  await view
    .getByRole("combobox", { name: "Requests to show", exact: true })
    .selectOption("approver");
  await expect(view.locator("article")).toHaveCount(1);
  await view.getByRole("combobox", { name: "Status", exact: true }).selectOption("approved");
  await expect(view.locator("article")).toHaveCount(100);
  await view.getByRole("button", { name: "Next", exact: true }).click();
  await expect(view.locator("article")).toHaveCount(25);
  await view
    .getByRole("textbox", { name: "Search visitor, responsible person or purpose", exact: true })
    .fill("Closed 124");
  await view.getByRole("button", { name: "Filter requests", exact: true }).click();
  await expect(view.locator("article")).toHaveCount(1);
  await expect(view.locator("article")).toContainText("Closed 124");
  const query = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("visits/list")).at(-1),
  );
  expect(query.offset).toBe(0);
  expect(query.filters).toEqual({ status: "approved", scope: "approver", query: "Closed 124" });
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("visits/decide")).length),
  ).toBe(0);
});
