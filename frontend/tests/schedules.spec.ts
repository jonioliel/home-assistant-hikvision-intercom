import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";

async function editor(page) {
  await page.goto("/");
  await navigate(page, "Access schedules");
  await page.getByRole("button", { name: "New schedule", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Office hours");
  const monday = page.getByRole("group", { name: "Monday", exact: true });
  await monday.getByRole("button", { name: "Add window" }).click();
  return monday;
}

test("schedule draft persists through navigation and editing without sync", async ({ page }) => {
  await editor(page);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved in Home Assistant. Station permissions were not changed."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await navigate(page, "Access schedules");
  await page.getByRole("button", { name: "Office hours", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Monday", exact: true }).getByLabel("Start", { exact: true }),
  ).toHaveValue("09:00");
  await page.getByLabel("Schedule name", { exact: true }).fill("Edited office");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const calls = await page.evaluate(() => window.calls);
  expect(calls.find((c) => c.type.endsWith("schedules/update")).revision).toBe(1);
  expect(calls.some((c) => /users\/(create|update)|sync\/|unlock/.test(c.type))).toBeFalsy();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(page.getByText("Draft deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edited office", exact: true })).toHaveCount(0);
});

test("holiday preview overrides weekly hours and editing invalidates preview", async ({ page }) => {
  await editor(page);
  await page.getByLabel("Test date", { exact: true }).fill("2026-09-07");
  await page.getByLabel("Local time", { exact: true }).fill("12:00");
  await page.getByRole("button", { name: "Check window", exact: true }).click();
  await expect(page.getByText("Inside a draft window", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  await expect(page.getByText("Inside a draft window", { exact: true })).toHaveCount(0);
  await page.getByLabel("Holiday name", { exact: true }).fill("Office closed");
  await page.getByLabel("First date", { exact: true }).fill("2026-09-07");
  await page.getByLabel("Last date", { exact: true }).fill("2026-09-08");
  await page.getByRole("button", { name: "Check window", exact: true }).click();
  await expect(page.getByText("Outside all draft windows", { exact: true })).toBeVisible();
  await expect(page.getByText("Holiday override: Office closed", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((c) => /schedules\/(create|update)/.test(c.type))),
  ).toBeFalsy();
});

test("unknown save result requires explicit reload and does not duplicate drafts", async ({
  page,
}) => {
  await editor(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      const result = await original(message);
      if (message.type.endsWith("schedules/create")) throw { code: "connection_lost" };
      return result;
    };
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("save result is unconfirmed");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload drafts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Office hours", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("schedules/create")).length,
    ),
  ).toBe(1);
});

test("revision conflict preserves edited draft and unsaved navigation can be cancelled", async ({
  page,
}) => {
  await editor(page);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Unsaved office");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByLabel("Schedule name", { exact: true })).toHaveValue("Unsaved office");
  await page.evaluate(() => window.demoSchedules[0].revision++);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This schedule changed while you were editing.",
  );
  await expect(page.getByLabel("Schedule name", { exact: true })).toHaveValue("Unsaved office");
});

test("station readiness reports failure, allows export and never enables apply", async ({
  page,
}) => {
  await editor(page);
  await page.getByLabel("Station", { exact: true }).selectOption("station-0");
  await page.getByRole("button", { name: "Check station", exact: true }).click();
  await expect(page.getByText("Read failed", { exact: false })).toHaveCount(4);
  await expect(page.getByText(/Applying schedules remains unavailable/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download readiness report" }).click();
  expect((await download).suggestedFilename()).toBe("hikvision-schedule-readiness.json");
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("schedules/readiness")).length,
    ),
  ).toBe(1);
});

test("Hebrew mobile schedules support end of day without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "תוכניות שעות", exact: true }).click();
  await page.getByRole("button", { name: "תוכנית חדשה", exact: true }).click();
  await page.getByLabel("שם התוכנית", { exact: true }).fill("שעות משרד");
  const monday = page.getByRole("group", { name: "יום שני", exact: true });
  await monday.getByRole("button", { name: "הוספת חלון" }).click();
  await monday.getByLabel("סיום", { exact: true }).fill("24:00");
  await page.getByRole("button", { name: "שמירת טיוטה", exact: true }).click();
  await expect(
    page.getByText("הטיוטה נשמרה ב־Home Assistant. הרשאות התחנות לא השתנו."),
  ).toBeVisible();
  const overflow = await page
    .locator("hikvision-intercom-schedules")
    .evaluate((e) => e.scrollWidth > e.clientWidth);
  expect(overflow).toBeFalsy();
  await page.screenshot({ path: "test-results/schedules-he-mobile.png", fullPage: true });
});

test("late readiness response cannot restore detached schedule content", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Access schedules");
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (message) =>
      message.type.endsWith("schedules/readiness")
        ? new Promise(
            (resolve) => (window.finishSchedule = async () => resolve(await original(message))),
          )
        : original(message);
  });
  await page.getByLabel("Station", { exact: true }).selectOption("station-0");
  await page.getByRole("button", { name: "Check station", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.evaluate(() => window.finishSchedule());
  await navigate(page, "Access schedules");
  await expect(page.getByRole("button", { name: "Download readiness report" })).toHaveCount(0);
});
