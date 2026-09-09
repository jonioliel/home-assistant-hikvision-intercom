import { test, expect } from "@playwright/test";
async function prepare(page, language = "en") {
  await page.goto(language === "he" ? "/?lang=he" : "/");
  await page
    .getByRole("button", {
      name: language === "he" ? "תוכניות שעות" : "Access schedules",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: language === "he" ? "תוכנית חדשה" : "New schedule", exact: true })
    .click();
  await page
    .getByLabel(language === "he" ? "שם התוכנית" : "Schedule name", { exact: true })
    .fill("Example");
  await page
    .getByLabel(language === "he" ? "תחנה" : "Station", { exact: true })
    .selectOption("station-0");
}

test("assessment shows partial inventory without saving or enabling assignment", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  const report = page.getByRole("region", { name: "Draft and station compatibility", exact: true });
  await expect(report).toContainText("No excess found");
  await expect(report).toContainText("300 / 1024");
  await expect(report).toContainText("Disabled records are not free slots");
  await expect(report).toContainText("Partial search");
  const calls = await page.evaluate(() =>
    window.calls.filter((c) => c.type.includes("schedules/") && !c.type.includes("/plan_")),
  );
  expect(calls.some((c) => /create|update|apply/.test(c.type))).toBeFalsy();
  const download = page.waitForEvent("download");
  await report.getByRole("button", { name: "Download assessment report" }).click();
  expect((await download).suggestedFilename()).toBe("hikvision-schedule-assessment.json");
});

test("editing invalidates assessment and pending old response cannot restore it", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (msg) =>
      msg.type.endsWith("schedules/assess")
        ? new Promise((resolve) => {
            window.finishAssessment = async () => resolve(await original(msg));
          })
        : original(msg);
  });
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Changed while reading");
  await page.evaluate(() => window.finishAssessment());
  await expect(
    page.getByRole("button", { name: "Assess selected draft", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Draft and station compatibility", exact: true }),
  ).toHaveCount(0);
});

test("holiday membership is unknown and changing station clears the assessment", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  await page.getByLabel("Holiday name", { exact: true }).fill("Closure");
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  const report = page.getByRole("region", { name: "Draft and station compatibility", exact: true });
  await expect(report).toContainText("Some draft limits could not be verified");
  await expect(report).toContainText("Holiday references per group");
  await page.getByLabel("Station", { exact: true }).selectOption("station-1");
  await expect(report).toHaveCount(0);
});

test("assessment pending on one station keeps other releases available", async ({ page }) => {
  await prepare(page);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (msg) =>
      msg.type.endsWith("schedules/assess")
        ? new Promise((resolve) => {
            window.finishAssessment = async () => resolve(await original(msg));
          })
        : original(msg);
  });
  await page.getByRole("button", { name: "Assess selected draft", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open active lock", exact: true }).nth(1),
  ).toBeEnabled();
  await page.evaluate(() => window.finishAssessment());
  await expect(
    page.getByRole("region", { name: "Draft and station compatibility", exact: true }),
  ).toHaveCount(0);
});

test("Hebrew mobile assessment keeps warnings and resource counts readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "he");
  await page.getByRole("button", { name: "בדיקת התאמת הטיוטה", exact: true }).click();
  const report = page.getByRole("region", { name: "התאמת הטיוטה לתחנה", exact: true });
  await expect(report).toContainText("300 / 1024");
  await report.scrollIntoViewIfNeeded();
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((e) => e.shadowRoot.querySelector("main").scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/assessment-he-mobile.png" });
});

test("dependency audit explains unknown defaults and exports no user identity", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: "Audit user schedule dependencies", exact: true }).click();
  const report = page.getByRole("region", {
    name: "Audit user schedule dependencies",
    exact: true,
  });
  await expect(report).toContainText("Unknown defaults: 1");
  await expect(report).toContainText("Dependency mapping is incomplete");
  const calls = await page.evaluate(() =>
    window.calls.filter((c) => c.type.includes("schedules/") && !c.type.includes("/plan_")),
  );
  expect(calls.map((c) => c.type.split("/").pop())).toEqual(["list", "dependencies"]);
  await page.getByLabel("Station", { exact: true }).selectOption("station-1");
  await expect(report).toHaveCount(0);
});
