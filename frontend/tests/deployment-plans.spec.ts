import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function prepare(page) {
  await page.goto("/");
  await navigate(page, "Access schedules");
  await page.getByRole("button", { name: "New schedule", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Deployment example");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const plans = page.getByRole("region", { name: "Deployment proposals", exact: true });
  await plans.getByLabel("Proposal station", { exact: true }).selectOption("station-0");
  await plans.getByLabel("Template ID", { exact: true }).fill("10");
  await plans.getByLabel("Weekly plan ID", { exact: true }).fill("20");
  return plans;
}

test("proposal requires fresh comparison then persists locally with a private-free export", async ({
  page,
}) => {
  const plans = await prepare(page);
  await plans.getByRole("button", { name: "Compare proposed configuration", exact: true }).click();
  const review = plans.getByRole("region", { name: "Review proposed configuration", exact: true });
  await expect(review).toContainText("Controlled fields differ");
  await expect(review).toContainText("unknown defaults");
  expect(await page.evaluate(() => window.demoPlans.length)).toBe(0);
  await review.getByRole("button", { name: "Save local proposal", exact: true }).click();
  await expect(review).toHaveCount(0);
  await plans.locator("summary").click();
  const download = page.waitForEvent("download");
  await plans.getByRole("button", { name: "Download proposed configuration", exact: true }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(JSON.stringify(exported)).not.toContain("PRIVATE_PLAN_TOKEN");
  expect(JSON.stringify(exported)).not.toContain("fingerprint");
  expect(exported.report.can_apply).toBe(false);
  await page.evaluate(() => {
    window.demoPlanDrift = true;
  });
  await plans.getByRole("button", { name: "Recheck saved proposal", exact: true }).click();
  await expect(plans).toContainText("Resources changed since the proposal was saved");
  await page.getByLabel("Schedule name", { exact: true }).fill("Changed source");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(plans).toContainText("Source draft has changed");
  page.once("dialog", (d) => d.accept());
  await plans.getByRole("button", { name: "Delete local proposal", exact: true }).click();
  await expect(plans.locator("summary")).toHaveCount(0);
});

test("editing source invalidates a pending proposal without blocking other doors", async ({
  page,
}) => {
  const plans = await prepare(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (msg) =>
      msg.type.endsWith("plan_preview")
        ? new Promise((resolve) => {
            window.finishProposal = async () => resolve(await original(msg));
          })
        : original(msg);
  });
  await plans.getByRole("button", { name: "Compare proposed configuration", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Changed during read");
  await page.evaluate(() => window.finishProposal());
  await expect(
    plans.getByRole("region", { name: "Review proposed configuration", exact: true }),
  ).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open active lock", exact: true }).nth(1),
  ).toBeEnabled();
});

test("uncertain proposal save requires reload and does not repeat the save", async ({ page }) => {
  const plans = await prepare(page);
  await plans.getByRole("button", { name: "Compare proposed configuration", exact: true }).click();
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (msg) => {
      const r = await original(msg);
      if (msg.type.endsWith("plan_save")) throw {};
      return r;
    };
  });
  await plans.getByRole("button", { name: "Save local proposal", exact: true }).click();
  await expect(plans.getByRole("alert")).toContainText("save result is unconfirmed");
  await expect(
    plans.getByRole("button", { name: "Compare proposed configuration", exact: true }),
  ).toBeDisabled();
  await plans.getByRole("button", { name: "Reload proposals", exact: true }).click();
  await expect(plans.locator("summary")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("plan_save")).length),
  ).toBe(1);
});

test("Hebrew mobile proposal remains readable and never offers device apply", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await navigate(page, "תוכניות שעות");
  await page.getByRole("button", { name: "תוכנית חדשה", exact: true }).click();
  await page.getByLabel("שם התוכנית", { exact: true }).fill("בדיקת פריסה");
  await page.getByRole("button", { name: "שמירת טיוטה", exact: true }).click();
  const plans = page.getByRole("region", { name: "תוכניות פריסה", exact: true });
  await plans.getByLabel("תחנה לתוכנית הפריסה", { exact: true }).selectOption("station-0");
  await plans.getByLabel("מזהה תבנית", { exact: true }).fill("10");
  await plans.getByLabel("מזהה תוכנית שבועית", { exact: true }).fill("20");
  await plans.getByRole("button", { name: "השוואת התצורה המוצעת", exact: true }).click();
  const review = plans.getByRole("region", { name: "בדיקת התצורה המוצעת", exact: true });
  await expect(review).toContainText("לא הוחל");
  await review.scrollIntoViewIfNeeded();
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((e) => e.shadowRoot.querySelector("main").scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/deployment-proposal-he-mobile.png" });
});
