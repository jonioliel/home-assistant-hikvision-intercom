import { test, expect } from "@playwright/test";
import { navigate, openAppearance } from "./navigation";

test("weekly proposal is saved inside user editing without replacing current validity", async ({
  page,
}) => {
  await page.goto("/");
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("weekly");
  const timing = page.locator("hikvision-user-timing");
  await expect(timing.getByRole("note")).toContainText("not enforced");
  await timing.getByLabel("Thursday", { exact: true }).check();
  await timing.getByLabel("Entire selected day(s)").uncheck();
  await timing.getByLabel("Start", { exact: true }).fill("12:00");
  await timing.getByLabel("End", { exact: true }).fill("18:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.type.endsWith("users/update")),
  );
  expect(request.data.access_timing_draft).toMatchObject({
    mode: "weekly",
    days: ["Monday", "Thursday"],
    periods: [{ start: "12:00", end: "18:00" }],
  });
  expect(request.data.valid_from).toBeNull();
  expect(request.data.valid_until).toBeNull();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(timing.getByLabel("Thursday", { exact: true })).toBeChecked();
  await expect(timing.getByLabel("Start", { exact: true })).toHaveValue("12:00");
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("always");
  await expect(timing).toHaveCount(0);
});

test("calendar dates support multiple full days without inventing station activation", async ({
  page,
}) => {
  await page.goto("/");
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("dates");
  const timing = page.locator("hikvision-user-timing");
  for (const date of ["2026-09-21", "2026-09-24"]) {
    await timing.getByLabel("Calendar date", { exact: true }).fill(date);
    await timing.getByRole("button", { name: "Add date", exact: true }).click();
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.type.endsWith("users/update")),
  );
  expect(request.data.access_timing_draft.dates).toEqual(["2026-09-21", "2026-09-24"]);
  expect(request.data.access_timing_draft.periods).toEqual([{ start: "00:00", end: "24:00" }]);
  expect(request.data.access_timing_draft).not.toHaveProperty("enabled");
});

test("one full day validity uses local midnight boundaries across daylight change", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    (window as any).demoData.default_zone = { kind: "iana", name: "Asia/Jerusalem" };
    await (document.querySelector("smplwise-access-control-panel") as any).refresh();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("period");
  await page.getByLabel("Time zone for validity input", { exact: true }).selectOption("");
  await page.getByLabel("Quick selection: one entire day", { exact: true }).fill("2026-10-25");
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2026-10-25T00:00");
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("2026-10-26T00:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.type.endsWith("users/update")),
  );
  expect(Date.parse(request.data.valid_until) - Date.parse(request.data.valid_from)).toBe(
    25 * 3600000,
  );
});

for (const width of [390, 768, 1440]) {
  test(`station settings fit RTL width ${width} and retain physical relay actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?lang=he");
    await openAppearance(page);
    await page.getByRole("radio", { name: "חדש", exact: true }).check();
    await page.getByRole("button", { name: "החלת העיצוב", exact: true }).click();
    await navigate(page, "אינטרקומים");
    await page.locator(".device-selector select").selectOption("station-0");
    await expect(page.locator(".station-config")).toHaveCount(1);
    await expect(page.locator(".station-relay")).toHaveCount(2);
    const box = await page
      .locator(".station-config")
      .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
    expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
    await page.screenshot({ path: `test-results/station-settings-${width}.png`, fullPage: true });
  });
}

test("older backend retains ordinary user editing without receiving an unknown field", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    (window as any).demoData.api.capabilities = [];
    await (document.querySelector("smplwise-access-control-panel") as any).refresh();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.locator('.editor-validity option[value="weekly"]')).toHaveJSProperty(
    "disabled",
    true,
  );
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("always");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.type.endsWith("users/update")),
  );
  expect(request.data).not.toHaveProperty("access_timing_draft");
});

async function datesEditor(page, dates: string[]) {
  await page.goto("/");
  await page.evaluate(async () => {
    (window as any).demoData.default_zone = { kind: "iana", name: "Asia/Jerusalem" };
    await (document.querySelector("smplwise-access-control-panel") as any).refresh();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("dates");
  const timing = page.locator("hikvision-user-timing");
  for (const date of dates) {
    await timing.getByLabel("Calendar date", { exact: true }).fill(date);
    await timing.getByRole("button", { name: "Add date", exact: true }).click();
  }
  return timing;
}

test("convert one day to real validity without sending until save and preserve DST duration", async ({
  page,
}) => {
  const timing = await datesEditor(page, ["2026-10-25"]);
  await timing.getByRole("button", { name: "Prepare enforced validity interval" }).click();
  await expect(timing).toHaveCount(0);
  await expect(page.getByLabel("When may this person enter?", { exact: true })).toHaveValue(
    "period",
  );
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2026-10-24T21:00");
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("2026-10-25T22:00");
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.type.endsWith("users/update")).length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.type.endsWith("users/update")),
  );
  expect(request.data.access_timing_draft).toBeNull();
  expect(Date.parse(request.data.valid_until) - Date.parse(request.data.valid_from)).toBe(
    25 * 3600000,
  );
  expect(request.data).not.toHaveProperty("RightPlan");
});

test("disconnected dates and daily gaps cannot be broadened to continuous access", async ({
  page,
}) => {
  let timing = await datesEditor(page, ["2026-09-21", "2026-09-23"]);
  await expect(
    timing.getByRole("button", { name: "Prepare enforced validity interval" }),
  ).toBeDisabled();
  await page.reload();
  timing = await datesEditor(page, ["2026-09-21", "2026-09-22"]);
  await expect(
    timing.getByRole("button", { name: "Prepare enforced validity interval" }),
  ).toBeEnabled();
  await timing.getByLabel("Entire selected day(s)").uncheck();
  await expect(
    timing.getByRole("button", { name: "Prepare enforced validity interval" }),
  ).toBeDisabled();
});

test("weekly preview checks selected days and exclusive end without station writes", async ({
  page,
}) => {
  const timing = await datesEditor(page, []);
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("weekly");
  await timing.getByLabel("Entire selected day(s)").uncheck();
  await timing.getByText("Preview selected times", { exact: true }).click();
  await timing.getByLabel("Date to check").fill("2026-09-21");
  await timing.getByLabel("Time to check").fill("09:00");
  await expect(timing.locator("output")).toHaveText("Inside the selected window (draft only)");
  await timing.getByLabel("Time to check").fill("17:00");
  await expect(timing.locator("output")).toHaveText("Outside the selected window (draft only)");
  await timing.getByLabel("Date to check").fill("2026-09-22");
  await timing.getByLabel("Time to check").fill("12:00");
  await expect(timing.locator("output")).toHaveText("Outside the selected window (draft only)");
  expect(
    await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.type.endsWith("users/update")).length,
    ),
  ).toBe(0);
});

test("ambiguous or nonexistent DST boundaries cannot be converted", async ({ page }) => {
  const timing = await datesEditor(page, ["2026-03-27"]);
  await timing.getByLabel("Entire selected day(s)").uncheck();
  await timing.getByLabel("Start", { exact: true }).fill("02:30");
  await timing.getByLabel("End", { exact: true }).fill("04:00");
  await expect(
    timing.getByRole("button", { name: "Prepare enforced validity interval" }),
  ).toBeDisabled();
});

test("conversion intersects an existing validity restriction", async ({ page }) => {
  const timing = await datesEditor(page, ["2026-09-21"]);
  // Existing restriction is stored as an absolute instant, including an explicit offset.
  await page.evaluate(() => {
    const panel = document.querySelector("smplwise-access-control-panel") as any;
    panel._draft.timed = true;
    panel._draft.valid_from = "2026-09-21T10:00:00+03:00";
    panel._draft.valid_until = "2026-09-21T12:00:00+03:00";
    panel._validityInputZone = { kind: "iana", name: "UTC" };
    panel._validityFrom = "2026-09-21T07:00";
    panel._validityUntil = "2026-09-21T09:00";
  });
  await timing.getByRole("button", { name: "Prepare enforced validity interval" }).click();
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2026-09-21T07:00");
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("2026-09-21T09:00");
});

for (const width of [390, 768, 1440]) {
  test(`Hebrew timing preview and conversion fit width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/?lang=he");
    await navigate(page, "משתמשים");
    await page.getByRole("button", { name: "עריכה", exact: true }).first().click();
    await page.getByLabel("מתי מותר למשתמש להיכנס?", { exact: true }).selectOption("dates");
    const timing = page.locator("hikvision-user-timing");
    await timing.locator('input[type="date"]').first().fill("2026-09-21");
    await timing.getByRole("button", { name: "הוספת תאריך", exact: true }).click();
    await timing.getByText("תצוגה מקדימה של הזמנים", { exact: true }).click();
    await timing.getByLabel("תאריך לבדיקה", { exact: true }).fill("2026-09-21");
    await expect(timing.locator("output")).toContainText("בתוך הטווח");
    await expect(timing.getByRole("button", { name: "הכנת טווח תוקף לאכיפה" })).toBeEnabled();
    const box = await timing.evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
    expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
    await timing.screenshot({ path: `test-results/timing-preview-${width}.png` });
  });
}
