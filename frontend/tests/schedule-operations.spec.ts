import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function prepare(page, hebrew = false) {
  await page.goto(hebrew ? "/?lang=he" : "/");
  await page
    .getByRole("button", { name: hebrew ? "תוכניות שעות" : "Access schedules", exact: true })
    .click();
  await page
    .getByRole("button", { name: hebrew ? "תוכנית חדשה" : "New schedule", exact: true })
    .click();
  await page
    .getByLabel(hebrew ? "שם התוכנית" : "Schedule name", { exact: true })
    .fill(hebrew ? "כניסה ראשית" : "Main entrance");
  await page
    .getByRole("button", { name: hebrew ? "שמירת טיוטה" : "Save draft", exact: true })
    .click();
  const plans = page.locator("hikvision-deployment-plans").getByRole("region").first();
  await plans
    .getByLabel(hebrew ? "תחנה לתוכנית הפריסה" : "Proposal station", { exact: true })
    .selectOption("station-0");
  await plans.getByLabel(hebrew ? "מזהה תבנית" : "Template ID", { exact: true }).fill("10");
  await plans
    .getByLabel(hebrew ? "מזהה תוכנית שבועית" : "Weekly plan ID", { exact: true })
    .fill("20");
  await plans
    .getByRole("button", {
      name: hebrew ? "השוואת התצורה המוצעת" : "Compare proposed configuration",
      exact: true,
    })
    .click();
  await plans
    .getByRole("button", {
      name: hebrew ? "שמירת תוכנית מקומית" : "Save local proposal",
      exact: true,
    })
    .click();
  const operations = page.getByRole("region", {
    name: hebrew ? "עבודות לוחות זמנים" : "Schedule operations",
    exact: true,
  });
  await operations
    .getByLabel(hebrew ? "תוכנית שמורה" : "Saved proposal", { exact: true })
    .selectOption({ index: 1 });
  return operations;
}

test("responsibility review, queued check, safe export and archive form a complete workflow", async ({
  page,
}) => {
  const operations = await prepare(page);
  await operations
    .getByRole("button", { name: "Review resource responsibility", exact: true })
    .click();
  const review = operations.getByRole("region", {
    name: "Review management declaration",
    exact: true,
  });
  await expect(review).toContainText("does not establish that a slot is unused");
  expect(await page.evaluate(() => window.demoOperations.claims.length)).toBe(0);
  await review.getByRole("button", { name: "Record responsibility locally", exact: true }).click();
  await operations.getByRole("button", { name: "Create check job", exact: true }).click();
  const job = operations
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Main entrance" }) })
    .first();
  await job.locator("summary").click();
  await job.getByRole("button", { name: "Check station", exact: true }).click();
  await expect(job.locator("summary")).toContainText("Blocked", { timeout: 10000 });
  await expect(job).toContainText("Declaration matches the latest read");
  await expect(job).toContainText("unknown defaults");
  const download = page.waitForEvent("download");
  await operations.getByRole("button", { name: "Download operations report", exact: true }).click();
  const content = await readFile(await (await download).path(), "utf8");
  expect(content).not.toContain("PRIVATE");
  expect(JSON.parse(content).writes_enabled).toBe(false);
  page.once("dialog", (d) => d.accept());
  await job.getByRole("button", { name: "Cancel job", exact: true }).click();
  await job.getByRole("button", { name: "Archive job", exact: true }).click();
  await expect(operations).toContainText("Recent completed jobs (1)");
  const release = operations.getByRole("button", { name: "Release declaration", exact: true });
  await operations.locator("details").first().locator("summary").click();
  page.once("dialog", (d) => d.accept());
  await release.click();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => /operations_.*(apply|execute)/.test(c.type)).length,
    ),
  ).toBe(0);
});

test("lost mutation acknowledgement requires reload without duplicate job creation", async ({
  page,
}) => {
  const operations = await prepare(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (msg) => {
      const result = await original(msg);
      if (msg.type.endsWith("operations_create")) throw {};
      return result;
    };
  });
  await operations.getByRole("button", { name: "Create check job", exact: true }).click();
  await expect(operations.getByRole("alert")).toContainText("response was lost");
  await expect(
    operations.getByRole("button", { name: "Create check job", exact: true }),
  ).toBeDisabled();
  await operations.getByRole("button", { name: "Reload operations", exact: true }).click();
  expect(await page.evaluate(() => window.demoOperations.jobs.length)).toBe(1);
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("operations_create")).length,
    ),
  ).toBe(1);
});

test("operations are hidden from non-administrators", async ({ page }) => {
  await page.goto("/?reader=1");
  await expect(page.locator("hikvision-schedule-operations")).toHaveCount(0);
  expect(await page.evaluate(() => window.calls.some((c) => c.type.includes("operations_")))).toBe(
    false,
  );
});

test("Hebrew operations review fits mobile and explains local responsibility", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const operations = await prepare(page, true);
  await operations.getByRole("button", { name: "סקירת אחריות למשאבים", exact: true }).click();
  await expect(operations).toContainText("ההצהרה אינה קובעת שהמזהים פנויים");
  await operations.scrollIntoViewIfNeeded();
  const size = await operations.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(size.width).toBeLessThanOrEqual(390);
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  await page.screenshot({ path: "test-results/schedule-operations-he-mobile.png", fullPage: true });
});
