import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

async function cancellation(page: import("@playwright/test").Page) {
  await navigate(page, "Identity lifecycle");
  await page
    .locator(".temporary-card")
    .filter({ hasText: "Or Levy" })
    .getByRole("button", { name: "Cancel temporary access", exact: true })
    .click();
  return page.locator("wiskey-temporary-cancel").getByRole("dialog");
}

test("cancel requires explicit confirmation and sends only identity, revision and reason", async ({
  page,
}) => {
  await page.goto("/?lifecycle=1&temporary=1");
  const before = await page.evaluate(() => structuredClone(window.demoData.users[0]));
  const dialog = await cancellation(page);
  await expect(
    dialog.getByText("A disconnected station may still accept", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/temporary_cancel")).length,
    ),
  ).toBe(0);
  await dialog.getByLabel("Cancellation reason").selectOption("visit_completed");
  await dialog.getByRole("button", { name: "Confirm cancellation and sync" }).click();
  await expect(dialog.getByRole("status")).toContainText("Cancellation saved");
  await expect(dialog.getByText("Main gate", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() =>
    window.calls.filter((call) => call.type.endsWith("users/temporary_cancel")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({
    type: "hikvision_intercom/users/temporary_cancel",
    api_contract: 1,
    user_id: "person-0",
    revision: before.revision,
    reason_code: "visit_completed",
  });
  const after = await page.evaluate(() => window.demoData.users[0]);
  expect(after.active).toBe(false);
  for (const field of [
    "cards",
    "pin_configured",
    "valid_from",
    "valid_until",
    "access_purpose",
    "responsible_person",
  ])
    expect(after[field]).toEqual(before[field]);
  await expect(dialog.getByRole("button", { name: "Confirm cancellation and sync" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page
      .locator(".temporary-card")
      .filter({ hasText: "Or Levy" })
      .getByRole("button", { name: "Cancel temporary access", exact: true }),
  ).toHaveCount(0);
});

test("closing cancellation before confirmation never changes a user", async ({ page }) => {
  await page.goto("/?lifecycle=1&temporary=1");
  const dialog = await cancellation(page);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => window.demoData.users[0].active)).toBe(true);
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/temporary_cancel")).length,
    ),
  ).toBe(0);
});

test("cancellation status refresh verifies the new revision rather than a previous sync", async ({
  page,
}) => {
  await page.goto("/?lifecycle=1&temporary=1");
  const dialog = await cancellation(page);
  await dialog.getByRole("button", { name: "Confirm cancellation and sync" }).click();
  await expect(dialog.getByRole("status")).toContainText("Cancellation saved");
  await expect(dialog.locator("li").first()).toContainText("Pending");
  await page.evaluate(() => {
    const user = window.demoData.users[0];
    for (const assignment of Object.values(user.assignments)) {
      assignment.sync_state = "synced";
      assignment.applied_revision = user.revision;
    }
  });
  await dialog.getByRole("button", { name: "Refresh station statuses" }).click();
  await expect(dialog.locator("li").first()).toContainText("Synced");
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/temporary_cancel")).length,
    ),
  ).toBe(1);
});

test("a concurrent user change is shown without overwriting or claiming success", async ({
  page,
}) => {
  await page.goto("/?lifecycle=1&temporary=1");
  const dialog = await cancellation(page);
  await page.evaluate(() => window.demoData.users[0].revision++);
  await dialog.getByRole("button", { name: "Confirm cancellation and sync" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed while you were editing");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(() => window.demoData.users[0].active)).toBe(true);
});

test("viewer and older server do not expose unsupported cancellation actions", async ({ page }) => {
  for (const suffix of ["&reader=1&grant=users:view,management:view", "&legacy-cancellation=1"]) {
    await page.goto("/?lifecycle=1&temporary=1" + suffix);
    await navigate(page, "Identity lifecycle");
    await expect(
      page
        .locator("wiskey-identity-lifecycle")
        .getByRole("button", { name: "Cancel temporary access", exact: true }),
    ).toHaveCount(0);
  }
});

test("Hebrew cancellation dialog fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lifecycle=1&temporary=1&lang=he");
  await navigate(page, "מחזור חיי משתמשים");
  await page
    .locator(".temporary-card")
    .first()
    .getByRole("button", { name: "ביטול הרשאה זמנית", exact: true })
    .click();
  const dialog = page.locator("wiskey-temporary-cancel").getByRole("dialog");
  await expect(dialog.getByLabel("סיבת הביטול")).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("late cancellation result cannot update a revoked view", async ({ page }) => {
  await page.goto("/?lifecycle=1&temporary=1");
  const dialog = await cancellation(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (message) => {
      if (!message.type.endsWith("users/temporary_cancel")) return original(message);
      window.calls.push(message);
      return new Promise((resolve) => {
        window.finishCancellation = () => resolve({ ...window.demoData.users[0], active: false });
      });
    };
  });
  await dialog.getByRole("button", { name: "Confirm cancellation and sync" }).click();
  await expect.poll(() => page.evaluate(() => !!window.finishCancellation)).toBe(true);
  await page.locator("wiskey-temporary-cancel").evaluate((element) => {
    (element as unknown as { canManage: boolean }).canManage = false;
  });
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => window.finishCancellation());
  await expect(
    page.locator("wiskey-identity-lifecycle").getByText("Cancellation saved", { exact: false }),
  ).toHaveCount(0);
});
