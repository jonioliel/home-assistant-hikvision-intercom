import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("entry summary loads no directory; paging, details and sync retain their data", async ({
  page,
}) => {
  await page.goto("/?paged=1&summary=1");
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.some((call) => call.type.endsWith("overview/summary"))),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.querySelector("hikvision-intercom-panel") as any)._data?.user_count,
      ),
    )
    .toBe(126);
  const types = await page.evaluate(() => window.calls.map((call) => call.type));
  expect(
    types.filter((type) => /\/(overview|users\/list|sync\/status|users\/query)$/.test(type)),
  ).toEqual([]);
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(50);
  await page.getByRole("checkbox", { name: "Select user Dana Cohen", exact: true }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("status").filter({ hasText: "51–100 / 126" })).toBeVisible();
  expect(
    await page.evaluate(
      () => (document.querySelector("hikvision-intercom-panel") as any)._selectedUsers.size,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => (document.querySelector("hikvision-intercom-panel") as any)._data.users.length,
    ),
  ).toBe(50);
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Select user Dana Cohen", exact: true }),
  ).toBeChecked();
  await page
    .locator(".desktop-users tbody tr")
    .first()
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigate(page, "Sync");
  await expect
    .poll(() => page.evaluate(() => window.calls.some((call) => call.type.endsWith("sync/status"))))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.querySelector("hikvision-intercom-panel") as any)._data?.users.length,
      ),
    )
    .toBe(126);
});

test("directory failure uses explicit legacy list without silently rendering an empty database", async ({
  page,
}) => {
  await page.goto("/?paged=1&summary=1&query-fails=1");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.calls.some((call) => call.type.endsWith("users/list"))))
    .toBe(true);
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(50);
  await expect(page.getByRole("heading", { name: "Your central user list is empty." })).toHaveCount(
    0,
  );
});

test("old server negotiation falls back once and keeps the prior directory", async ({ page }) => {
  await page.goto("/?paged=1");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(50);
  const types = await page.evaluate(() => window.calls.map((call) => call.type));
  expect(types.filter((type) => type.endsWith("overview/summary"))).toHaveLength(1);
  expect(types.filter((type) => type.endsWith("/overview")).length).toBeGreaterThan(0);
});
