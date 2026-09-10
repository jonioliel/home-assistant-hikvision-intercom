import { navigate, openAppearance } from "./navigation";
import { test, expect, type Page } from "@playwright/test";
const panel = (page: Page) => page.locator("hikvision-intercom-panel");
const key = "hikvision-intercom:appearance:v1:demo-admin";
async function choose(page: Page, choice = "New") {
  const active = await page.locator('.nav [aria-current="page"]').innerText();
  await openAppearance(page);
  const picker = page.locator("hikvision-appearance-picker");
  await picker.getByRole("radio", { name: choice, exact: true }).check();
  await picker.getByRole("button", { name: "Apply design" }).click();
  await expect(picker.getByRole("dialog")).toHaveCount(0);
  await navigate(page, active.trim());
}
const nav = navigate;
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.locator(".app-shell").evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
}
test("existing default; design persists per user and ignores invalid saved values", async ({
  page,
}) => {
  await page.goto("/");
  await expect(panel(page)).toHaveAttribute("data-appearance", "current");
  await choose(page);
  await expect(panel(page)).toHaveAttribute("data-appearance", "modern");
  await page.reload();
  await expect(panel(page)).toHaveAttribute("data-appearance", "modern");
  await page.evaluate(() => {
    const p = document.querySelector("hikvision-intercom-panel") as any;
    p.hass = { ...window.demoHass, user: { id: "second-admin", is_admin: true } };
  });
  await expect(panel(page)).toHaveAttribute("data-appearance", "current");
  await page.evaluate((k) => localStorage.setItem(k, "invalid-value"), key);
  await page.reload();
  await expect(panel(page)).toHaveAttribute("data-appearance", "current");
});
test("cancel and Escape keep design and restore focus", async ({ page }) => {
  await page.goto("/");
  await openAppearance(page);
  const opener = page.locator(".tools-grid .appearance-button");
  const picker = page.locator("hikvision-appearance-picker");
  await picker.getByRole("radio", { name: "New", exact: true }).check();
  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(opener).toBeFocused();
  await expect(panel(page)).toHaveAttribute("data-appearance", "current");
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("blocked browser storage applies design for the session without losing access", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.goto("/");
  await choose(page);
  await expect(panel(page)).toHaveAttribute("data-appearance", "modern");
  await expect(
    page.getByRole("status").filter({ hasText: "This browser could not save" }),
  ).toBeVisible();
  await nav(page, "Users");
  await expect(page.getByRole("button", { name: "+ Add user" })).toBeVisible();
});
test("editor and camera dialogs expose no appearance controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".head .appearance-button")).toHaveCount(0);
  await page.locator(".overview-station .camera-wrap button").first().click();
  await expect(page.locator(".camera-dialog")).toBeVisible();
  await expect(page.locator(".camera-dialog .appearance-button")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await nav(page, "Users");
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  const editor = page.locator(".editor-dialog");
  await editor.getByLabel("Name", { exact: true }).fill("Unchanged draft");
  await expect(editor.locator(".appearance-button")).toHaveCount(0);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unchanged draft");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(() => window.calls.some((c) => /users\/(create|update)$/.test(c.type))),
  ).toBe(false);
});

test("effective Home Assistant theme changes palette without changing selected design", async ({
  page,
}) => {
  await page.goto("/");
  await choose(page);
  await page.evaluate(() => {
    const p = document.querySelector("hikvision-intercom-panel") as any;
    p.hass = { ...window.demoHass, themes: { darkMode: true } };
  });
  await expect(panel(page)).toHaveAttribute("data-dark", "");
  await expect(panel(page)).toHaveAttribute("data-appearance", "modern");
  expect(
    await panel(page).evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--card-background-color").trim(),
    ),
  ).toBe("#1c2835");
  await nav(page, "Events");
  expect(
    await page
      .locator("hikvision-intercom-events")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--surface").trim()),
  ).toBe("#1c2835");
});
for (const [name, width, lang, dark] of [
  ["desktop-he", 1440, "he", false],
  ["wide-en", 1920, "en", false],
  ["tablet-he-dark", 768, "he", true],
  ["mobile-he", 390, "he", false],
  ["small-en-dark", 320, "en", true],
] as const) {
  test(`alternate overview and editor responsive: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript((k) => localStorage.setItem(k, "modern"), key);
    await page.goto(`/?lang=${lang}${dark ? "&dark=1" : ""}`);
    await expect(panel(page)).toHaveAttribute("data-appearance", "modern");
    await noOverflow(page);
    await expect(page.locator(".overview-station")).toHaveCount(9);
    await expect(page.locator(".station-more").first()).not.toHaveAttribute("open", "");
    await page.screenshot({ path: `test-results/alternate-${name}.png`, fullPage: true });
    await nav(page, lang === "he" ? "משתמשים" : "Users");
    await page.getByRole("button", { name: lang === "he" ? "הוספת משתמש" : "Add user" }).click();
    const editor = page.locator(".editor-dialog");
    await editor.getByLabel(lang === "he" ? "שם" : "Name", { exact: true }).fill("Design preview");
    expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(
      editor.getByRole("button", { name: lang === "he" ? "שמירה וסנכרון" : "Save & sync" }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/alternate-editor-${name}.png`, fullPage: true });
  });
}
for (const width of [390, 768, 1440]) {
  test(`all eight views reachable and fit available width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript((k) => localStorage.setItem(k, "modern"), key);
    await page.goto("/");
    for (const tab of [
      "Overview",
      "Users",
      "Intercoms",
      "Sync",
      "Events",
      "Change history",
      "Health & field tests",
      "Access schedules",
    ]) {
      await nav(page, tab);
      await noOverflow(page);
    }
  });
}
test("narrow HA panel inside desktop viewport uses mobile navigation and user cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await choose(page);
  await panel(page).evaluate((el) => {
    (el as HTMLElement).style.width = "390px";
  });
  await expect(
    page.locator(".nav").getByRole("button", { name: "Management tools", exact: true }),
  ).toBeVisible();
  await nav(page, "Users");
  await expect(page.locator(".desktop-users")).toBeHidden();
  await expect(page.locator(".mobile-users")).toBeVisible();
  await noOverflow(page);
  await nav(page, "Intercoms");
  await noOverflow(page);
});
test("station detail selection and user action disclosure retain every operation", async ({
  page,
}) => {
  await page.goto("/");
  await choose(page);
  await page.locator(".station-more > summary").first().click();
  await page.locator(".station-settings").first().click();
  await expect(page.locator(".device-station:visible")).toHaveCount(1);
  await page.locator(".device-selector select").selectOption("");
  await expect(page.locator(".device-station:visible")).toHaveCount(9);
  await nav(page, "Users");
  const user = page.locator(".desktop-users tbody tr").first();
  await expect(user.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(user.getByRole("button", { name: "Delete", exact: true })).toBeHidden();
  await expect(user.getByRole("button", { name: "Sync now", exact: true })).toBeVisible();
  await user.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
});

test("changing design during release neither replays it nor disables another station", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    window.demoHass.callWS = function (message) {
      if (!message.type.endsWith("stations/test_unlock")) return original.call(this, message);
      window.calls.push(structuredClone(message));
      return new Promise((resolve) => {
        (window as any).finishAppearanceRelease = resolve;
      });
    };
  });
  const cards = page.locator(".overview-station");
  const first = cards.nth(0).getByRole("button", { name: "Open active lock", exact: true });
  const second = cards.nth(1).getByRole("button", { name: "Open active lock", exact: true });
  await first.click();
  await expect(first).toBeDisabled();
  await choose(page);
  await expect(first).toBeDisabled();
  await expect(second).toBeEnabled();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("stations/test_unlock")).length,
    ),
  ).toBe(1);
  await page.evaluate(() => (window as any).finishAppearanceRelease({ accepted: true }));
  await expect(first).toBeEnabled();
});
test("live resizing preserves the form and keeps it within a narrow panel", async ({ page }) => {
  await page.goto("/");
  await choose(page);
  await nav(page, "Users");
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  const editor = page.locator(".editor-dialog");
  await editor.getByLabel("Name", { exact: true }).fill("Resize draft");
  for (const width of [768, 390, 1440, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Resize draft");
    expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const save = await editor
      .getByRole("button", { name: "Save & sync", exact: true })
      .boundingBox();
    expect(save!.y + save!.height).toBeLessThanOrEqual(740);
  }
  await page.setViewportSize({ width: 1500, height: 900 });
  await panel(page).evaluate((el) => {
    (el as HTMLElement).style.width = "390px";
  });
  expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Resize draft");
});
test("landscape mobile and keyboard navigation keep controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await page.goto("/");
  await choose(page);
  await nav(page, "Intercoms");
  await expect(page.locator("main")).toBeFocused();
  await nav(page, "Users");
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  const editor = page.locator(".editor-dialog");
  const save = await editor.getByRole("button", { name: "Save & sync", exact: true }).boundingBox();
  expect(save!.y + save!.height).toBeLessThanOrEqual(360);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
});
