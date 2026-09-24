import { test, expect, type Page } from "@playwright/test";

const key = "hikvision-intercom:appearance:v1:demo-admin";

async function start(page: Page, theme: "wiskey-light" | "wiskey-dark", width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ key, theme }) => localStorage.setItem(key, theme), { key, theme });
  await page.goto("/?lang=he");
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute("data-appearance", theme);
}

async function noOverflow(page: Page) {
  await expect
    .poll(() => page.locator(".app-shell").evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
}

for (const theme of ["wiskey-light", "wiskey-dark"] as const) {
  for (const width of [1440, 390]) {
    test(`${theme} keeps the approved entry, people and call paths at ${width}px`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await start(page, theme, width);
      await expect(page.locator(".wk4-door")).toHaveCount(width === 390 ? 4 : 9);
      await expect(page.locator(".nav .nav-primary button")).toHaveCount(5);
      await noOverflow(page);
      await page.screenshot({
        path: `test-results/wiskey-${theme}-${width}-overview.png`,
        fullPage: true,
      });

      await page.locator(".wk4-door .wk4-open-camera").first().click();
      const call = page.locator(".camera-dialog");
      await expect(call).toBeVisible();
      await expect(call.locator(".wk4-camera-layout")).toBeVisible();
      await expect(call.locator("hikvision-intercom-audio-controls")).toHaveCount(1);
      await expect(call.locator("wiskey-intercom-tts")).toHaveCount(1);
      await expect(call.locator(".camera-door-actions button").first()).toBeVisible();
      await page.screenshot({
        path: `test-results/wiskey-${theme}-${width}-call.png`,
        fullPage: true,
      });
      const camera = call.locator("hikvision-intercom-camera");
      expect(
        await camera.evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--camera-object-fit").trim(),
        ),
      ).toBe("contain");
      await page.keyboard.press("Escape");

      await page.locator(".nav").getByRole("button", { name: "אנשים", exact: true }).click();
      await expect(page.locator(".access-person-inspector")).toHaveCount(0);
      await page.screenshot({
        path: `test-results/wiskey-${theme}-${width}-people.png`,
        fullPage: true,
      });
      await page.locator(".users-tools .wk4-filter-button").click();
      await expect(page.locator(".access-user-options")).toHaveAttribute("open", "");
      await expect(page.locator(".user-filters")).toHaveAttribute("open", "");
      await page.locator(".access-people-table .user-detail-link").first().click();
      const person = page.locator("wiskey-user-details");
      await expect(person).toHaveAttribute("v4", "");
      await expect(person.locator(".person-grants")).toBeVisible();
      await page.screenshot({
        path: `test-results/wiskey-${theme}-${width}-person.png`,
        fullPage: true,
      });
      expect(
        await person.locator("dialog").evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape");
      await page.locator(".nav").getByRole("button", { name: "פעילות", exact: true }).click();
      await expect(page.locator(".editor-dialog")).toHaveCount(0);
      await noOverflow(page);
      expect(errors).toEqual([]);
    });
  }
}

test("V4 is opt-in alongside all four earlier choices", async ({ page }) => {
  await start(page, "wiskey-light", 1440);
  await page.locator(".nav").getByRole("button", { name: "ניהול", exact: true }).click();
  await page.locator(".tools-grid .appearance-button").click();
  const picker = page.locator("hikvision-appearance-picker");
  await expect(picker.getByRole("radio")).toHaveCount(6);
  for (const value of [
    "current",
    "modern",
    "access-light",
    "access-dark",
    "wiskey-light",
    "wiskey-dark",
  ]) {
    await expect(picker.locator(`input[value="${value}"]`)).toHaveCount(1);
  }
  await picker.getByRole("radio", { name: "WisKey 04 · כהה" }).check();
  await picker.getByRole("button", { name: "החלת העיצוב" }).click();
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
    "data-appearance",
    "wiskey-dark",
  );
});

for (const width of [1440, 390]) {
  test(`V4 station management and secondary screens remain reachable at ${width}px`, async ({
    page,
  }) => {
    await start(page, "wiskey-light", width);
    await page.locator(".nav").getByRole("button", { name: "דלתות", exact: true }).click();
    await expect(page.locator(".device-station:visible")).toHaveCount(1);
    await page.screenshot({ path: `test-results/wiskey-v4-${width}-stations.png`, fullPage: true });
    const station = page.locator(".device-station:visible");
    await expect(station.locator(".wk4-station-shortcuts button")).toHaveCount(2);
    const tabs = station.locator(".station-tabs button");
    await expect(tabs).toHaveCount(4);
    await tabs.nth(1).click();
    await expect(station.locator("wiskey-door-programs")).toBeVisible();
    await tabs.nth(2).click();
    await expect(station.locator("hikvision-station-technical")).toBeVisible();
    await tabs.nth(3).click();
    await expect(station.locator("hikvision-station-technical")).toBeVisible();
    await noOverflow(page);
    await page.locator(".nav").getByRole("button", { name: "פעילות", exact: true }).click();
    await expect(page.locator("hikvision-intercom-events")).toBeVisible();
    const events = page.locator("hikvision-intercom-events");
    await expect(events).toHaveAttribute("v4", "");
    await expect(events.locator(".wk4-activity-table .audit-row")).toHaveCount(2);
    await expect(events.locator(".event-filters")).not.toHaveAttribute("open", "");
    await events.locator(".wk4-activity-table td button").last().click();
    await expect(events.locator(".wk4-activity-table .audit-row").last()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(events.locator(".wk4-event-inspector")).toBeVisible();
    await page.screenshot({ path: `test-results/wiskey-v4-${width}-events.png`, fullPage: true });
    await noOverflow(page);
    await page.locator(".nav").getByRole("button", { name: "ניהול", exact: true }).click();
    await expect(page.locator(".tools-grid")).toBeVisible();
    await page.screenshot({ path: `test-results/wiskey-v4-${width}-tools.png`, fullPage: true });
    await noOverflow(page);
  });
}

for (const count of [4, 6, 9, 12]) {
  test(`V4 fits ${count} stations within a desktop screen`, async ({ page }) => {
    await start(page, "wiskey-light", 1440);
    await page.evaluate((n) => {
      const panel = document.querySelector("hikvision-intercom-panel") as any;
      const source = panel._data.stations;
      panel._data = {
        ...panel._data,
        stations: Array.from({ length: n }, (_, i) => ({
          ...source[i % source.length],
          id: `v4-${i}`,
          name: `תחנה ${i + 1}`,
        })),
      };
    }, count);
    await expect(page.locator(".wk4-door")).toHaveCount(count);
    await expect
      .poll(() =>
        page.locator(".wk4-grid-foot").evaluate((el) => el.getBoundingClientRect().bottom),
      )
      .toBeLessThanOrEqual(900);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/wiskey-v4-${count}-stations.png` });
  });
}

test("V4 preserves count selection, paging and wall full-screen access", async ({ page }) => {
  await start(page, "wiskey-light", 1440);
  await expect(page.getByRole("button", { name: "מסך מלא" })).toBeVisible();
  await page.getByRole("combobox", { name: "תחנות בתצוגה" }).selectOption("4");
  await expect(page.locator(".wk4-door")).toHaveCount(4);
  await expect(page.locator(".wk4-pager")).toContainText("1 / 3");
  await page.locator(".wk4-pager").getByRole("button", { name: "הבא" }).click();
  await expect(page.locator(".wk4-pager")).toContainText("2 / 3");
  await page.getByRole("combobox", { name: "תחנות בתצוגה" }).selectOption("12");
  await expect(page.locator(".wk4-door")).toHaveCount(9);
  await expect(page.locator(".wk4-pager")).toHaveCount(0);
});

test("V4 reduces page size on short desktop and mobile viewports", async ({ page }) => {
  await start(page, "wiskey-light", 1440);
  await page.setViewportSize({ width: 1440, height: 720 });
  await expect(page.locator(".wk4-door")).toHaveCount(4);
  await expect(page.locator(".wk4-pager")).toContainText("1 / 3");
  await expect
    .poll(() => page.locator(".wk4-grid-foot").evaluate((el) => el.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(720);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".wk4-door")).toHaveCount(4);
  await expect(page.locator(".wk4-pager")).toContainText("1 / 3");
  await noOverflow(page);
});

test("V4 delegated viewer retains permitted video and no mutation controls", async ({ page }) => {
  await page.addInitScript((storageKey) => localStorage.setItem(storageKey, "wiskey-light"), key);
  await page.goto("/?reader=1&grant=overview:view,users:view");
  await expect(page.locator(".wk4-door")).toHaveCount(4);
  await expect(
    page.locator(".wk4-head-actions").getByRole("button", { name: "Camera wall" }),
  ).toBeVisible();
  await expect(
    page.locator(".wk4-head-actions").getByRole("button", { name: /Add user/ }),
  ).toHaveCount(0);
  await expect(page.locator(".wk4-door-actions").getByRole("button", { name: /Open/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".nav").getByRole("button", { name: "Management" })).toHaveCount(0);
  await page.locator(".wk4-head-actions").getByRole("button", { name: "Camera wall" }).click();
  await expect(page.locator("wiskey-camera-wall")).toBeVisible();
});
