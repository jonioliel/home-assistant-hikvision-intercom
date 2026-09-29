import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
async function configure(page) {
  await page.goto("/?lifecycle=1");
  await page.evaluate(() => {
    window.comparisonPeople = {
      records: [
        { id: "person-0", name: "Dana Cohen", archived: false },
        { id: "person-1", name: "Eli", archived: false },
      ],
      total: 2,
      offset: 0,
      next_offset: null,
      previous_offset: null,
    };
    window.comparisonGroups = {
      records: [{ id: "staff", name: "Staff", archived: false }],
      total: 1,
      offset: 0,
      next_offset: null,
      previous_offset: null,
    };
    window.comparisonResponse = {
      left: { name: "Dana Cohen", active: true },
      right: { name: "Staff", enabled: true },
      summary: { shared: 1, left_only: 0, right_only: 1, neither: 0 },
      rows: [
        {
          station_name: "Main gate",
          lock_id: 1,
          relation: "shared",
          left: {
            granted: true,
            source: "inherited",
            groups: [{ id: "staff", name: "Staff" }],
            sources_known: true,
          },
          right: { granted: true, source: "group_policy", groups: [], sources_known: true },
        },
        {
          station_name: "Lobby",
          lock_id: 1,
          relation: "right_only",
          left: { granted: false, source: "personal_deny", groups: [], sources_known: true },
          right: { granted: true, source: "group_policy", groups: [], sources_known: true },
        },
      ],
    };
  });
  await navigate(page, "Compare people and groups");
}
async function select(page) {
  const view = page.locator("wiskey-access-comparison");
  const a = view.getByRole("region", { name: "First selection" }),
    b = view.getByRole("region", { name: "Second selection" });
  await a.getByRole("combobox", { name: "Selected item" }).selectOption("person-0");
  await b.getByRole("combobox", { name: "Selection type" }).selectOption("group");
  await b.getByRole("combobox", { name: "Selected item" }).selectOption("staff");
  return view;
}
for (const width of [390, 1440])
  test(`explicit comparison, differences and no mutation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(page);
    const view = await select(page);
    expect(
      await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/access_compare"))),
    ).toBe(false);
    await view.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(view).toContainText("Personal block");
    await expect(view).toContainText("Main gate");
    expect(await view.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await view.getByRole("combobox", { name: "Door differences" }).selectOption("right_only");
    await expect(view).toContainText("Lobby");
    await expect(view).not.toContainText("Main gate");
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => /users\/update|cards\/add|sync\/user|doors\/unlock/.test(c.type)),
      ),
    ).toBe(false);
    const call = await page.evaluate(() =>
      window.calls.filter((c) => c.type.endsWith("users/access_compare")).at(-1),
    );
    expect(call).toMatchObject({
      left_kind: "person",
      left_id: "person-0",
      right_kind: "group",
      right_id: "staff",
    });
  });
test("search is paged and a changed selection discards a late comparison", async ({ page }) => {
  await configure(page);
  const view = await select(page);
  await page.evaluate(() => {
    const v = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-access-comparison");
    const h = v.hass;
    v.hass = {
      ...h,
      callWS: (message) =>
        message.type.endsWith("users/access_compare")
          ? new Promise((resolve) => {
              window.resolveComparison = resolve;
            })
          : h.callWS(message),
    };
  });
  await view.getByRole("button", { name: "Compare", exact: true }).click();
  const a = view.getByRole("region", { name: "First selection" });
  await a.getByRole("textbox", { name: "Find by name" }).fill("Eli");
  await page.evaluate(() =>
    window.resolveComparison({ ...window.comparisonResponse, left: { name: "STALE-SECRET" } }),
  );
  await expect(view).not.toContainText("STALE-SECRET");
  await a.getByRole("button", { name: "Find by name", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.type.endsWith("users/access_compare_options")).at(-1).query,
    ),
  ).toBe("Eli");
});
test("permission loss discards pending comparison and options", async ({ page }) => {
  await configure(page);
  const view = await select(page);
  await page.evaluate(() => {
    const v = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-access-comparison");
    v.hass = {
      ...v.hass,
      callWS: () => new Promise((resolve) => (window.resolveComparison = resolve)),
    };
  });
  await view.getByRole("button", { name: "Compare", exact: true }).click();
  await page.evaluate(() => {
    const v = document
      .querySelector("hikvision-intercom-panel")
      .shadowRoot.querySelector("wiskey-access-comparison");
    v.canView = false;
    v.context = "revoked";
    window.resolveComparison({ ...window.comparisonResponse, left: { name: "STALE-SECRET" } });
  });
  await expect(view.getByRole("heading")).toHaveCount(0);
  await expect(view).not.toContainText("STALE-SECRET");
});
test("older backend does not advertise comparison", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav").getByRole("button", { name: "Management tools", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Compare people and groups", exact: true }),
  ).toHaveCount(0);
});
