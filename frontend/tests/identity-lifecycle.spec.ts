import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("identity lifecycle highlights expiry, duplicates and missing credentials", async ({
  page,
}) => {
  await page.goto("/?lifecycle=1");
  await navigate(page, "Identity lifecycle");
  const view = page.locator("wiskey-identity-lifecycle");
  await expect(view.getByRole("heading", { name: "Identity lifecycle" })).toBeVisible();
  await expect(view.getByText("Expiring soon")).toBeVisible();
  await expect(view.getByText("Same phone number")).toBeVisible();
  await expect(view.getByText("Maintenance")).toBeVisible();

  await view.getByLabel("Expiry warning horizon (days)").selectOption("90");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.calls.filter((call) => call.type.endsWith("users/lifecycle")).at(-1)?.warning_days,
      ),
    )
    .toBe(90);
  await view.getByRole("button", { name: "Open person" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("identity lifecycle is responsive and available to a delegated user viewer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lifecycle=1&lang=he&reader=1&grant=users:view,management:view");
  await navigate(page, "מחזור חיי משתמשים");
  await expect(page.locator("wiskey-identity-lifecycle")).toBeVisible();
  expect(
    await page
      .locator(".app-shell")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("saving a possible duplicate requires an explicit review decision", async ({ page }) => {
  await page.goto("/?lifecycle=1");
  await navigate(page, "Users");
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Dana Cohen");
  page.once("dialog", async (prompt) => {
    expect(prompt.message()).toContain("possible existing person");
    await prompt.dismiss();
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/duplicate_check")).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => window.calls.filter((call) => call.type.endsWith("users/create")).length,
    ),
  ).toBe(0);
});
