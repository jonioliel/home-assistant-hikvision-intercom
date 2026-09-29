import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
const versions = {
  records: [
    {
      revision: 2,
      saved_at: "2026-09-29T10:00:00Z",
      actor: "admin",
      origin: "saved",
      field_changes: 1,
      group_changes: 1,
    },
    {
      revision: 1,
      saved_at: null,
      actor: "",
      origin: "baseline",
      field_changes: 0,
      group_changes: 0,
    },
  ],
  total: 2,
  next_offset: null,
  previous_offset: null,
  retained_from_revision: 1,
  current_revision: 2,
};
const comparison = {
  before_revision: 1,
  after_revision: 2,
  summary: { fields: 1, groups: 1 },
  rows: [
    {
      kind: "groups",
      id: "staff",
      label: "Operators",
      state: "changed",
      changes: [
        { property: "label", before: "Staff", after: "Operators" },
        { property: "station_ids", before: ["station-0"], after: ["station-1"] },
      ],
    },
    {
      kind: "fields",
      id: "department",
      label: "Department",
      state: "changed",
      changes: [{ property: "required", before: false, after: true }],
    },
  ],
};
async function mount(page) {
  await page.goto("/?lifecycle=1");
  await page.evaluate(
    ({ versions, comparison }) => {
      const panel = document.querySelector("hikvision-intercom-panel");
      window.policyVersionPage = versions;
      window.policyVersionComparison = comparison;
      const v = document.createElement("wiskey-policy-versions");
      Object.assign(v, {
        hass: panel.hass,
        canView: true,
        stations: window.demoData.stations,
        policyRevision: 2,
      });
      document.body.append(v);
    },
    { versions, comparison },
  );
  return page.locator("wiskey-policy-versions");
}
for (const width of [390, 1440])
  test(`version comparison is read only at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const view = await mount(page);
    await view.getByRole("button", { name: "Load policy history" }).click();
    await expect(view).toContainText("original save time unknown");
    await view.getByRole("button", { name: "Compare versions", exact: true }).click();
    await expect(view).toContainText("Main gate");
    await expect(view).toContainText("Lobby entrance");
    await expect(view).toContainText("Required");
    expect(await view.evaluate((v) => v.scrollWidth <= v.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => /settings_update|settings_apply|users\/update/.test(c.type)),
      ),
    ).toBe(false);
  });
test("account change discards a late version comparison", async ({ page }) => {
  const view = await mount(page);
  await view.getByRole("button", { name: "Load policy history" }).click();
  await page.evaluate(() => {
    const v = document.querySelector("wiskey-policy-versions");
    v.hass = {
      ...v.hass,
      callWS: () => new Promise((resolve) => (window.versionResolve = resolve)),
    };
  });
  await view.getByRole("button", { name: "Compare versions", exact: true }).click();
  await page.evaluate(() => {
    const v = document.querySelector("wiskey-policy-versions");
    v.canView = false;
    v.context = "revoked";
    window.versionResolve(window.policyVersionComparison);
  });
  await expect(view).not.toContainText("Operators");
});
test("unknown version shows a recoverable error without changing policy", async ({ page }) => {
  const view = await mount(page);
  await view.getByRole("button", { name: "Load policy history" }).click();
  await page.evaluate(() => {
    const v = document.querySelector("wiskey-policy-versions");
    v.hass = { ...v.hass, callWS: () => Promise.reject({ code: "policy_version_not_found" }) };
  });
  await view.getByRole("button", { name: "Compare versions", exact: true }).click();
  await expect(view).toContainText("version is no longer retained");
});

test("history is discoverable in real profile settings and absent for older command contracts", async ({
  page,
}) => {
  await page.goto("/?lifecycle=1");
  await page.evaluate(
    ({ versions, comparison }) => {
      window.policyVersionPage = versions;
      window.policyVersionComparison = comparison;
    },
    { versions, comparison },
  );
  await navigate(page, "User profile options");
  const settings = page.locator("hikvision-profile-settings");
  const history = settings.locator("wiskey-policy-versions");
  await history.getByRole("button", { name: "Load policy history" }).click();
  await history.getByRole("button", { name: "Compare versions", exact: true }).click();
  await expect(history).toContainText("Operators");
  await page.goto("/");
  await navigate(page, "User profile options");
  await expect(page.getByRole("button", { name: "Load policy history" })).toHaveCount(0);
});
