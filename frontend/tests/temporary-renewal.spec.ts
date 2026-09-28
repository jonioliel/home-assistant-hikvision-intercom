import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("temporary lifecycle filters people by outer validity", async ({ page }) => {
  await page.goto("/?lifecycle=1&temporary=1");
  await navigate(page, "Identity lifecycle");
  const section = page.locator("wiskey-identity-lifecycle .temporary");
  await expect(section.getByRole("heading", { name: "Visitors and contractors" })).toBeVisible();
  await expect(section.locator(".temporary-card")).toHaveCount(4);
  await section.getByLabel("Validity status").selectOption("expired");
  await expect(section.locator(".temporary-card")).toHaveCount(1);
  await expect(section.getByText("Dana Cohen", { exact: true })).toBeVisible();
  await section.getByLabel("Validity status").selectOption("upcoming");
  await expect(section.getByText("Temporary guest", { exact: true })).toBeVisible();
  await section.getByLabel("Validity status").selectOption("expiring");
  await expect(section.getByText("Or Levy", { exact: true })).toBeVisible();
});

test("renewal requires review and sends only UTC dates with the current revision", async ({
  page,
}) => {
  await page.goto("/?lifecycle=1&temporary=1");
  await navigate(page, "Identity lifecycle");
  const card = page.locator(".temporary-card").filter({ hasText: "Or Levy" });
  await card.getByRole("button", { name: "Renew validity", exact: true }).click();
  const dialog = page.locator("wiskey-temporary-validity").getByRole("dialog");
  await dialog.getByLabel("Start", { exact: true }).fill("2030-09-28T12:00");
  await dialog.getByLabel("End", { exact: true }).fill("2030-09-28T18:00");
  await dialog.getByRole("button", { name: "Review new period" }).click();
  await expect(dialog.getByText("Proposed period")).toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/update")).length,
    ),
  ).toBe(0);
  await dialog.getByRole("button", { name: "Confirm and sync" }).click();
  await expect(dialog).not.toBeVisible();
  const calls = await page.evaluate(() =>
    window.calls.filter((call) => call.type.endsWith("users/update")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    user_id: "person-0",
    revision: 1,
    sync_now: true,
    data: { valid_from: "2030-09-28T09:00:00.000Z", valid_until: "2030-09-28T15:00:00.000Z" },
  });
  expect(Object.keys(calls[0].data).sort()).toEqual(["valid_from", "valid_until"]);
  await expect(page.locator("wiskey-identity-lifecycle").getByRole("status")).toContainText(
    "synchronization has been requested",
  );
  await card.getByRole("button", { name: "Renew validity", exact: true }).click();
  await expect(dialog.getByLabel("End", { exact: true })).toHaveValue("2030-09-28T18:00");
});

test("disabled people stay visibly disabled and additional schedules are preserved", async ({
  page,
}) => {
  await page.goto("/?lifecycle=1&temporary=1");
  await page.evaluate(() => {
    window.demoData.users[3].access_timing_policy = { mode: "ha", schedule: {}, bindings: {} };
  });
  await navigate(page, "Identity lifecycle");
  const card = page.locator(".temporary-card").filter({ hasText: "Noa Israeli" });
  await card.getByRole("button", { name: "Renew validity", exact: true }).click();
  const dialog = page.locator("wiskey-temporary-validity").getByRole("dialog");
  await expect(dialog).toContainText("will remain disabled");
  await expect(dialog).toContainText("Existing day and time rules are retained");
  await dialog.getByLabel("End", { exact: true }).fill("2030-09-28T18:00");
  await dialog.getByRole("button", { name: "Review new period" }).click();
  await dialog.getByRole("button", { name: "Confirm and sync" }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => window.demoData.users[3].active)).toBe(false);
  expect(await page.evaluate(() => window.demoData.users[3].access_timing_policy.mode)).toBe("ha");
});

test("concurrent edit is rejected and does not overwrite the new revision", async ({ page }) => {
  await page.goto("/?lifecycle=1&temporary=1");
  await navigate(page, "Identity lifecycle");
  await page
    .locator(".temporary-card")
    .first()
    .getByRole("button", { name: "Renew validity", exact: true })
    .click();
  const dialog = page.locator("wiskey-temporary-validity").getByRole("dialog");
  await dialog.getByLabel("End", { exact: true }).fill("2030-09-28T18:00");
  await dialog.getByRole("button", { name: "Review new period" }).click();
  await page.evaluate(() => {
    window.demoData.users[0].revision++;
  });
  await dialog.getByRole("button", { name: "Confirm and sync" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed while you were editing");
  expect(await page.evaluate(() => window.demoData.users[0].valid_until)).toBe(
    "2026-09-25T09:00:00Z",
  );
});

test("viewer sees the report without renewal actions and Hebrew mobile has no horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lifecycle=1&temporary=1&lang=he&reader=1&grant=users:view,management:view");
  await navigate(page, "מחזור חיי משתמשים");
  const view = page.locator("wiskey-identity-lifecycle");
  await expect(view.getByRole("heading", { name: "אורחים וקבלנים" })).toBeVisible();
  await expect(view.getByRole("button", { name: "חידוש תוקף" })).toHaveCount(0);
  expect(await view.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("a delegated people manager can renew without administrator status", async ({ page }) => {
  await page.goto("/?lifecycle=1&temporary=1&reader=1&grant=users:manage,management:view");
  await navigate(page, "Identity lifecycle");
  await page
    .locator(".temporary-card")
    .first()
    .getByRole("button", { name: "Renew validity", exact: true })
    .click();
  const dialog = page.locator("wiskey-temporary-validity").getByRole("dialog");
  await dialog.getByLabel("End", { exact: true }).fill("2030-09-28T18:00");
  await dialog.getByRole("button", { name: "Review new period" }).click();
  await dialog.getByRole("button", { name: "Confirm and sync" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/update")).length,
    ),
  ).toBe(1);
});

test("missing or reversed renewal dates cannot reach the update command", async ({ page }) => {
  await page.goto("/?lifecycle=1&temporary=1");
  await navigate(page, "Identity lifecycle");
  await page
    .locator(".temporary-card")
    .first()
    .getByRole("button", { name: "Renew validity", exact: true })
    .click();
  const dialog = page.locator("wiskey-temporary-validity").getByRole("dialog");
  await dialog.getByLabel("Start", { exact: true }).fill("2030-09-28T18:00");
  await dialog.getByLabel("End", { exact: true }).fill("2030-09-28T12:00");
  await dialog.getByRole("button", { name: "Review new period" }).click();
  await expect(dialog.getByRole("alert")).toContainText("valid start and end");
  await dialog.getByLabel("End", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Review new period" }).click();
  await expect(dialog.getByRole("button", { name: "Confirm and sync" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/update")).length,
    ),
  ).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page
      .locator(".temporary-card")
      .first()
      .getByRole("button", { name: "Renew validity", exact: true }),
  ).toBeFocused();
});

test("the previous lifecycle report shape remains supported", async ({ page }) => {
  await page.goto("/?lifecycle=1&legacy-lifecycle=1");
  await navigate(page, "Identity lifecycle");
  const view = page.locator("wiskey-identity-lifecycle");
  await expect(view.getByText("Same phone number")).toBeVisible();
  await expect(view.locator(".temporary")).toHaveCount(0);
});

test("a delayed renewal cannot update the UI after permission revocation", async ({ page }) => {
  await page.goto("/?lifecycle=1&temporary=1");
  await navigate(page, "Identity lifecycle");
  await page
    .locator(".temporary-card")
    .first()
    .getByRole("button", { name: "Renew validity", exact: true })
    .click();
  const dialog = page.locator("wiskey-temporary-validity").getByRole("dialog");
  await dialog.getByLabel("End", { exact: true }).fill("2030-09-28T18:00");
  await dialog.getByRole("button", { name: "Review new period" }).click();
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (message) => {
      if (!message.type.endsWith("users/update")) return original(message);
      window.calls.push(message);
      return new Promise((resolve) => {
        window.finishRenewal = () => resolve({ accepted: true });
      });
    };
  });
  await dialog.getByRole("button", { name: "Confirm and sync" }).click();
  await expect.poll(() => page.evaluate(() => !!window.finishRenewal)).toBe(true);
  await page.locator("wiskey-temporary-validity").evaluate((element) => {
    (element as unknown as { canManage: boolean }).canManage = false;
  });
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => window.finishRenewal());
  await expect(page.locator("wiskey-identity-lifecycle").getByRole("status")).toHaveCount(0);
});

test("the Hebrew renewal dialog fits a narrow phone and returns from review", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lifecycle=1&temporary=1&lang=he");
  await navigate(page, "מחזור חיי משתמשים");
  await page
    .locator(".temporary-card")
    .first()
    .getByRole("button", { name: "חידוש תוקף", exact: true })
    .click();
  const dialog = page.locator("wiskey-temporary-validity").getByRole("dialog");
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByLabel("סיום", { exact: true }).fill("2030-09-28T18:00");
  await dialog.getByRole("button", { name: "בדיקת התקופה החדשה" }).click();
  await expect(dialog.getByText("התקופה המוצעת")).toBeVisible();
  await dialog.getByRole("button", { name: "חזרה", exact: true }).click();
  await expect(dialog.getByLabel("סיום", { exact: true })).toHaveValue("2030-09-28T18:00");
});
