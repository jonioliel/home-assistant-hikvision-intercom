import { test, expect, type Page } from "@playwright/test";
import { navigate, openAppearance } from "./navigation";

const key = "hikvision-intercom:appearance:v1:demo-admin";
async function start(page: Page, design = "access-light", width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ key, design }) => localStorage.setItem(key, design), { key, design });
  await page.goto("/?lang=he");
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute("data-appearance", design);
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.locator(".app-shell").evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
}
for (const design of ["access-light", "access-dark"]) {
  for (const width of [1440, 1024, 390, 360]) {
    test(`${design} responsive workspace ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await start(page, design, width);
      await expect(page.locator(".access-door")).toHaveCount(9);
      await noOverflow(page);
      if (width === 1440) {
        const boxes = await page
          .locator(".access-door")
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().bottom));
        expect(boxes.filter((y) => y < 900).length).toBe(9);
      }
      await page.screenshot({
        path: `test-results/access-${design}-${width}-overview.png`,
        fullPage: true,
      });
      await navigate(page, "משתמשים");
      await expect(page.locator(".access-people-table tbody tr")).not.toHaveCount(0);
      await noOverflow(page);
      if (width === 1440) {
        await expect(page.locator("wiskey-user-details[embedded]")).toBeVisible();
      }
      await page.screenshot({
        path: `test-results/access-${design}-${width}-people.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}
test("people selection retains filter and opens the matching editor", async ({ page }) => {
  await start(page);
  await navigate(page, "משתמשים");
  const names = page.locator(".access-people-table .user-detail-link");
  const name = await names.nth(1).innerText();
  await names.nth(1).click();
  const inspector = page.locator("wiskey-user-details[embedded]");
  await expect(inspector.locator("h2")).toHaveText(name);
  await inspector.getByRole("button", { name: "עריכה", exact: true }).click();
  await expect(page.locator(".editor-dialog").getByLabel("שם", { exact: true })).toHaveValue(name);
  await page.locator(".editor-dialog").getByRole("button", { name: "ביטול", exact: true }).click();
  await expect(inspector.locator("h2")).toHaveText(name);
});
test("mobile details and editor leave actions reachable", async ({ page }) => {
  await start(page, "access-dark", 390);
  await navigate(page, "משתמשים");
  await page.locator(".access-people-table .user-detail-link").first().click();
  await expect(page.locator("wiskey-user-details dialog")).toBeVisible();
  await page
    .locator("wiskey-user-details")
    .getByRole("button", { name: "עריכה", exact: true })
    .click();
  const save = page.locator(".editor-dialog").getByRole("button", { name: "שמירה", exact: true });
  await expect(save).toBeVisible();
  const box = await save.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  await noOverflow(page);
});
test("selected station camera and isolated release preserve the existing contract", async ({
  page,
}) => {
  await start(page);
  const card = page.locator('.access-door[data-station="station-1"]');
  await card.locator(".access-door-camera").click();
  await expect(page.locator(".camera-dialog h2")).toHaveText("כניסת לובי");
  await page.keyboard.press("Escape");
  await card.locator(".access-door-actions button").first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.calls.filter((c) => c.type.endsWith("stations/test_unlock")).length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () => window.calls.find((c) => c.type.endsWith("stations/test_unlock"))?.station_id,
    ),
  ).toBe("station-1");
  await expect(
    page.locator('.access-door[data-station="station-2"] .access-door-actions button').first(),
  ).toBeEnabled();
  await expect(
    page.locator('.access-door[data-station="station-5"] .access-door-camera'),
  ).toBeDisabled();
});
test("global default is saved, followed by another user and preserves personal overrides", async ({
  page,
}) => {
  await page.goto("/");
  await openAppearance(page);
  const picker = page.locator("hikvision-appearance-picker");
  await picker.getByRole("radio", { name: "WisKey Access · Dark", exact: true }).check();
  await picker.getByLabel("Set this design as the shared default for all users").check();
  await picker.getByRole("button", { name: "Apply design" }).click();
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
    "data-appearance",
    "access-dark",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  await page.evaluate(() => {
    const p = document.querySelector("hikvision-intercom-panel") as any;
    p.hass = { ...window.demoHass, user: { id: "second-admin", is_admin: true } };
  });
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
    "data-appearance",
    "access-dark",
  );
  await page.evaluate(() => {
    localStorage.setItem("hikvision-intercom:appearance:v1:third-admin", "modern");
    const p = document.querySelector("hikvision-intercom-panel") as any;
    p.hass = { ...window.demoHass, user: { id: "third-admin", is_admin: true } };
  });
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
    "data-appearance",
    "modern",
  );
});
test("failed shared save stays open and does not claim the new default", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const old = window.demoHass.callWS;
    window.demoHass.callWS = async (m) => {
      if (m.type.endsWith("appearance/settings_update")) throw { code: "revision_conflict" };
      return old(m);
    };
  });
  await openAppearance(page);
  const picker = page.locator("hikvision-appearance-picker");
  await picker.getByRole("radio", { name: "WisKey Access · Light", exact: true }).check();
  await picker.getByLabel("Set this design as the shared default for all users").check();
  await picker.getByRole("button", { name: "Apply design" }).click();
  await expect(picker.getByRole("alert")).toBeVisible();
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
    "data-appearance",
    "current",
  );
});

test("mobile navigation stays at the bottom and never covers the user header", async ({ page }) => {
  await start(page, "access-dark", 390);
  const nav = await page.locator(".head .nav").boundingBox();
  expect(nav!.y).toBeGreaterThan(800);
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(901);
  await navigate(page, "משתמשים");
  const input = page.getByRole("searchbox");
  await expect(input).toBeVisible();
  expect((await input.boundingBox())!.y).toBeLessThan(200);
  await page.locator(".access-transfer-tools summary").click();
  await expect(page.getByRole("button", { name: "ייבוא CSV", exact: true })).toBeVisible();
});

test("density with fourteen people and a selected inspector", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const base = window.demoData.users[0];
    window.demoData.users = Array.from({ length: 14 }, (_, i) => ({
      ...structuredClone(base),
      id: "person-" + i,
      display_name: "אדם " + i,
      phone: "050000" + String(1000 + i),
    }));
    window.demoNotify();
  });
  await navigate(page, "משתמשים");
  const rows = page.locator(".access-people-table tbody tr");
  await expect(rows).toHaveCount(14);
  expect((await rows.first().boundingBox())!.y).toBeLessThanOrEqual(185);
  expect(
    await rows.evaluateAll(
      (els) => els.filter((el) => el.getBoundingClientRect().bottom <= 900).length,
    ),
  ).toBeGreaterThanOrEqual(10);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("wiskey-user-details[embedded]")).toHaveCount(0);
  expect(
    await rows.evaluateAll(
      (els) => els.filter((el) => el.getBoundingClientRect().bottom <= 782).length,
    ),
  ).toBeGreaterThanOrEqual(4);
  await noOverflow(page);
});

test("read-only access uses the new appearance without unlocking or administrator settings", async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, "access-dark"), key);
  await page.goto("/?reader=1&grant=overview:view,users:view");
  await expect(page.locator(".access-doors")).toBeVisible();
  await expect(page.locator(".access-door-actions button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Management tools", exact: true })).toHaveCount(0);
  await navigate(page, "Users");
  await expect(page.locator(".access-person-actions .user-edit").first()).toBeDisabled();
});

for (const design of ["access-light", "access-dark"]) {
  test(`${design} zoom opens reachable person details instead of a hidden inspector`, async ({
    page,
  }) => {
    await start(page, design);
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    await navigate(page, "משתמשים");
    await expect(page.locator("wiskey-user-details[embedded]")).toHaveCount(0);
    await page.locator(".access-people-table .user-detail-link").first().click();
    const details = page.locator("wiskey-user-details dialog");
    await expect(details).toBeVisible();
    const edit = details.getByRole("button", { name: "עריכה", exact: true });
    await edit.click();
    const save = page.locator(".editor-dialog").getByRole("button", { name: "שמירה", exact: true });
    await expect(save).toBeInViewport();
    await noOverflow(page);
  });
}
