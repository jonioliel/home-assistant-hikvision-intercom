import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const draft = {
  name: "Imported office",
  weekly: Object.fromEntries(
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => [
      day,
      day === "Monday" ? [{ start: "09:00", end: "17:00" }] : [],
    ]),
  ),
  holidays: [],
};
const document = JSON.stringify({
  format: "hikvision_intercom.schedule_drafts",
  version: 1,
  schedules: [draft],
});
async function open(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Access schedules", exact: true }).click();
}
async function upload(page, content = document) {
  await page.getByLabel("Import draft file", { exact: true }).setInputFiles({
    name: "drafts.json",
    mimeType: "application/json",
    buffer: Buffer.from(content),
  });
}

test("import requires preview then appends a new draft and exports only portable fields", async ({
  page,
}) => {
  await open(page);
  await upload(page);
  const review = page.getByRole("region", { name: "Review draft import" });
  await expect(review).toContainText("Imported office");
  expect(await page.evaluate(() => window.demoSchedules.length)).toBe(0);
  await review.getByRole("button", { name: "Import new drafts (1)", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Imported office", exact: true })).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export saved drafts" }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
  expect(exported).toEqual(JSON.parse(document));
  expect(JSON.stringify(exported)).not.toContain("token");
  const calls = await page.evaluate(() =>
    window.calls.filter((c) => c.type.includes("schedules/")),
  );
  expect(calls.map((c) => c.type.split("/").pop())).toEqual([
    "list",
    "import_preview",
    "import_apply",
    "export",
  ]);
});

test("invalid upload and cancelling preview never change the library", async ({ page }) => {
  await open(page);
  await upload(page, "{broken");
  await expect(page.getByRole("alert")).toContainText("Invalid draft file");
  await upload(page);
  await page
    .getByRole("region", { name: "Review draft import" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(await page.evaluate(() => window.demoSchedules.length)).toBe(0);
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("import_apply")))).toBe(
    false,
  );
});

test("lost import reply disables mutations until reload without an automatic duplicate", async ({
  page,
}) => {
  await open(page);
  await upload(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (msg) => {
      const result = await original(msg);
      if (msg.type.endsWith("import_apply")) throw {};
      return result;
    };
  });
  await page.getByRole("button", { name: "Import new drafts (1)", exact: true }).click();
  await expect(page.getByLabel("Import draft file", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New schedule", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reload drafts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Imported office", exact: true })).toHaveCount(1);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("import_apply")).length),
  ).toBe(1);
});
