import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
async function configure(page) {
  await page.goto("/?lifecycle=1");
  await page.evaluate(() => {
    const central = {
      active: true,
      archived: false,
      granted: true,
      valid_from: null,
      valid_until: null,
      timing_mode: "unrestricted",
      schedule: null,
    };
    window.reviewReport = {
      snapshot: "first",
      stale: false,
      total: 1,
      offset: 0,
      limit: 25,
      next_offset: null,
      previous_offset: null,
      summary: { pending: 1, due: 0, stale: 0, completed: 0, followup: 0 },
      records: [
        {
          user_id: "person-0",
          display_name: "Dana Cohen",
          person_revision: 1,
          status: "pending",
          central,
          latest: null,
          sync_state: "pending",
        },
      ],
    };
    window.reviewPreview = {
      user_id: "person-0",
      station_id: "station-1",
      lock_id: 1,
      person_revision: 1,
      fingerprint: "a".repeat(64),
      latest_id: "",
      central,
      history: [],
    };
  });
  await navigate(page, "Periodic access reviews");
}
for (const width of [390, 1440]) {
  test(`review requires explicit scope, notes and confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(page);
    const view = page.locator("wiskey-permission-reviews");
    await expect(view.getByText("Dana Cohen")).toBeVisible();
    expect(await view.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => window.calls.some((c) => c.type.endsWith("access_review_decide"))),
    ).toBe(false);
    await view.getByRole("button", { name: "Review selected door", exact: true }).click();
    const record = view.getByRole("button", { name: "Record review", exact: true });
    await expect(record).toBeDisabled();
    await view.getByLabel("Review notes", { exact: true }).fill("Approved current door policy");
    await expect(record).toBeDisabled();
    await view.getByLabel("I reviewed the policy for this person and selected door").check();
    await record.click();
    await expect(view).toContainText("Review recorded. Access was not changed.");
    const call = await page.evaluate(() =>
      window.calls.find((c) => c.type.endsWith("access_review_decide")),
    );
    expect(call).toMatchObject({
      station_id: "station-1",
      lock_id: 1,
      confirmed: true,
      cadence_days: 90,
    });
    expect(call.actor).toBeUndefined();
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => /users\/update|doors\/unlock|sync\/run/.test(c.type)),
      ),
    ).toBe(false);
    await view.getByRole("combobox", { name: "Door", exact: true }).selectOption("2");
    expect(
      await page.evaluate(
        () => window.calls.filter((c) => c.type.endsWith("access_reviews")).at(-1).lock_id,
      ),
    ).toBe(2);
  });
}
test("read-only review and stale decision never become an access update", async ({ page }) => {
  await configure(page);
  const view = page.locator("wiskey-permission-reviews");
  await page.evaluate(() => {
    const v = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-permission-reviews");
    v.canManage = false;
  });
  await view.getByRole("button", { name: "Review selected door", exact: true }).click();
  await expect(view.getByRole("button", { name: "Record review" })).toHaveCount(0);
  await page.evaluate(() => {
    const v = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-permission-reviews");
    v.canManage = true;
    window.reviewError = "access_review_stale";
  });
  await view.getByRole("button", { name: "Review selected door", exact: true }).click();
  await view.getByLabel("Review notes", { exact: true }).fill("Check");
  await view.getByLabel("I reviewed the policy for this person and selected door").check();
  await view.getByRole("button", { name: "Record review", exact: true }).click();
  await expect(view.getByRole("alert")).toContainText("Open a new review before recording");
  await expect(view.getByRole("button", { name: "Record review" })).toHaveCount(0);
});
test("in-flight receipt is discarded on permission revocation", async ({ page }) => {
  await configure(page);
  const view = page.locator("wiskey-permission-reviews");
  await page.evaluate(() => {
    const v = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-permission-reviews");
    v.hass = {
      ...v.hass,
      callWS: () =>
        new Promise((resolve) => {
          window.resolveReview = resolve;
        }),
    };
  });
  await view.getByRole("button", { name: "Review selected door", exact: true }).click();
  await page.evaluate(() => {
    const v = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-permission-reviews");
    v.context = "revoked";
    v.canView = false;
    window.resolveReview({ ...window.reviewPreview, history: [{ reason: "STALE-SECRET" }] });
  });
  await expect(view).not.toContainText("STALE-SECRET");
  await expect(view.getByRole("heading")).toHaveCount(0);
});
test("older backend does not offer periodic reviews", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav").getByRole("button", { name: "Management tools", exact: true }).click();
  await expect(
    page
      .locator(".tools-grid")
      .getByRole("button", { name: "Periodic access reviews", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.includes("access_review"))),
  ).toBe(false);
});
