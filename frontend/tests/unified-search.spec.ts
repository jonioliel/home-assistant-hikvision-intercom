import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, query = "") {
  await page.goto((query.includes("embed=1") ? "/hikvision-intercom" : "/") + query);
  await page.evaluate(async () => {
    const w = window as any,
      base = w.demoHass.callWS;
    const design = new URL(location.href).searchParams.get("appearance");
    if (design) w.demoData.appearance_settings.default = design;
    w.searchCalls = [];
    w.hiddenActions = false;
    w.staleSearch = false;
    w.demoData.api.commands.push("search/query", "users/get", "events/list", "audit/list");
    w.demoHass.callWS = async function (message: any) {
      if (!message.type.endsWith("search/query")) return base.call(this, message);
      w.searchCalls.push(message);
      if (w.waitSearch)
        return new Promise((resolve) => {
          w.resumeSearch = resolve;
        });
      const section = (records: any[], total: number | null, available = true) => ({
        available,
        total,
        records,
        next_offset: null,
        previous_offset: null,
      });
      const person = w.demoData.users[0];
      const people = section(
        [
          {
            id: person.id,
            name: person.display_name,
            employee_no: person.employee_no,
            phone: "050-123-4567",
            active: true,
            archived: false,
          },
        ],
        31,
      );
      if (message.kind === "people") {
        people.next_offset = message.offset ? null : 25;
        people.previous_offset = message.offset ? 0 : null;
      }
      return {
        query: message.query,
        kind: message.kind,
        offset: w.staleSearch ? 0 : message.offset,
        snapshot: "a".repeat(24),
        stale: w.staleSearch,
        sections: {
          people,
          events: section(
            [
              {
                id: "evt",
                station_id: "station-0",
                station_name: "Main gate",
                person_name: "Observed old name",
                timestamp: "2030-01-01T00:00:00Z",
                event_type: "access_denied",
                result: "denied",
                authentication: "pin",
                source: "query",
                time_source: "device",
                employee_no: "42",
                door: 1,
              },
            ],
            1,
          ),
          actions: w.hiddenActions
            ? section([], null, false)
            : section(
                [
                  {
                    id: "1",
                    time: "2030-01-01T00:00:00Z",
                    action: "users/update",
                    name_before: "Previous name",
                    name_after: person.display_name,
                    actor_name: "Manager",
                    fields: ["display_name"],
                    stations: ["Main gate"],
                  },
                ],
                1,
              ),
        },
        coverage: {
          event_retention_days: 30,
          action_retention_days: w.hiddenActions ? null : 30,
          event_storage_failed: !!w.storageFailure,
        },
      };
    };
    const panel = document.querySelector("hikvision-intercom-panel") as any;
    panel.hass = { ...w.demoHass };
    await panel.refresh();
  });
  const panel = page.locator("hikvision-intercom-panel");
  await expect(panel.getByRole("button", { name: /^(Search system|חיפוש במערכת)$/ })).toBeVisible();
  await panel.getByRole("button", { name: /^(Search system|חיפוש במערכת)$/ }).click();
  const view = page.locator("wiskey-unified-search");
  await expect(view.getByRole("dialog")).toBeVisible();
  return view;
}
async function search(view: any) {
  await view.getByRole("searchbox").fill("name");
  await view.getByRole("button", { name: /^(Search|חיפוש)$/, exact: true }).click();
  await expect(view.getByRole("region", { name: /^(People|אנשים)$/ })).toContainText("31");
}

test("system search opens existing person details without opening the editor", async ({ page }) => {
  const view = await setup(page);
  await search(view);
  await expect(view).toContainText("Observed old name");
  await view.getByRole("button", { name: "View person", exact: true }).click();
  await expect(page.locator("wiskey-unified-search")).toHaveCount(0);
  await expect(page.locator("wiskey-user-details").getByRole("dialog")).toBeVisible();
  await expect(page.locator("#user-form")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).searchCalls[0].api_contract)).toBe(1);
});
test("restricted source remains unavailable rather than zero and pages reset when data changes", async ({
  page,
}) => {
  const view = await setup(page);
  await page.evaluate(() => {
    (window as any).hiddenActions = true;
  });
  await search(view);
  await expect(view.getByRole("button", { name: "Action history", exact: true })).toBeDisabled();
  await expect(view.getByRole("region", { name: "Action history", exact: true })).toContainText(
    "outside your viewing permissions",
  );
  await view.getByRole("button", { name: "People · 31", exact: true }).click();
  await view.getByRole("button", { name: "Next", exact: true }).click();
  expect(await page.evaluate(() => (window as any).searchCalls.at(-1).offset)).toBe(25);
  await page.evaluate(() => {
    (window as any).staleSearch = true;
  });
  await view.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(view.getByRole("status")).toContainText("first page");
});
test("authenticated account and connection change discard old results and late replies", async ({
  page,
}) => {
  const view = await setup(page);
  await search(view);
  await page.evaluate(() => {
    (window as any).waitSearch = true;
  });
  await view.getByRole("button", { name: "Search", exact: true }).click();
  await page.evaluate(() => {
    const p = document.querySelector("hikvision-intercom-panel") as any;
    const w = window as any;
    p.hass = {
      ...w.demoHass,
      user: { id: "new-person", is_admin: false },
      connection: { ...w.demoHass.connection },
    };
  });
  await expect(page.locator("wiskey-unified-search")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).resumeSearch?.({
      query: "private",
      sections: { people: { records: [{ name: "Private late" }] } },
    });
  });
  await expect(page.locator("hikvision-intercom-panel")).not.toContainText("Private late");
});
for (const appearance of ["current", "wiskey-light", "wiskey-dark"]) {
  test(`mobile RTL search respects viewport and Escape restores focus in ${appearance}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const view = await setup(page, "?lang=he&appearance=" + appearance);
    await search(view);
    await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute(
      "data-appearance",
      appearance,
    );
    expect(
      await view.evaluate(
        (element) => element.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().right,
      ),
    ).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(
      page
        .locator("hikvision-intercom-panel")
        .getByRole("button", { name: "חיפוש במערכת", exact: true }),
    ).toBeFocused();
  });
}
test("search warns on storage failure and leaves existing event journal available", async ({
  page,
}) => {
  const view = await setup(page);
  await page.evaluate(() => {
    (window as any).storageFailure = true;
  });
  await search(view);
  await expect(view.getByRole("alert")).toContainText("storage has a problem");
  await view.getByRole("button", { name: "Open event journal", exact: true }).click();
  await expect(page.locator("wiskey-unified-search")).toHaveCount(0);
  await expect(page.locator("hikvision-intercom-events")).toBeVisible();
  await expect(page.locator("#user-form")).toHaveCount(0);
});

test("embedded system search preserves v1 navigation and the toolbar stays hidden", async ({
  page,
}) => {
  const view = await setup(page, "?embed=1&screen=people");
  await search(view);
  await expect(page.locator(".app-shell > header")).toHaveCount(0);
  await expect(page.locator("hikvision-intercom-panel")).toHaveAttribute("data-embed-api", "1");
  await view.getByRole("button", { name: "View person", exact: true }).click();
  await expect(page.locator("wiskey-user-details").getByRole("dialog")).toBeVisible();
  await expect(page.locator("#user-form")).toHaveCount(0);
});
