import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
async function open(page) {
  await page.goto("/");
  await navigate(page, "Access schedules");
  await page.getByRole("button", { name: "New schedule", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Original");
  await page
    .getByRole("group", { name: "Monday", exact: true })
    .getByRole("button", { name: "Add window" })
    .click();
}

test("clone retains holidays and unsaved edits but saves with a fresh identity", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  await page.getByLabel("Holiday name", { exact: true }).fill("Closure");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("group", { name: "Monday", exact: true })
    .getByLabel("Start", { exact: true })
    .fill("10:00");
  await page.getByRole("button", { name: "Clone current draft", exact: true }).click();
  await expect(page.getByLabel("Schedule name", { exact: true })).toHaveValue("Original (copy)");
  await expect(page.getByLabel("Holiday name", { exact: true })).toHaveValue("Closure");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByLabel("Schedule name", { exact: true })).toHaveValue("Original (copy)");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const stored = await page.evaluate(() => window.demoSchedules);
  expect(stored).toHaveLength(2);
  expect(stored[0].id).not.toBe(stored[1].id);
  expect(stored[0].weekly.Monday[0].start).toBe("09:00");
  expect(stored[1].weekly.Monday[0].start).toBe("10:00");
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("schedules/update")).length,
    ),
  ).toBe(0);
});

test("copied days are independent and clearing existing windows requires confirmation", async ({
  page,
}) => {
  await open(page);
  const copy = page.getByRole("group", { name: "Copy daily windows", exact: true });
  await copy.getByRole("checkbox", { name: "Tuesday", exact: true }).check();
  await copy.getByRole("checkbox", { name: "Wednesday", exact: true }).check();
  await copy.getByRole("button", { name: "Copy to selected days", exact: true }).click();
  const tuesday = page.getByRole("group", { name: "Tuesday", exact: true });
  await tuesday.getByLabel("Start", { exact: true }).fill("11:00");
  await expect(
    page.getByRole("group", { name: "Monday", exact: true }).getByLabel("Start", { exact: true }),
  ).toHaveValue("09:00");
  await expect(
    page
      .getByRole("group", { name: "Wednesday", exact: true })
      .getByLabel("Start", { exact: true }),
  ).toHaveValue("09:00");
  await copy.getByLabel("Source day", { exact: true }).selectOption("Thursday");
  await copy.getByRole("checkbox", { name: "Tuesday", exact: true }).check();
  page.once("dialog", (dialog) => dialog.dismiss());
  await copy.getByRole("button", { name: "Copy to selected days", exact: true }).click();
  await expect(tuesday.getByLabel("Start", { exact: true })).toHaveValue("11:00");
  page.once("dialog", (dialog) => dialog.accept());
  await copy.getByRole("button", { name: "Copy to selected days", exact: true }).click();
  await expect(tuesday.getByLabel("Start", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.demoSchedules.length)).toBe(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(await page.evaluate(() => window.demoSchedules[0].weekly.Tuesday)).toEqual([]);
});

test("Hebrew mobile copy controls fit the panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await navigate(page, "תוכניות שעות");
  await page.getByRole("button", { name: "תוכנית חדשה", exact: true }).click();
  const copy = page.getByRole("group", { name: "העתקת חלונות יומיים", exact: true });
  await copy.scrollIntoViewIfNeeded();
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((e) => e.shadowRoot.querySelector("main").scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/schedule-editing-he-mobile.png" });
});
