import { test, expect } from "@playwright/test";

test("overview shows HA cameras and only enabled online release buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Intercom Manager" })).toBeVisible();
  await expect(page.locator("article.station")).toHaveCount(9);
  await expect(page.getByRole("button", { name: "Open active lock" })).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Open active lock", exact: true }).nth(5),
  ).toBeDisabled();
  await expect(page.locator("article.station").first()).toHaveClass(/ringing/);
  await expect(page.locator("hikvision-intercom-camera img").first()).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.includes("unlock"))),
  ).toBeFalsy();
  await page.screenshot({ path: "test-results/overview-en.png", fullPage: true });
});

test("Hebrew mobile users are RTL cards without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "משתמשים", exact: true }).click();
  await expect(page.locator(".mobile-users")).toBeVisible();
  await expect(page.locator(".desktop-users")).toBeHidden();
  const overflow = await page
    .locator("hikvision-intercom-panel")
    .evaluate((element) => element.shadowRoot.querySelector("main").scrollWidth > 390);
  expect(overflow).toBeFalsy();
  await expect(
    page.locator("hikvision-intercom-panel").locator("div[dir]").first(),
  ).toHaveAttribute("dir", "rtl");
  await page.screenshot({ path: "test-results/users-he-mobile.png", fullPage: true });
});

test("create user sends a PIN once and clears it from the editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("New resident");
  await dialog.getByLabel("New PIN", { exact: true }).fill("847291");
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill("847291");
  await dialog.getByLabel("Main gate", { exact: false }).check();
  await dialog.getByRole("button", { name: "Save & sync" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("New resident", { exact: true }).first()).toBeVisible();
  const calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("users/create")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].data.pin).toBe("847291");
  expect(calls[0].sync_now).toBe(true);
  await page
    .getByRole("row")
    .filter({ hasText: "New resident" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByLabel("New PIN", { exact: true })).toHaveValue("");
  await expect(page.getByRole("dialog").getByLabel("Confirm PIN", { exact: true })).toHaveValue("");
});

test("mismatching PINs do not send changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Mismatch");
  await dialog.getByLabel("New PIN", { exact: true }).fill("847291");
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill("123478");
  await dialog.getByRole("button", { name: "Save & sync" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The PIN entries do not match.");
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.endsWith("users/create"))),
  ).toBeFalsy();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByRole("dialog").getByLabel("New PIN", { exact: true })).toHaveValue("");
});

test("existing cards stay masked during edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByLabel("Masked", { exact: true })).toHaveValue(
    "•••• 4821",
  );
  await expect(page.getByRole("dialog").getByLabel("Employee ID", { exact: true })).toBeDisabled();
});

test("delete requires explicit confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("2 station(s)");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.endsWith("users/delete"))),
  ).toBeFalsy();
});

test("import and conflict inspection are available", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Import existing" }).click();
  await expect(
    page.getByRole("dialog").getByText("Existing resident", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await page.getByRole("button", { name: "Conflict", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Name changed on station", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/conflict-en.png", fullPage: true });
});

test("reader has no administrative data or subscription", async ({ page }) => {
  await page.goto("/?reader=1");
  await expect(page.getByText("Administrator access is required.")).toBeVisible();
  expect(await page.evaluate(() => window.calls)).toHaveLength(0);
});

test("empty and dark layouts render without application errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?empty=1&dark=1");
  await expect(page.getByText("Add your first intercom in Home Assistant settings.")).toBeVisible();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(page.getByText("Your central user list is empty.")).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/empty-dark.png", fullPage: true });
});

test("ringing and offline state changes update without waiting for a refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("article.station")).toHaveCount(9);
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    window.demoData.stations[1].entities.online = "binary_sensor.live_online";
    window.demoData.stations[1].entities.call_status = "sensor.live_call";
    return panel.hass.callWS({ type: "hikvision_intercom/overview" }).then(() => panel.refresh());
  });
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = {
      ...window.demoHass,
      states: {
        ...window.demoHass.states,
        "binary_sensor.live_online": { state: "on", attributes: {} },
        "sensor.live_call": { state: "ringing", attributes: {} },
      },
    };
  });
  await expect(
    page
      .locator("article.station")
      .filter({ has: page.getByRole("heading", { name: "Lobby entrance" }) }),
  ).toHaveClass(/ringing/);
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = {
      ...panel.hass,
      states: {
        ...panel.hass.states,
        "binary_sensor.live_online": { state: "off", attributes: {} },
      },
    };
  });
  await expect(
    page
      .locator("article.station")
      .filter({ has: page.getByRole("heading", { name: "Lobby entrance" }) })
      .getByRole("button", { name: "Open active lock" }),
  ).toBeDisabled();
});

test("untrusted names render as text", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.users[0].display_name = '<img src=x onerror="window.attacked=true">';
    return document.querySelector("hikvision-intercom-panel").refresh();
  });
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(
    page.getByText('<img src=x onerror="window.attacked=true">', { exact: true }).first(),
  ).toBeVisible();
  expect(await page.evaluate(() => window.attacked)).toBeUndefined();
});

test("live camera rejects a URL outside Home Assistant", async ({ page }) => {
  const external = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http") && !request.url().startsWith("http://127.0.0.1:8765"))
      external.push(request.url());
  });
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    window.demoHass.callWS = (message) => {
      if (message.type === "camera/stream") {
        window.streamRequested = true;
        return Promise.resolve({ url: "http://192.0.2.10/stream" });
      }
      return original(message);
    };
  });
  await page.getByRole("button", { name: "View camera" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.streamRequested)).toBe(true);
  await expect(page.getByRole("dialog").locator("hikvision-intercom-camera video")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("audit filters render historical records with masked credentials", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const view = page.locator("hikvision-intercom-events");
  await expect(view.locator("article")).toHaveCount(2);
  await expect(view.getByText("Historical record", { exact: true })).toBeVisible();
  await expect(view.getByText("••••3210", { exact: true })).toBeVisible();
  await view.getByLabel("Result", { exact: true }).selectOption("denied");
  await view.getByRole("button", { name: "Apply filters" }).click();
  await expect(view.locator("article")).toHaveCount(1);
  await expect(view.getByText("Authentication rejected", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("events/list")).at(-1).filters.result,
    ),
  ).toBe("denied");
});

test("Hebrew audit remains within mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "אירועים", exact: true }).click();
  const view = page.locator("hikvision-intercom-events");
  await expect(view.locator("article")).toHaveCount(2);
  expect(await view.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/events-he-mobile.png", fullPage: true });
});

test("sync error explains the failure and exports only backend diagnostics", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.users[0].assignments["station-0"].sync_state = "error";
    window.demoData.users[0].assignments["station-0"].last_error = "validity_rejected";
    window.demoData.users[0].sync_reference = "112233445566";
    window.demoNotify();
  });
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(
    page.getByText("The station rejected the validity dates.", { exact: false }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sync diagnostics" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("hikvision-sync-diagnostics.json");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const report = JSON.parse(Buffer.concat(chunks).toString());
  expect(report.recent[0].step).toBe("create_person");
  expect(report.recent[0].fields).toEqual(["beginTime", "endTime"]);
  expect(JSON.stringify(report)).not.toContain("192.0.2.");
  expect(JSON.stringify(report)).not.toContain("4821");
});

test("Hebrew sync error stays visible when the station is offline", async ({ page }) => {
  await page.goto("/?lang=he");
  await page.evaluate(() => {
    window.demoData.users[0].assignments["station-0"].sync_state = "error";
    window.demoData.users[0].assignments["station-0"].last_error = "validity_rejected";
    window.demoData.stations[0].online = false;
    window.demoNotify();
  });
  await page.getByRole("button", { name: "סנכרון", exact: true }).click();
  await expect(page.getByText("הציוד דחה את תאריכי התוקף.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "הורד דוח אבחון סנכרון" })).toBeEnabled();
});

test("overview and devices show actual health and historical access context", async ({ page }) => {
  await page.goto("/");
  const gate = page
    .locator("article.station")
    .filter({ has: page.getByRole("heading", { name: "Main gate", exact: true }) });
  await expect(gate.locator(".last-access")).toContainText("Dana");
  await expect(gate.locator(".last-access")).toContainText("Authentication accepted");
  await expect(gate.locator(".last-access")).toContainText("Historical record");
  const offline = page
    .locator("article.station")
    .filter({ has: page.getByRole("heading", { name: "Service gate", exact: true }) });
  await expect(offline.locator(".last-seen")).toContainText("Last successful contact");
  await expect(offline.locator(".pending-users")).toContainText("2");
  await expect(offline.getByRole("button", { name: "Open active lock" })).toBeDisabled();
  await expect(
    page.locator(".metric").filter({ hasText: "Pending sync" }).locator("strong"),
  ).toHaveText("3");
  await page.getByRole("button", { name: "Intercoms", exact: true }).click();
  await expect(gate).toContainText("18.4 ms");
  await expect(offline).toContainText("Not observed since loading");
});

test("user search uses only the four visible card digits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  const search = page.getByRole("searchbox");
  await search.fill("4821");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
  await expect(page.locator(".desktop-users tbody tr")).toContainText("Or Levy");
  await search.fill("482");
  await expect(page.getByText("No matching people.", { exact: true })).toBeVisible();
  await search.fill("Dana");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
  await expect(page.locator(".desktop-users tbody tr")).toContainText("Dana Cohen");
  await search.fill("1002");
  await expect(page.locator(".desktop-users tbody tr")).toContainText("Yuval Barak");
});

test("pending previous PIN removal is visible and clears after confirmation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.pin_removals = [
      {
        id: "retired",
        user_id: "person-0",
        targets: ["station-0", "station-5"],
        confirmed: ["station-0"],
      },
    ];
    window.demoNotify();
  });
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  const row = page.getByText("Previous PIN removal pending", { exact: false });
  await expect(row).toContainText("Or Levy");
  await expect(row).toContainText("Service gate");
  await expect(row).not.toContainText("Main gate");
  await page.evaluate(() => {
    window.demoData.pin_removals = [];
    window.demoNotify();
  });
  await expect(row).toHaveCount(0);
});

test("Hebrew mobile overview preserves unknown access and fits long person names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he&dark=1");
  await page.evaluate(() => {
    Object.assign(window.demoData.stations[0].last_access, {
      person_name: '<img src=x onerror="window.attacked=true">',
      event_type: "unlock_record",
      result: "unknown",
      time_source: "received",
    });
    window.demoNotify();
  });
  const access = page.locator(".last-access").first();
  await expect(access).toContainText("דיווח פתיחה מהמכשיר");
  await expect(access).toContainText("זמן קבלה");
  expect(await page.evaluate(() => window.attacked)).toBeUndefined();
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((el) => el.shadowRoot.querySelector("main").scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/fleet-health-he-mobile.png", fullPage: true });
});

test("station inspection shows observed capabilities and sends only the rescan action", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Intercoms", exact: true }).click();
  const offline = page
    .locator("article.station")
    .filter({ has: page.getByRole("heading", { name: "Service gate", exact: true }) });
  await expect(
    offline.locator(".capability-list li").filter({ hasText: "Access event query" }),
  ).toContainText("Unverified");
  await expect(offline.locator(".event-health")).toContainText("Disconnected; retrying");
  await expect(offline.locator(".event-health")).toContainText("Incomplete; retrying");
  const gate = page
    .locator("article.station")
    .filter({ has: page.getByRole("heading", { name: "Main gate", exact: true }) });
  await expect(gate.locator(".lock-mapping")).toHaveText("Physical lock 1 → API 1");
  await expect(gate.getByRole("link", { name: "Configure in Home Assistant" })).toHaveAttribute(
    "href",
    "/config/integrations/integration/hikvision_intercom",
  );
  await gate.getByRole("button", { name: "Rescan access capabilities" }).click();
  await expect(page.getByText("Station inspection complete.", { exact: true })).toBeVisible();
  const commands = await page.evaluate(() => window.calls.map((item) => item.type));
  expect(commands).toContain("hikvision_intercom/stations/rescan");
  expect(commands.some((item) => item.includes("sync/") || item.includes("test_unlock"))).toBe(
    false,
  );
  const camera = page
    .locator("article.station")
    .filter({ has: page.getByRole("heading", { name: "Rear entrance", exact: true }) });
  await expect(camera.locator(".lock-mapping")).toHaveCount(0);
  await expect(camera.getByRole("button", { name: "Open active lock" })).toHaveCount(0);
});

test("bulk station selection is deliberate, includes offline targets and can be cancelled", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".assignment input:checked")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Select all eligible stations" }).click();
  await expect(dialog.locator(".assignment input:checked")).toHaveCount(8);
  await expect(dialog.getByLabel("Service gate", { exact: false })).toBeChecked();
  await expect(dialog.getByLabel("Rear entrance", { exact: false })).toBeDisabled();
  await expect(dialog.getByLabel("Rear entrance", { exact: false })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Clear selection" }).click();
  await expect(dialog.locator(".assignment input:checked")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.calls.some((item) => /users\/(create|update)/.test(item.type)),
    ),
  ).toBe(false);
});

test("saving bulk assignments sends only the configured physical lock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Fleet resident");
  await dialog.getByRole("button", { name: "Select all eligible stations" }).click();
  await dialog.getByRole("button", { name: "Save & sync" }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("users/create")),
  );
  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0].data.assignments)).toHaveLength(8);
  expect(calls[0].data.assignments["station-5"].enabled).toBe(true);
  expect(calls[0].data.assignments["station-8"]).toBeUndefined();
  for (const assignment of Object.values(calls[0].data.assignments))
    expect(assignment.allowed_locks).toEqual([1]);
});

test("Hebrew mobile inspection shows scan errors and preserves readable layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he&dark=1");
  await page.evaluate(() => {
    window.demoData.stations[0].scan_error = "connection_failed";
    window.demoNotify();
  });
  await page.getByRole("button", { name: "אינטרקומים", exact: true }).click();
  await expect(page.locator(".scan-error").first()).toContainText("סריקת התחנה נכשלה");
  await expect(page.locator(".capability-details").first()).toContainText("מיפוי המנעול המוגדר");
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((el) => el.shadowRoot.querySelector("main").scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/station-inspection-he-mobile.png", fullPage: true });
  await page.locator(".scan-error").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/station-inspection-he-card.png" });
});

test("save persists create and edit with no immediate sync request", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Automatic and already-running sync continue/)).toBeVisible();
  await dialog.getByLabel("Name", { exact: true }).fill("Save later");
  await dialog.getByLabel("Main gate", { exact: false }).check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("users/create")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].sync_now).toBe(false);
  await expect(page.getByText("Saved. Automatic synchronization remains enabled.")).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Save later" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await dialog.getByLabel("Name", { exact: true }).fill("Edited later");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("users/update")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].sync_now).toBe(false);
  expect(calls[0].data.display_name).toBe("Edited later");
});

test("save validates required fields and failed storage leaves editor open", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.endsWith("users/create"))),
  ).toBe(false);
  await dialog.getByLabel("Name", { exact: true }).fill("Keep my draft");
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    window.demoHass.callWS = async function (message) {
      if (message.type.endsWith("users/create")) throw { code: "storage_or_internal_error" };
      return original.call(this, message);
    };
  });
  await dialog.getByRole("button", { name: "Save & sync", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Keep my draft");
  expect(
    await page.evaluate(() =>
      window.demoData.users.some((user) => user.display_name === "Keep my draft"),
    ),
  ).toBe(false);
});

test("configured validity distinguishes future current expired and permanent in local time", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-10T10:00:00Z"));
  await page.goto("/");
  await page.evaluate(() => {
    Object.assign(window.demoData.users[0], {
      valid_from: "2026-09-10T13:01:00+03:00",
      valid_until: "2026-09-10T14:00:00+03:00",
    });
    Object.assign(window.demoData.users[1], {
      valid_from: "2026-09-10T12:00:00+03:00",
      valid_until: "2026-09-10T14:00:00+03:00",
    });
    Object.assign(window.demoData.users[2], {
      valid_from: "2026-09-09T09:00:00Z",
      valid_until: "2026-09-10T13:00:00+03:00",
    });
    Object.assign(window.demoData.users[4], {
      valid_from: "bad-date",
      valid_until: "2026-09-10T14:00:00+03:00",
    });
    return document.querySelector("hikvision-intercom-panel").refresh();
  });
  await page.getByRole("button", { name: "Users", exact: true }).click();
  const row = (name) => page.getByRole("row").filter({ hasText: name });
  await expect(row("Or Levy").locator(".validity-summary")).toContainText("Not started");
  await expect(row("Dana Cohen").locator(".validity-summary")).toContainText("Within period");
  await expect(row("Yuval Barak").locator(".validity-summary")).toContainText("Expired");
  await expect(row("Noa Israeli").locator(".validity-summary")).toContainText("No expiry");
  await expect(row("Noa Israeli")).toContainText("Inactive");
  await expect(row("Maintenance").locator(".validity-summary")).toContainText("Unverified period");
  await expect(row("Maintenance")).not.toContainText("Invalid Date");
  const localStart = await page.evaluate(() =>
    new Date("2026-09-10T13:01:00+03:00").toLocaleString("en"),
  );
  await expect(row("Or Levy").locator(".validity-summary")).toContainText(localStart);
  expect(
    await page.evaluate(() =>
      window.calls.some((item) => /users\/(create|update)|unlock/.test(item.type)),
    ),
  ).toBe(false);
});

test("validity advances on scheduled refresh even if the overview request fails", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-10T10:00:00Z") });
  await page.goto("/");
  await page.evaluate(async () => {
    Object.assign(window.demoData.users[0], {
      valid_from: "2026-09-10T09:00:00Z",
      valid_until: "2026-09-10T10:00:20Z",
    });
    await document.querySelector("hikvision-intercom-panel").refresh();
    const original = window.demoHass.callWS;
    window.demoHass.callWS = async function (message) {
      if (message.type.endsWith("overview")) throw { code: "connection_failed" };
      return original.call(this, message);
    };
  });
  await page.getByRole("button", { name: "Users", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "Or Levy" });
  await expect(row.locator(".validity-summary")).toContainText("Within period");
  await page.clock.fastForward(31000);
  await expect(row.locator(".validity-summary")).toContainText("Expired");
});

test("named lock appears in overview camera station and assignments with the same target", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.stations[0].integrated_locks[0].name = "Garden door";
    return document.querySelector("hikvision-intercom-panel").refresh();
  });
  await expect(page.getByRole("button", { name: "Open Garden door", exact: true })).toBeVisible();
  await page
    .locator("article.station")
    .first()
    .getByRole("button", { name: "View camera" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Open Garden door" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Intercoms", exact: true }).click();
  await expect(page.getByText("Garden door", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open Garden door", exact: true }).click();
  const writes = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("stations/test_unlock")),
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ station_id: "station-0", lock: 1 });
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByRole("dialog").locator(".assignment").first()).toContainText(
    "Garden door",
  );
});

test("Hebrew mobile validity and both save actions fit without overflow", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-10T10:00:00Z"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.evaluate(() => {
    Object.assign(window.demoData.users[0], {
      valid_from: "2026-09-09T10:00:00Z",
      valid_until: "2026-09-10T09:00:00Z",
    });
    return document.querySelector("hikvision-intercom-panel").refresh();
  });
  await page.getByRole("button", { name: "משתמשים", exact: true }).click();
  await expect(page.locator(".mobile-users .validity-summary").first()).toContainText("פג תוקף");
  await page.screenshot({ path: "test-results/validity-he-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "הוספת משתמש", exact: false }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "שמירה", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "שמירה וסנכרון", exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/save-options-he-mobile.png", fullPage: true });
});
