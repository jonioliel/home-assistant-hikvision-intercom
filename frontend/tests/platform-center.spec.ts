import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/?platform");
  await navigate(page, "Fleet and reporting");
  const center = page.locator("wiskey-platform-center");
  await expect(center.getByRole("button", { name: "Add variant", exact: true })).toBeVisible();
  return center;
}

test("message variants remain review templates rather than automatic sends", async ({ page }) => {
  const center = await open(page);
  await center.getByRole("button", { name: "Add variant", exact: true }).click();
  await center.getByLabel("Template name", { exact: true }).fill("Card holder");
  await center.getByLabel("Access credential", { exact: true }).selectOption("card");
  await center.getByRole("button", { name: "Save variant", exact: true }).click();
  await expect(center.getByRole("heading", { name: "Card holder", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("whatsapp/send"))),
  ).toBe(false);
});

test("fleet application requires review and explicit approval and displays each result", async ({
  page,
}) => {
  const center = await open(page);
  await center.getByRole("button", { name: "Fleet configuration", exact: true }).click();
  await center.getByLabel("Main gate", { exact: true }).check();
  await center.getByLabel("Lobby entrance", { exact: true }).check();
  await center.getByLabel("Opening duration in seconds (optional)", { exact: true }).fill("7");
  await center.getByRole("button", { name: "Preview changes", exact: true }).click();
  const apply = center.getByRole("button", { name: "Apply reviewed changes", exact: true });
  await expect(apply).toBeDisabled();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("platform/config_apply"))),
  ).toBe(false);
  await center.getByLabel("I reviewed and approve these changes", { exact: true }).check();
  await apply.click();
  await expect(center.getByText("device_unavailable", { exact: true })).toBeVisible();
  await expect(center.getByText("Verified", { exact: true })).toBeVisible();
});

test("retention preview and signed archive do not silently delete records", async ({ page }) => {
  const center = await open(page);
  await center.getByRole("button", { name: "Retention and archive", exact: true }).click();
  await center.getByLabel("Retention days (1–365)", { exact: true }).fill("7");
  await center.getByRole("button", { name: "Preview retention impact", exact: true }).click();
  await expect(center.getByRole("status")).toContainText("Records removed: 10");
  expect(
    await page.evaluate(() =>
      window.calls.some((c) => c.type.endsWith("platform/retention_apply")),
    ),
  ).toBe(false);
  const downloading = page.waitForEvent("download");
  await center.getByRole("button", { name: "Download signed archive", exact: true }).click();
  expect((await downloading).suggestedFilename()).toContain("signed.json");
});

test("saved views run existing reports and provide a semantic print table", async ({ page }) => {
  const center = await open(page);
  await center.getByRole("button", { name: "Saved reports", exact: true }).click();
  await center.getByRole("button", { name: "Add saved report", exact: true }).click();
  await center.getByLabel("Report name", { exact: true }).fill("Today");
  await center.getByRole("button", { name: "Save report", exact: true }).click();
  await center.getByRole("button", { name: "Run report", exact: true }).click();
  await expect(center.getByRole("table", { name: "Retained event records" })).toContainText(
    "Report person",
  );
  await expect(center.getByRole("columnheader", { name: "Station", exact: true })).toBeVisible();
});

test("mapped settings import requires a chosen target and review", async ({ page }) => {
  const center = await open(page);
  await center.getByRole("button", { name: "Configuration transfer", exact: true }).click();
  const fixture = {
    format: "smplwise-operations",
    version: 1,
    stations: { old: { name: "Original lobby", values: {} } },
    templates: [],
  };
  await center.getByLabel("Preferences file", { exact: true }).setInputFiles({
    name: "settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await center.getByRole("combobox").selectOption("station-0");
  await center.getByRole("button", { name: "Review mapped import", exact: true }).click();
  await expect(
    center.getByText(
      "Message variant library will be replaced; mapped station preferences will be updated.",
    ),
  ).toBeVisible();
  await expect(
    center.getByRole("button", { name: "Apply mapped import", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("platform/import_apply"))),
  ).toBe(false);
});

test("new center fits Hebrew mobile and a nonadministrator cannot expose it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?platform&lang=he");
  await navigate(page, "תפעול צי ודוחות");
  const center = page.locator("wiskey-platform-center");
  await expect(center.getByRole("button", { name: "הוסף תבנית", exact: true })).toBeVisible();
  expect(await center.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.evaluate(() => {
    const el = document.querySelector("hikvision-intercom-panel")!;
    el.hass = { ...window.demoHass, user: { id: "reader", is_admin: false } };
  });
  await expect(center).toHaveCount(0);
});

test("an observed event opens person details and the existing conversation action", async ({
  page,
}) => {
  await page.goto("/?platform");
  await navigate(page, "Events");
  const events = page.locator("hikvision-intercom-events");
  await events.getByRole("button", { name: "User details", exact: true }).first().click();
  const details = page.locator("wiskey-user-details");
  await expect(details.getByRole("dialog")).toBeVisible();
  await expect(
    details.getByRole("button", { name: "WhatsApp conversation", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("whatsapp/send"))),
  ).toBe(false);
});

test("door presets retain false relay values and never write before review", async ({ page }) => {
  const center = await open(page);
  await center.getByRole("button", { name: "Fleet configuration", exact: true }).click();
  await center.getByLabel("Reverse relay (optional)", { exact: true }).selectOption("false");
  await center.getByLabel("Opening duration in seconds (optional)", { exact: true }).fill("7");
  await center.getByLabel("Door preset name", { exact: true }).fill("Staff door");
  await center.getByRole("button", { name: "Save door preset", exact: true }).click();
  const presets = center.getByRole("region", { name: "Saved door settings", exact: true });
  await expect(presets.getByText("Staff door", { exact: true })).toBeVisible();
  await expect(presets.getByText("Disabled", { exact: true })).toBeVisible();
  await center.getByLabel("Reverse relay (optional)", { exact: true }).selectOption("true");
  await presets.getByRole("button", { name: "Use / edit", exact: true }).click();
  await expect(center.getByLabel("Reverse relay (optional)", { exact: true })).toHaveValue("false");
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("config_apply")))).toBe(
    false,
  );
  await center.getByLabel("Main gate", { exact: true }).check();
  await center.getByRole("button", { name: "Preview changes", exact: true }).click();
  const preview = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("config_preview")).at(-1),
  );
  expect(preview?.changes).toEqual({ openDuration: 7, relayReverseEnabled: false });
  await expect(
    center.getByRole("button", { name: "Apply reviewed changes", exact: true }),
  ).toBeDisabled();
  await presets.getByRole("button", { name: "Delete preset", exact: true }).click();
  await expect(presets.getByText("Staff door", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("config_apply")))).toBe(
    false,
  );
});

test("capacity forecasts label observed bounds and never guess unknown limits", async ({
  page,
}) => {
  await page.goto("/?platform&capacity-trends");
  await navigate(page, "Fleet and reporting");
  const center = page.locator("wiskey-platform-center");
  await center.getByRole("button", { name: "Fleet configuration", exact: true }).click();
  const trends = center.getByRole("article", { name: "Capacity trends", exact: true });
  await expect(trends.getByText("80 / 100", { exact: true })).toBeVisible();
  await expect(trends.getByText("Estimated days to limit: 2", { exact: true })).toBeVisible();
  await expect(trends.getByText("100 / unknown", { exact: true })).toBeVisible();
  await expect(trends.getByText("Unknown limit", { exact: true })).toBeVisible();
  await trends.getByRole("button", { name: "Refresh observed trends", exact: true }).click();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("stations/inventory"))),
  ).toBe(false);
});
