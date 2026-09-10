import { test, expect } from "@playwright/test";
import { navigate, openAppearance } from "./navigation";
const clock = (page) => page.locator("hikvision-live-clock");
async function freeze(page, instant: string) {
  await page.clock.install({ time: new Date(Date.parse(instant) - 1000) });
  await page.clock.pauseAt(new Date(instant));
}

for (const [name, instant, zone, before, after] of [
  ["midnight", "2026-09-10T23:59:59Z", "UTC", "23:59:59", "00:00:01"],
  ["Jerusalem summer", "2026-09-10T09:59:59Z", "Asia/Jerusalem", "12:59:59", "13:00:01"],
  ["DST transition", "2026-03-08T06:59:59Z", "America/New_York", "01:59:59", "03:00:01"],
] as const) {
  test(`live clock follows HA zone and actual current time: ${name}`, async ({ page }) => {
    await freeze(page, instant);
    await page.goto("/");
    await page.evaluate((name) => {
      window.demoData.default_zone = { kind: "iana", name };
      window.demoNotify();
    }, zone);
    await expect(clock(page).locator(".zone")).toHaveText(zone);
    await expect(clock(page).locator(".time")).toHaveText(before);
    const priorDate = await clock(page).locator(".date").innerText();
    await page.clock.runFor(2000);
    await expect(clock(page).locator(".time")).toHaveText(after);
    if (name === "midnight")
      expect(await clock(page).locator(".date").innerText()).not.toBe(priorDate);
    await expect(clock(page).getByRole("timer")).toHaveAttribute("aria-live", "off");
  });
}

test("clock ticks without requests or remounting the expanded video", async ({ page }) => {
  await freeze(page, "2026-09-10T12:00:00Z");
  await page.goto("/");
  await page.locator(".overview-station .camera-wrap button").first().click();
  const camera = page.locator(".camera-dialog hikvision-intercom-camera");
  await camera.evaluate((el) => ((window as any).retainedCamera = el));
  await page.clock.runFor(1000);
  const calls = await page.evaluate(() => window.calls.length);
  await page.clock.runFor(3000);
  await expect(clock(page).locator(".time")).toHaveText("12:00:04");
  expect(await page.evaluate(() => window.calls.length)).toBe(calls);
  expect(await camera.evaluate((el) => el === (window as any).retainedCamera)).toBe(true);
  await expect(page.locator(".camera-dialog .appearance-button")).toHaveCount(0);
});

test("clock pauses hidden and detached, catches up on return and accepts changed HA zone", async ({
  page,
}) => {
  await freeze(page, "2026-09-10T12:00:00Z");
  await page.goto("/");
  await expect(clock(page).locator(".time")).toHaveText("12:00:00");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(4000);
  await expect(clock(page).locator(".time")).toHaveText("12:00:00");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    window.demoData.default_zone = { kind: "iana", name: "Asia/Kolkata" };
    window.demoNotify();
  });
  await expect(clock(page).locator(".time")).toHaveText("17:30:04");
  await clock(page).evaluate((el) => {
    (window as any).detachedClock = el;
    el.remove();
  });
  await page.clock.runFor(4000);
  expect(
    await page.evaluate(
      () => (window as any).detachedClock.shadowRoot.querySelector(".time").textContent,
    ),
  ).toBe("17:30:04");
  await page.locator("main").evaluate((el) => el.append((window as any).detachedClock));
  await expect(clock(page).locator(".time")).toHaveText("17:30:08");
});

test("management hub contains every advanced tool and revoked admin access closes it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WisKey", exact: true })).toBeVisible();
  await expect(page.locator(".appearance-button")).toHaveCount(0);
  await navigate(page, "Management tools");
  await expect(page.locator(".tool-card")).toHaveCount(8);
  await expect(page.locator(".tools-grid .appearance-button")).toBeVisible();
  await expect(page.locator(".tools-grid a")).toHaveAttribute(
    "href",
    "/config/integrations/integration/hikvision_intercom",
  );
  for (const name of [
    "Intercoms",
    "Sync",
    "Change history",
    "Health & field tests",
    "Access schedules",
  ]) {
    await navigate(page, name);
    await expect(
      page.getByRole("button", { name: "Back to management tools", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to management tools", exact: true }).click();
    await expect(page.locator(".tools-grid")).toBeVisible();
  }
  await openAppearance(page);
  await page.evaluate(() => {
    const p = document.querySelector("hikvision-intercom-panel") as any;
    p.hass = { ...window.demoHass, user: { id: "reader", is_admin: false } };
  });
  await expect(page.getByText("Administrator access is required.")).toBeVisible();
  await expect(page.locator(".tools-grid")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const count = await page.evaluate(() => window.calls.length);
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => window.calls.length)).toBe(count);
});

for (const design of ["current", "modern"]) {
  test(`WisKey hub and live header fit responsive RTL: ${design}`, async ({ page }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", value),
      design,
    );
    await page.goto("/?lang=he");
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await navigate(page, "סקירה");
      await expect(clock(page)).toBeVisible();
      expect(
        await page.locator(".app-shell").evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await navigate(page, "כלי ניהול");
      expect(
        await page.locator(".app-shell").evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await expect(page.locator(".tools-grid .appearance-button")).toBeVisible();
      await page.screenshot({
        path: `test-results/wiskey-tools-${design}-${width}.png`,
        fullPage: true,
      });
    }
  });
}
