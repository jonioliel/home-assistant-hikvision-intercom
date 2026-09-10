import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function prepare(page, language = "en") {
  await page.goto(language === "he" ? "/?lang=he" : "/");
  await navigate(page, language === "he" ? "תוכניות שעות" : "Access schedules");
  await page
    .getByRole("button", { name: language === "he" ? "תוכנית חדשה" : "New schedule", exact: true })
    .click();
  await page
    .getByLabel(language === "he" ? "שם התוכנית" : "Schedule name", { exact: true })
    .fill("Office");
  await page
    .getByLabel(language === "he" ? "תחנה" : "Station", { exact: true })
    .selectOption("station-0");
  await page
    .getByRole("button", {
      name: language === "he" ? "בדיקת התאמת הטיוטה" : "Assess selected draft",
      exact: true,
    })
    .click();
}

test("reference is saved only after confirmation and subsequent scans compare without writes", async ({
  page,
}) => {
  await prepare(page);
  await expect(page.getByText("No reference has been saved for this station.")).toBeVisible();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("baseline_save"))),
  ).toBeFalsy();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  await expect(
    page.getByText("Reference saved. Run another assessment to compare new observations."),
  ).toBeVisible();
  await page.evaluate(() => (window.demoBaselineChange = true));
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  const report = page.getByRole("region", { name: "Changes since reference", exact: true });
  await expect(report).toContainText("Changed records: 1");
  await expect(report).toContainText("Missing results in a partial scan do not prove deletion");
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => /schedules\/(create|update|apply)$/.test(c.type)),
    ),
  ).toBeFalsy();
});

test("export omits observation tokens and clear only removes the local reference", async ({
  page,
}) => {
  await prepare(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download assessment report", exact: true }).click();
  const content = await readFile(await (await download).path(), "utf8");
  expect(content).not.toContain("PRIVATE_BASELINE_TOKEN");
  expect(JSON.parse(content).baseline).not.toHaveProperty("token");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear reference", exact: true }).click();
  await expect(
    page.getByText("Reference cleared. Run another assessment before saving a new reference."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  await expect(page.getByText("No reference has been saved for this station.")).toBeVisible();
});

test("unknown reference save response requires fresh assessment and never retries", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (msg) => {
      const result = await original(msg);
      if (msg.type.endsWith("baseline_save")) throw new Error("lost response");
      return result;
    };
  });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("outcome is uncertain");
  await expect(page.getByRole("button", { name: "Save reference", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("baseline_save")).length),
  ).toBe(1);
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replace reference", exact: true })).toBeVisible();
});

test("switching stations never carries another station reference", async ({ page }) => {
  await prepare(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Save reference", exact: true }).click();
  await page.getByLabel("Station", { exact: true }).selectOption("station-1");
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  await expect(page.getByText("No reference has been saved for this station.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear reference", exact: true })).toHaveCount(0);
});

test("Hebrew mobile comparison keeps partial results readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "he");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "שמור נקודת ייחוס", exact: true }).click();
  await page.evaluate(() => (window.demoBaselineChange = true));
  await page.getByRole("button", { name: "בדיקת התאמת הטיוטה", exact: true }).click();
  const region = page.getByRole("region", { name: "שינויים מנקודת הייחוס", exact: true });
  await expect(region).toContainText("זוהו שינויים");
  await expect(region).toContainText("אינו מוכיח מחיקה");
  await region.scrollIntoViewIfNeeded();
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((e) => e.shadowRoot.querySelector("main").scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/baselines-he-mobile.png" });
});
