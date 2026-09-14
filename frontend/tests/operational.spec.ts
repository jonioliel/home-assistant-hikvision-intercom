import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const version of [0, 2]) {
  test(`incompatible API ${version} preserves an open draft and blocks writes`, async ({
    page,
  }) => {
    await page.goto("/");
    await navigate(page, "Users");
    await page.getByRole("button", { name: "+ Add user", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Retained draft");
    await page.evaluate((version) => {
      window.demoData.api = {
        version,
        min_client: version,
        capabilities: [],
        commands: ["overview", "users/create"],
      };
      window.demoNotify();
    }, version);
    await expect(page.locator(".api-compatibility")).toBeVisible();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Incompatible");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Retained draft");
    expect(
      await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/create"))),
    ).toEqual([]);
  });
}

test("compatible contract is sent only to advertised custom commands", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.api = {
      version: 1,
      min_client: 0,
      capabilities: [],
      commands: ["overview", "users/create"],
    };
    window.demoNotify();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Contract resident");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.calls.find((c) => c.type.endsWith("users/create"))?.api_contract,
    ),
  ).toBe(1);
});

test("sync operation view distinguishes waiting, verified and unknown legacy time", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.sync_operations = [
      {
        id: "op-a",
        user_id: "deleted",
        station_id: "station-0",
        state: "verified",
        queued_at: "2026-09-14T00:00:00Z",
        verified_at: "2026-09-14T00:01:00Z",
        updated_at: "2026-09-14T00:01:00Z",
      },
      {
        id: "op-b",
        user_id: "deleted",
        station_id: "station-1",
        state: "pending",
        queued_at: null,
        verified_at: null,
        updated_at: "2026-09-14T00:01:00Z",
      },
    ];
    window.demoNotify();
  });
  await navigate(page, "Sync");
  await page.locator(".sync-operations summary").click();
  await expect(page.locator(".sync-operations")).toContainText("Applied and verified");
  await expect(page.locator(".sync-operations")).toContainText("Saved · waiting");
  await expect(page.locator(".sync-operations")).toContainText("Unknown");
});

for (const design of ["current", "modern"]) {
  for (const width of [390, 768, 1440]) {
    test(`keyboard form and layout ${design} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.evaluate((design) => {
        const panel = document.querySelector("hikvision-intercom-panel");
        panel._appearance = design;
        panel.requestUpdate();
      }, design);
      const users = page.locator(".nav").getByRole("button", { name: "Users", exact: true });
      await users.focus();
      await page.keyboard.press("Enter");
      const add = page.getByRole("button", { name: "+ Add user", exact: true });
      await add.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name", { exact: true }).fill("Accessible resident with a long name");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(add).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      ).toBe(true);
    });
  }
}

for (const design of ["current", "modern"]) {
  test(`200 percent CSS zoom keeps long form and error accessible ${design}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.evaluate((design) => {
      document.body.style.zoom = "2";
      const panel = document.querySelector("hikvision-intercom-panel");
      panel._appearance = design;
      panel.requestUpdate();
    }, design);
    await navigate(page, "Users");
    await page.getByRole("button", { name: "+ Add user", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Resident with a long display name");
    await dialog.getByLabel("New PIN", { exact: true }).fill("847291");
    await dialog.getByLabel("Confirm PIN", { exact: true }).fill("847292");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
      "Resident with a long display name",
    );
    const button = dialog.getByRole("button", { name: "Cancel", exact: true });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1441);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
  });
}
