import { test, expect } from "@playwright/test";

test("server user directory pages, searches, and changes page size without losing compatibility", async ({
  page,
}) => {
  await page.goto("/?paged=1");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.calls.filter((call) => call.type.endsWith("users/query")).at(-1)?.offset,
      ),
    )
    .toBe(0);
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(50);
  await expect(page.getByRole("status").filter({ hasText: "1–50 / 126" })).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.calls.filter((call) => call.type.endsWith("users/query")).at(-1)?.offset,
      ),
    )
    .toBe(50);
  await expect(page.getByRole("status").filter({ hasText: "51–100 / 126" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("Scale Person 119");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.calls.filter((call) => call.type.endsWith("users/query")).at(-1)?.query,
      ),
    )
    .toBe("Scale Person 119");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
  await expect(page.locator(".desktop-users tbody tr")).toContainText("Scale Person 119");

  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await page.getByLabel("Users per page").selectOption("25");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(25);
  const last = await page.evaluate(() =>
    window.calls.filter((call) => call.type.endsWith("users/query")).at(-1),
  );
  expect(last).toMatchObject({ offset: 0, limit: 25, api_contract: 1 });
});
