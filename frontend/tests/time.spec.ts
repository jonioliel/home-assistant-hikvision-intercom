import { test, expect } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });
const zone = {
  kind: "device",
  name: "CST-2:00:00DST01:00:00,M4.1.0/02:00:00,M10.5.0/02:00:00",
  standard: 7200,
  delta: 3600,
  start: [4, 1, 0, 7200],
  end: [10, 5, 0, 7200],
};
async function configure(page) {
  await page.goto("/");
  await page.evaluate(async (zone) => {
    const s = window.demoData.stations[0];
    s.clock.zone = zone;
    s.clock.device_zone = zone;
    s.clock.source = "device";
    s.last_access.timestamp = "2026-09-08T21:30:00Z";
    await document.querySelector("hikvision-intercom-panel").refresh();
  }, zone);
}

test("station time follows device instead of browser and applies source offset only once", async ({
  page,
}) => {
  await configure(page);
  const output = page.locator("article.station").first().locator(".last-access");
  await expect(output).toContainText("9/9/2026, 12:30:00 AM");
  await expect(output).toContainText("UTC+03:00");
  await page.evaluate(async () => {
    window.demoData.stations[0].last_access.timestamp = "2026-09-09T00:30:00+03:00";
    await document.querySelector("hikvision-intercom-panel").refresh();
  });
  await expect(output).toContainText("9/9/2026, 12:30:00 AM");
});

test("device daylight boundaries and manual IANA override use their own rules", async ({
  page,
}) => {
  await configure(page);
  for (const [instant, text, offset] of [
    ["2026-04-04T23:59:59Z", "1:59:59 AM", "UTC+02:00"],
    ["2026-04-05T00:00:00Z", "3:00:00 AM", "UTC+03:00"],
    ["2026-10-24T23:00:00Z", "1:00:00 AM", "UTC+02:00"],
  ]) {
    await page.evaluate(async (timestamp) => {
      window.demoData.stations[0].last_access.timestamp = timestamp;
      await document.querySelector("hikvision-intercom-panel").refresh();
    }, instant);
    await expect(page.locator("article.station").first().locator(".last-access")).toContainText(
      text,
    );
    await expect(page.locator("article.station").first().locator(".last-access")).toContainText(
      offset,
    );
  }
  await page.evaluate(async () => {
    const s = window.demoData.stations[0];
    s.clock.zone = { kind: "iana", name: "Asia/Jerusalem" };
    s.clock.source = "manual";
    s.last_access.timestamp = "2026-03-28T12:00:00Z";
    await document.querySelector("hikvision-intercom-panel").refresh();
  });
  await expect(page.locator("article.station").first().locator(".last-access")).toContainText(
    "3:00:00 PM",
  );
  await page.getByRole("button", { name: "Intercoms", exact: true }).click();
  await expect(page.locator(".clock-details").first()).toContainText("Manual display time zone");
});

test("event filter converts selected station local date to UTC independent of browser", async ({
  page,
}) => {
  await configure(page);
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page.getByLabel("Station", { exact: true }).selectOption("station-0");
  await page.getByLabel("From time", { exact: true }).fill("2026-09-09T00:30");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  const request = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("events/list")).at(-1),
  );
  expect(request.filters.start).toBe("2026-09-08T21:30:00.000Z");
});

test("validity input stores station-local instant as UTC and rejects gaps and folds", async ({
  page,
}) => {
  await configure(page);
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Time test");
  await page.getByLabel("Start and end", { exact: true }).check();
  await expect(page.getByLabel("Time zone for validity input", { exact: true })).toHaveValue(
    "station-0",
  );
  await page.getByLabel("Start", { exact: true }).fill("2026-04-05T02:30");
  await page.getByLabel("End", { exact: true }).fill("2026-04-06T04:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("does not exist");
  await page.getByLabel("Start", { exact: true }).fill("2026-10-25T01:30");
  await page.getByLabel("End", { exact: true }).fill("2026-10-26T04:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("occurs twice");
  await page.getByLabel("Time zone for validity input", { exact: true }).selectOption("__utc__");
  await expect(page.getByLabel("Time zone for validity input", { exact: true })).toHaveValue(
    "station-0",
  );
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/create"))),
  ).toBeFalsy();
  await page.getByLabel("Start", { exact: true }).fill("2026-09-09T00:30");
  await page.getByLabel("End", { exact: true }).fill("2026-09-10T04:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    window.calls.find((c) => c.type.endsWith("users/create")),
  );
  expect(request.data.valid_from).toBe("2026-09-08T21:30:00.000Z");
  expect(request.data.valid_until).toBe("2026-09-10T01:00:00.000Z");
});

test("clock read on one station leaves other station release buttons available", async ({
  page,
}) => {
  await configure(page);
  await page.getByRole("button", { name: "Intercoms", exact: true }).click();
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = (message) =>
      message.type.endsWith("stations/clock_refresh")
        ? new Promise((resolve) => (window.finishClock = () => resolve({})))
        : original(message);
  });
  await page.getByRole("button", { name: "Read station clock", exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "Open active lock", exact: true }).nth(1),
  ).toBeEnabled();
  await page.evaluate(() => window.finishClock());
});

test("Hebrew mobile clock rules wrap and use explicit offset", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.evaluate(async (zone) => {
    window.demoData.stations[0].clock.zone = zone;
    window.demoData.stations[0].clock.device_zone = zone;
    window.demoData.stations[0].clock.device_time = "2026-09-09T00:30:00+03:00";
    await document.querySelector("hikvision-intercom-panel").refresh();
  }, zone);
  await page.getByRole("button", { name: "אינטרקומים", exact: true }).click();
  await page.locator(".clock-details").first().scrollIntoViewIfNeeded();
  await expect(page.locator(".clock-details").first()).toContainText("UTC+03:00");
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((e) => e.shadowRoot.querySelector("main").scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/clock-he-mobile.png" });
});

test("unchanged validity preserves a known fold instant and seconds when changing display zone", async ({
  page,
}) => {
  await configure(page);
  await page.evaluate(async () => {
    const user = window.demoData.users[0];
    user.valid_from = "2026-10-24T22:30:37Z";
    user.valid_until = "2026-10-26T12:00:19Z";
    await document.querySelector("hikvision-intercom-panel").refresh();
  });
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2026-10-25T01:30");
  await page.getByLabel("Time zone for validity input", { exact: true }).selectOption("__utc__");
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2026-10-24T22:30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const request = await page.evaluate(() =>
    window.calls.find((c) => c.type.endsWith("users/update")),
  );
  expect(request.data.valid_from).toBe("2026-10-24T22:30:37Z");
  expect(request.data.valid_until).toBe("2026-10-26T12:00:19Z");
});

for (const target of ["station", "ha", "removed"]) {
  test(`validity draft preserves instants after a background ${target} time-zone change`, async ({
    page,
  }) => {
    await configure(page);
    await page.getByRole("button", { name: "Users", exact: true }).click();
    await page.getByRole("button", { name: "+ Add user", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Draft time test");
    await page.getByLabel("Start and end", { exact: true }).check();
    if (target === "ha")
      await page.getByLabel("Time zone for validity input", { exact: true }).selectOption("");
    await page.getByLabel("Start", { exact: true }).fill("2026-09-10T12:00");
    await page.getByLabel("End", { exact: true }).fill("2026-09-10T13:00");
    const expected = target === "ha" ? "2026-09-10T12:00:00.000Z" : "2026-09-10T09:00:00.000Z";
    await page.evaluate(async (target) => {
      if (target === "ha") window.demoData.default_zone = { kind: "iana", name: "Asia/Jerusalem" };
      else if (target === "removed") window.demoData.stations = window.demoData.stations.slice(1);
      else window.demoData.stations[0].clock.zone = { kind: "iana", name: "UTC" };
      await document.querySelector("hikvision-intercom-panel").refresh();
    }, target);
    await expect(page.getByLabel("Start", { exact: true })).toHaveValue(
      target === "ha" ? "2026-09-10T15:00" : "2026-09-10T09:00",
    );
    if (target === "removed")
      await expect(page.getByLabel("Time zone for validity input", { exact: true })).toHaveValue(
        "",
      );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const sent = await page.evaluate(() =>
      window.calls.find((c) => c.type.endsWith("users/create")),
    );
    expect(sent.data.valid_from).toBe(expected);
  });
}

test("background zone refresh preserves a saved fold and seconds in the validity editor", async ({
  page,
}) => {
  await configure(page);
  await page.evaluate(async () => {
    Object.assign(window.demoData.users[0], {
      valid_from: "2026-10-24T22:30:37Z",
      valid_until: "2026-10-26T12:00:19Z",
    });
    await document.querySelector("hikvision-intercom-panel").refresh();
  });
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.evaluate(async () => {
    window.demoData.stations[0].clock.zone = { kind: "iana", name: "UTC" };
    await document.querySelector("hikvision-intercom-panel").refresh();
  });
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2026-10-24T22:30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const sent = await page.evaluate(() => window.calls.find((c) => c.type.endsWith("users/update")));
  expect(sent.data.valid_from).toBe("2026-10-24T22:30:37Z");
  expect(sent.data.valid_until).toBe("2026-10-26T12:00:19Z");
});

test("an ambiguous unsaved validity range is cleared when its clock rules change", async ({
  page,
}) => {
  await configure(page);
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ambiguous time test");
  await page.getByLabel("Start and end", { exact: true }).check();
  await page.getByLabel("Start", { exact: true }).fill("2026-10-25T01:30");
  await page.getByLabel("End", { exact: true }).fill("2026-10-26T04:00");
  await page.evaluate(async () => {
    window.demoData.stations[0].clock.zone = { kind: "iana", name: "UTC" };
    await document.querySelector("hikvision-intercom-panel").refresh();
  });
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("");
  await expect(page.getByRole("alert")).toContainText("time zone changed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/create")))).toBe(
    false,
  );
});
