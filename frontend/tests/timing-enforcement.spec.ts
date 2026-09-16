import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

async function enable(page: any) {
  await page.goto("/");
  await page.evaluate(async () => {
    (window as any).demoData.api.capabilities.push("user_timing_enforcement");
    await (document.querySelector("hikvision-intercom-panel") as any).refresh();
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
}

test("HA weekly enforcement is explicit, persists and clears only on choosing always", async ({
  page,
}) => {
  await enable(page);
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("weekly");
  await expect(page.getByLabel("Enforcement method", { exact: true })).toHaveValue("ha");
  const timing = page.locator("hikvision-user-timing");
  await expect(timing.getByRole("note")).toContainText("station enforces one finite window");
  await timing.getByLabel("Thursday", { exact: true }).check();
  await timing.getByLabel("Entire selected day(s)").uncheck();
  await timing.getByLabel("Start", { exact: true }).fill("12:00");
  await timing.getByLabel("End", { exact: true }).fill("18:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.type.endsWith("users/update")),
  );
  expect(request.data.access_timing_policy).toMatchObject({
    mode: "ha",
    bindings: {},
    schedule: { days: ["Monday", "Thursday"], periods: [{ start: "12:00", end: "18:00" }] },
  });
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByLabel("Enforcement method", { exact: true })).toHaveValue("ha");
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("always");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.type.endsWith("users/update")).at(-1).data
          .access_timing_policy,
    ),
  ).toBeNull();
});

test("native selection is retained and warns about readback before testing", async ({ page }) => {
  await enable(page);
  await page.getByLabel("When may this person enter?", { exact: true }).selectOption("weekly");
  await page.getByLabel("Enforcement method", { exact: true }).selectOption("native");
  await expect(page.locator("hikvision-user-timing").getByRole("note")).toContainText(
    "deploy and read back",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.find((c: any) => c.type.endsWith("users/update")).data
          .access_timing_policy.mode,
    ),
  ).toBe("native");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByLabel("Enforcement method", { exact: true })).toHaveValue("native");
});

for (const width of [390, 768, 1440]) {
  test(`enforcement selection remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await enable(page);
    await page.getByLabel("When may this person enter?", { exact: true }).selectOption("weekly");
    const select = page.getByLabel("Enforcement method", { exact: true });
    await select.selectOption("native");
    await select.selectOption("ha");
    await expect(select).toHaveValue("ha");
    const box = await select.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(width);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  });
}

test("Hebrew saved draft requires explicit activation and date labels are not drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/?lang=he");
  await page.evaluate(async () => {
    const data = (window as any).demoData;
    data.api.capabilities.push("user_timing_enforcement");
    data.users[0].access_timing_draft = {
      mode: "weekly",
      timezone: "Asia/Jerusalem",
      days: ["Monday"],
      dates: [],
      periods: [{ start: "12:00", end: "18:00" }],
    };
    await (document.querySelector("hikvision-intercom-panel") as any).refresh();
  });
  await navigate(page, "משתמשים");
  await page.getByRole("button", { name: "עריכה", exact: true }).first().click();
  await expect(page.getByLabel("אופן אכיפת הזמנים", { exact: true })).toHaveValue("draft");
  await expect(page.locator("hikvision-user-timing").getByRole("note")).toContainText(
    "הלוח השמור עדיין לא הופעל",
  );
  await page.getByRole("button", { name: /^(שמירה|שמור)$/ }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.find((c: any) => c.type.endsWith("users/update")).data
          .access_timing_policy,
    ),
  ).toBeNull();
  await page.getByRole("button", { name: "עריכה", exact: true }).first().click();
  await page.getByLabel("אופן אכיפת הזמנים", { exact: true }).selectOption("ha");
  await expect(page.getByLabel("אופן אכיפת הזמנים", { exact: true }).locator("option")).toHaveCount(
    2,
  );
  const timing = page.locator("hikvision-user-timing");
  await expect(timing.getByRole("note")).not.toContainText("טיוטת זמנים");
  await page.getByLabel("מתי מותר למשתמש להיכנס?", { exact: true }).selectOption("dates");
  await expect(
    page.getByLabel("מתי מותר למשתמש להיכנס?", { exact: true }).locator("option:checked"),
  ).toHaveText("תאריכים נבחרים");
  await expect(timing.getByRole("button", { name: "הכנת טווח תוקף לאכיפה" })).toHaveCount(0);
});
