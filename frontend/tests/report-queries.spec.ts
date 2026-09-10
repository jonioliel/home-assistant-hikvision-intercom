import { test, expect } from "@playwright/test";

async function prepare(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.profile_settings = {
      revision: 1,
      fields: [{ id: "dept", label: "Department", enabled: true, options: [] }],
      groups: [{ id: "staff", label: "Staff", enabled: true, station_ids: [] }],
      photo_enabled: false,
    };
    window.demoNotify();
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("events/print")) {
        window.calls.push(message);
        const report = await original({ ...message, type: "hikvision_intercom/events/report" });
        return {
          ...report,
          filters: message.filters,
          membership_basis: message.filters.current_group ? "current_observed_owner" : null,
          print_records: Array.from({ length: 260 }, (_, i) => ({
            timestamp: "2026-09-08T12:00:00Z",
            display_timestamp: "2026-09-08T15:00:00+03:00",
            display_timezone: "UTC+03:00",
            person_name: i === 0 ? '<img src="x" onerror="alert(1)">' : "Resident " + i,
            employee_no: "00042",
            station: "Front",
            event_type: "access_granted",
            authentication: "pin",
            result: "granted",
            door: 1,
            card: null,
            recovered: false,
            time_source: "device",
          })),
        };
      }
      return original(message);
    };
  });
  await page.getByRole("button", { name: "Events", exact: true }).click();
}

test("saved report queries preserve applied membership filters and reject removed fields", async ({
  page,
}) => {
  await prepare(page);
  const events = page.locator("hikvision-intercom-events"),
    saved = events.locator("wiskey-saved-reports");
  await events.getByLabel("Current group", { exact: true }).selectOption("staff");
  await events.getByLabel("Department · Current exact value").fill("0007");
  await events.getByRole("button", { name: "Apply filters", exact: true }).click();
  await saved.locator("summary").click();
  await saved.getByLabel("Report query name").fill("Staff 0007");
  await saved.getByRole("button", { name: "Save applied query" }).click();
  await events.getByRole("button", { name: "Clear search and filters" }).click();
  await saved.getByRole("button", { name: "Apply saved query" }).click();
  await expect(events.getByLabel("Department · Current exact value")).toHaveValue("0007");
  await events.getByRole("button", { name: "Generate report", exact: true }).click();
  expect(
    await page.evaluate(
      () => window.calls.findLast((m) => m.type.endsWith("events/report"))?.filters,
    ),
  ).toEqual({ current_group: "staff", current_profile: { dept: "0007" } });
  await page.evaluate(() => {
    window.demoData.profile_settings!.fields[0].label = "Apartment";
    window.demoNotify();
  });
  await expect(events.getByLabel("Apartment · Current exact value")).toBeVisible();
  await saved.getByRole("button", { name: "Apply saved query" }).click();
  await expect(events.getByLabel("Apartment · Current exact value")).toHaveValue("0007");
  await page.evaluate(() => {
    window.demoData.profile_settings!.fields = [];
    window.demoNotify();
  });
  await saved.getByRole("button", { name: "Apply saved query" }).click();
  await expect(events.getByRole("alert")).toContainText("removed station, group or field");
  const stored = await page.evaluate(() =>
    localStorage.getItem("wiskey:report-queries:v1:demo-admin"),
  );
  expect(stored).toContain("0007");
  expect(stored).not.toContain("print_records");
  await prepare(page);
  const reopened = page.locator("wiskey-saved-reports");
  await reopened.locator("summary").click();
  await reopened.getByRole("combobox").selectOption({ label: "Staff 0007" });
  await reopened.getByRole("button", { name: "Apply saved query" }).click();
  await expect(
    page.locator("hikvision-intercom-events").getByLabel("Department · Current exact value"),
  ).toHaveValue("0007");
});

for (const width of [360, 1440]) {
  test(`full print preview escapes names and prints all 260 records at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await prepare(page);
    const events = page.locator("hikvision-intercom-events");
    if (width === 360) await events.locator(".event-filters summary").click();
    await events.getByLabel("Current group", { exact: true }).selectOption("staff");
    await events.getByRole("button", { name: "Apply filters", exact: true }).click();
    await events.getByRole("button", { name: "Prepare full print report" }).click();
    const frame = events.frameLocator("iframe.print-frame");
    await expect(frame.locator("tbody tr")).toHaveCount(260);
    await expect(frame.locator("img,script")).toHaveCount(0);
    await expect(frame.locator("tbody tr").first()).toContainText(
      '<img src="x" onerror="alert(1)">',
    );
    await expect(frame.locator("body")).toContainText("Current group: Staff");
    await expect(events.getByRole("button", { name: "Print / save as PDF" })).toBeEnabled();
    const actual = await events.locator("iframe.print-frame").elementHandle();
    const content = await actual!.contentFrame();
    await content!.evaluate(() => {
      (window as any).printed = 0;
      window.print = () => {
        (window as any).printed++;
      };
    });
    await events.getByRole("button", { name: "Print / save as PDF" }).click();
    expect(await content!.evaluate(() => (window as any).printed)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await events.getByRole("button", { name: "Clear search and filters" }).click();
    await expect(events.locator("iframe.print-frame")).toHaveCount(0);
  });
}

test("late full print response cannot restore a report after filters are reset", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("events/print")) {
        const result = await base(message);
        return new Promise((resolve) => {
          (window as any).finishPrint = () => resolve(result);
        });
      }
      return base(message);
    };
  });
  const events = page.locator("hikvision-intercom-events");
  await events.getByRole("button", { name: "Prepare full print report" }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishPrint)).toBe("function");
  await events.getByRole("button", { name: "Clear search and filters" }).click();
  await page.evaluate(() => (window as any).finishPrint());
  await expect(events.locator("iframe.print-frame")).toHaveCount(0);
  await expect(events.locator(".activity-report")).toHaveCount(0);
  await expect(events.getByRole("button", { name: "Prepare full print report" })).toBeEnabled();
});
