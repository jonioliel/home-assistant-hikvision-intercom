import { test, expect } from "@playwright/test";
const response = {
  user_id: "target",
  person_revision: 1,
  policy_revision: 3,
  fingerprint: "one",
  can_apply_to_draft: true,
  fields: [{ id: "department", label: "Department", value: "Operations" }],
  selected_fields: ["department"],
  suggestions: [
    {
      group_id: "maintenance",
      label: "Maintenance",
      matching_members: 1,
      matching_people: 2,
      doors: [
        { station_name: "Front", before: [], after: [1], blocked: false },
        { station_name: "Back", before: [], after: [], blocked: true },
      ],
    },
  ],
};
async function mount(page, options = {}) {
  await page.goto("/?lifecycle=1");
  await page.evaluate(
    ({ response, options }) => {
      const panel = document.querySelector("hikvision-intercom-panel");
      const element = document.createElement("wiskey-group-suggestions");
      Object.assign(element, {
        hass: panel.hass,
        userId: "target",
        personRevision: 1,
        policyRevision: 3,
        canView: true,
        canManage: true,
        draftUnchanged: true,
        ...options,
      });
      window.groupSuggestionResponse = response;
      window.groupsApplied = [];
      element.addEventListener("groups-suggested", (event) =>
        window.groupsApplied.push(event.detail),
      );
      document.body.append(element);
    },
    { response, options },
  );
  return page.locator("wiskey-group-suggestions");
}
async function review(view) {
  await view.getByRole("button", { name: "Review suggestions", exact: true }).click();
  await view.getByRole("checkbox", { name: "Department: Operations" }).check();
  await view.getByRole("button", { name: "Find suggestions", exact: true }).click();
}
for (const width of [390, 1440])
  test(`explicit review, preserved block and draft only at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const view = await mount(page);
    await review(view);
    await expect(view).toContainText("Personal block preserved");
    await expect(view.getByRole("button", { name: "Add selected groups to draft" })).toBeDisabled();
    await view.getByRole("checkbox", { name: "Maintenance", exact: true }).check();
    await view.getByRole("checkbox", { name: "I reviewed the groups and door changes" }).check();
    await view.getByRole("button", { name: "Add selected groups to draft" }).click();
    expect(await page.evaluate(() => window.groupsApplied)).toEqual([
      { group_ids: ["maintenance"], person_revision: 1, policy_revision: 3 },
    ]);
    expect(await view.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => /users\/update|sync\/user|doors\/unlock/.test(c.type)),
      ),
    ).toBe(false);
  });
test("changed evidence requires another review", async ({ page }) => {
  const view = await mount(page);
  await review(view);
  await view.getByRole("checkbox", { name: "Maintenance", exact: true }).check();
  await view.getByRole("checkbox", { name: "I reviewed the groups and door changes" }).check();
  await page.evaluate(() => (window.groupSuggestionResponse.fingerprint = "changed"));
  await view.getByRole("button", { name: "Add selected groups to draft" }).click();
  await expect(view).toContainText("Source data changed");
  expect(await page.evaluate(() => window.groupsApplied)).toEqual([]);
  await expect(
    view.getByRole("checkbox", { name: "I reviewed the groups and door changes" }),
  ).not.toBeChecked();
});
test("dirty draft does not request suggestions", async ({ page }) => {
  const view = await mount(page, { draftUnchanged: false });
  await expect(view).toContainText("Save current changes");
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/group_suggestions"))),
  ).toBe(false);
});
test("revoked access discards a pending response", async ({ page }) => {
  const view = await mount(page);
  await page.evaluate(() => {
    const v = document.querySelector("wiskey-group-suggestions");
    v.hass = {
      ...v.hass,
      callWS: () => new Promise((resolve) => (window.suggestionResolve = resolve)),
    };
  });
  await view.getByRole("button", { name: "Review suggestions", exact: true }).click();
  await page.evaluate(() => {
    const v = document.querySelector("wiskey-group-suggestions");
    v.canView = false;
    v.context = "revoked";
    window.suggestionResolve(window.groupSuggestionResponse);
  });
  await expect(view).not.toContainText("Maintenance");
  expect(await page.evaluate(() => window.groupsApplied)).toEqual([]);
});

test("editor adds to draft while preserving personal blocks and other fields", async ({ page }) => {
  await page.goto("/?lifecycle=1");
  await page.evaluate((response) => {
    const panel = document.querySelector("hikvision-intercom-panel");
    const data = window.demoData;
    data.profile_settings = {
      revision: 3,
      photo_enabled: false,
      fields: [{ id: "department", label: "Department", enabled: true, type: "text", options: [] }],
      groups: [
        {
          id: "maintenance",
          label: "Maintenance",
          enabled: true,
          station_ids: ["station-0", "station-1"],
        },
      ],
    };
    const target = data.users[0];
    target.profile = { department: "Operations" };
    target.permission_overrides = { "station-0": "allow", "station-1": "deny" };
    target.group_ids = [];
    target.assignments = {
      "station-0": { enabled: true, allowed_locks: [2], sync_state: "synced" },
    };
    panel._data = structuredClone(data);
    panel.edit(target);
    window.groupSuggestionResponse = {
      ...response,
      user_id: target.id,
      person_revision: target.revision,
    };
  }, response);
  const view = page.locator(".editor-dialog wiskey-group-suggestions");
  await review(view);
  await view.getByRole("checkbox", { name: "Maintenance", exact: true }).check();
  await view.getByRole("checkbox", { name: "I reviewed the groups and door changes" }).check();
  await view.getByRole("button", { name: "Add selected groups to draft" }).click();
  await expect(view).toContainText("Groups added to the draft");
  const draft = await page.evaluate(
    () => document.querySelector("hikvision-intercom-panel")._draft,
  );
  expect(draft.group_ids).toEqual(["maintenance"]);
  expect(draft.permission_overrides).toEqual({ "station-0": "allow", "station-1": "deny" });
  expect(draft.assignments["station-0"].allowed_locks).toEqual([2]);
  expect(draft.assignments["station-1"]).toBeUndefined();
  expect(draft.profile).toEqual({ department: "Operations" });
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update")))).toBe(
    false,
  );
});
