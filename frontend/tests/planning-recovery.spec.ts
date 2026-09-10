import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";

const screens = [
  ["hikvision-intercom-schedules", "schedules/list", "Reload drafts"],
  ["hikvision-deployment-plans", "schedules/plan_list", "Reload proposals"],
  ["hikvision-schedule-operations", "schedules/operations_list", "Reload operations"],
];
for (const [selector, command, reload] of screens) {
  test(`${command} missing reply releases controls and ignores a late result`, async ({ page }) => {
    await page.goto("/");
    await page.evaluate((command) => {
      const w = window as any,
        base = w.demoHass.callWS;
      w.demoHass.callWS = async function (message: any) {
        const result = await base.call(this, message);
        if (message.type.endsWith(command) && !w.planningHeld) {
          w.planningHeld = true;
          return new Promise((resolve) => {
            w.planningLate = () => resolve(result);
          });
        }
        return result;
      };
    }, command);
    await page.clock.install();
    await navigate(page, "Access schedules");
    const screen = page.locator(selector);
    await page.clock.fastForward(61000);
    await expect(screen.getByRole("button", { name: reload, exact: true })).toBeEnabled();
    await expect(screen.getByRole("alert")).toBeVisible();
    await page.evaluate(() => (window as any).planningLate());
    await expect(screen.getByRole("alert")).toBeVisible();
    await screen.getByRole("button", { name: reload, exact: true }).click();
    await expect(screen.getByRole("alert")).toHaveCount(0);
  });
  test(`${command} connection replacement starts a fresh read`, async ({ page }) => {
    await page.goto("/");
    await page.evaluate((command) => {
      const w = window as any,
        base = w.demoHass.callWS;
      w.planningReads = 0;
      w.demoHass.callWS = async function (message: any) {
        if (!message.type.endsWith(command)) return base.call(this, message);
        w.planningReads++;
        if (w.planningReads === 1)
          return new Promise((_resolve, reject) => {
            w.planningLate = () => reject({ code: "old_session" });
          });
        return base.call(this, message);
      };
    }, command);
    await navigate(page, "Access schedules");
    const screen = page.locator(selector);
    await page.locator("hikvision-intercom-panel").evaluate(async (node: any) => {
      node.hass = { ...node.hass, connection: { ...node.hass.connection } };
      await node.updateComplete;
    });
    await expect.poll(() => page.evaluate(() => (window as any).planningReads)).toBe(2);
    await page.evaluate(() => (window as any).planningLate());
    await expect(screen.getByRole("alert")).toHaveCount(0);
    await expect(screen.getByRole("button", { name: reload, exact: true })).toBeEnabled();
  });
}

test("a missing schedule save response requires reload without replay", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Access schedules");
  await page.getByRole("button", { name: "New schedule", exact: true }).click();
  await page.getByLabel("Schedule name", { exact: true }).fill("Recovery example");
  await page.evaluate(() => {
    const w = window as any,
      base = w.demoHass.callWS;
    w.demoHass.callWS = async function (message: any) {
      const result = await base.call(this, message);
      if (message.type.endsWith("schedules/create")) return new Promise(() => {});
      return result;
    };
  });
  await page.clock.install();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.clock.fastForward(61000);
  await expect(page.getByRole("alert")).toContainText("save result is unconfirmed");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload drafts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recovery example", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.type.endsWith("schedules/create")).length,
    ),
  ).toBe(1);
});
