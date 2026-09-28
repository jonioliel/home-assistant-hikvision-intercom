import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("timeline distinguishes all evidence sources and exports only the current safe page", async ({
  page,
}) => {
  await page.goto("/?investigations=1");
  await navigate(page, "Access investigation");
  const view = page.locator("wiskey-investigations");
  await expect(view.locator("article")).toHaveCount(3);
  await expect(view.locator("article.sync")).toContainText("verified by device readback");
  await expect(view.locator("article.change")).toContainText("permission change was saved");
  await view.getByRole("combobox", { name: "Evidence source", exact: true }).selectOption("change");
  await view.getByRole("button", { name: "Run investigation" }).click();
  await expect(view.locator("article")).toHaveCount(1);
  const waiting = page.waitForEvent("download");
  await view.getByRole("button", { name: "Download current page" }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("wiskey-investigation-page.json");
  const data = JSON.parse(
    await (
      await download.createReadStream()
    )
      .toArray()
      .then((chunks) => Buffer.concat(chunks).toString()),
  );
  expect(data.records.length).toBe(1);
  expect(data.filters.source).toBe("change");
  expect(
    await page.evaluate(() =>
      window.calls.some((call) => /sync\/user$|users\/update$|test_unlock$/.test(call.type)),
    ),
  ).toBe(false);
});

test("saved filters persist per operator and do not overwrite another tab's edits", async ({
  page,
}) => {
  await page.goto("/?investigations=1");
  await navigate(page, "Access investigation");
  const view = page.locator("wiskey-investigations");
  await view.getByRole("combobox", { name: "Evidence source", exact: true }).selectOption("sync");
  await view.locator("details.saved summary").click();
  await view.getByRole("textbox", { name: "Filter name" }).fill("Sync only");
  await view.getByRole("button", { name: "Save current filters" }).click();
  await page.reload();
  await navigate(page, "Access investigation");
  await view.locator("details.saved summary").click();
  await view
    .getByRole("combobox", { name: "Saved investigation filters", exact: true })
    .selectOption({ label: "Sync only" });
  await view.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(view.locator("article")).toHaveCount(1);
  await expect(view.getByRole("combobox", { name: "Evidence source", exact: true })).toHaveValue(
    "sync",
  );
  await page.evaluate(() => localStorage.setItem("wiskey:investigation-views:v1:demo-admin", "[]"));
  await view.getByRole("textbox", { name: "Filter name" }).fill("Another");
  await view.getByRole("button", { name: "Save current filters" }).click();
  await expect(view.getByRole("alert")).toContainText("Existing data was preserved");
  expect(
    await page.evaluate(() => localStorage.getItem("wiskey:investigation-views:v1:demo-admin")),
  ).toBe("[]");
  await view.getByRole("button", { name: "Reload saved filters" }).click();
  await expect(view.getByRole("alert")).toHaveCount(0);
});

test("paging notices changed evidence and refresh returns to the beginning", async ({ page }) => {
  await page.goto("/?investigations=1");
  await page.evaluate(() => {
    window.investigationRows = Array.from({ length: 60 }, (_, i) => ({
      ...window.investigationRows[0],
      id: `access/${i}`,
    }));
  });
  await navigate(page, "Access investigation");
  const view = page.locator("wiskey-investigations");
  await expect(view.locator("article")).toHaveCount(50);
  await page.evaluate(() => window.investigationRevision++);
  await view.getByRole("button", { name: "Next", exact: true }).click();
  await expect(view.getByRole("alert")).toContainText("Evidence changed while paging");
  await expect(view.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(view.locator("article")).toHaveCount(50);
  await expect(view.getByRole("alert")).toHaveCount(0);
});

test("Hebrew mobile timeline fits and delegated managers have no timeline entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?investigations=1&lang=he");
  await navigate(page, "תחקור גישה");
  const view = page.locator("wiskey-investigations");
  await expect(view.locator("article")).toHaveCount(3);
  expect(await view.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.goto("/?investigations=1&reader=1&grant=management:manage,users:manage,events:manage");
  await navigate(page, "Management tools");
  await expect(
    page.locator(".tools-grid").getByRole("button", { name: "Access investigation", exact: true }),
  ).toHaveCount(0);
});

test("corrupt saved filters are preserved and late replies cannot reopen a detached investigation", async ({
  page,
}) => {
  await page.goto("/?investigations=1");
  await page.evaluate(() =>
    localStorage.setItem("wiskey:investigation-views:v1:demo-admin", "CORRUPT"),
  );
  await navigate(page, "Access investigation");
  const view = page.locator("wiskey-investigations");
  await view.locator("details.saved summary").click();
  await expect(view.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("wiskey:investigation-views:v1:demo-admin")),
  ).toBe("CORRUPT");
  await page.evaluate(() => (window.investigationDelay = 700));
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await navigate(page, "Events");
  await page.waitForTimeout(900);
  await expect(view).toHaveCount(0);
  await expect(page.locator("hikvision-intercom-events")).toBeVisible();
});
