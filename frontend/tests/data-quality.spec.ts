import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
async function configure(page) {
  await page.goto("/?lifecycle=1");
  await page.evaluate(() => {
    window.qualityResponse = {
      snapshot: "first",
      stale: false,
      total: 51,
      offset: 0,
      limit: 50,
      next_offset: 50,
      previous_offset: null,
      coverage: { scope: "all", scanned: 60, archived: 2, unknown_fields: 0 },
      summary: { people: 51, missing: 51, invalid: 0, duplicate: 0 },
      records: [
        {
          id: "person-0",
          display_name: "Dana Cohen",
          employee_no: "1001",
          revision: 1,
          archived: false,
          operator_editable: true,
          issues: [{ kind: "missing", code: "missing_phone", label: "" }],
        },
      ],
    };
  });
  await navigate(page, "People data quality");
}
for (const width of [390, 1440]) {
  test(`quality filters, stale paging and explicit person review at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(page);
    const view = page.locator("wiskey-data-quality");
    await expect(view.getByText("Contact phone is missing (advisory)")).toBeVisible();
    expect(await view.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await view.getByLabel("Finding type").selectOption("missing");
    expect(
      await page.evaluate(
        () => window.calls.filter((c) => c.type.endsWith("users/data_quality")).at(-1).kind,
      ),
    ).toBe("missing");
    await page.evaluate(() => {
      window.qualityResponse = {
        ...window.qualityResponse,
        stale: true,
        records: [],
        next_offset: null,
      };
    });
    await view.getByRole("button", { name: "Next", exact: true }).click();
    await expect(view).toContainText("People or policy changed");
    expect(
      await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update"))),
    ).toBe(false);
    await page.evaluate(() => {
      window.qualityResponse = {
        ...window.qualityResponse,
        stale: false,
        total: 1,
        offset: 0,
        previous_offset: null,
        records: [
          {
            id: "person-0",
            display_name: "Dana Cohen",
            employee_no: "1001",
            revision: 1,
            archived: false,
            operator_editable: true,
            issues: [{ kind: "missing", code: "missing_phone", label: "" }],
          },
        ],
      };
      document.querySelector("hikvision-intercom-panel")._data.users = [];
    });
    await view.getByRole("button", { name: "Refresh", exact: true }).click();
    await view.getByRole("button", { name: "Open person", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // users/get must fetch even when this person is outside the loaded directory page.
    await expect
      .poll(() =>
        page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/get")).length),
      )
      .toBeGreaterThan(0);
  });
}
test("quality component drops in-flight results when its permission context changes", async ({
  page,
}) => {
  await configure(page);
  await page.evaluate(() => {
    const view = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-data-quality");
    const hass = view.hass;
    view.hass = {
      ...hass,
      callWS: () =>
        new Promise((resolve) => {
          window.resolveQuality = resolve;
        }),
    };
    view.requestUpdate();
  });
  const view = page.locator("wiskey-data-quality");
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.evaluate(() => {
    const view = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-data-quality");
    view.context = "revoked";
    view.canView = false;
    window.resolveQuality({
      ...window.qualityResponse,
      records: [{ display_name: "STALE-SECRET" }],
    });
  });
  await expect(view).not.toContainText("STALE-SECRET");
  await expect(view.getByRole("heading")).toHaveCount(0);
});

test("older backends do not offer the new quality tool", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav").getByRole("button", { name: "Management tools", exact: true }).click();
  await expect(
    page.locator(".tools-grid").getByRole("button", { name: "People data quality", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/data_quality"))),
  ).toBe(false);
});
