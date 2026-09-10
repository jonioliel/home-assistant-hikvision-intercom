import { navigate } from "./navigation";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("overview shows HA cameras and only enabled online release buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WisKey" })).toBeVisible();
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
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
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
  await navigate(page, "Sync");
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
  await navigate(page, "Sync");
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
  await navigate(page, "סנכרון");
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
  await navigate(page, "Intercoms");
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
  await navigate(page, "Sync");
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
  await navigate(page, "Intercoms");
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
  expect(Object.keys(calls[0].data.permission_overrides)).toHaveLength(8);
  expect(calls[0].data.permission_overrides["station-5"]).toBe("allow");
  expect(calls[0].data.permission_overrides["station-8"]).toBeUndefined();
  for (const mode of Object.values(calls[0].data.permission_overrides)) expect(mode).toBe("allow");
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
  await navigate(page, "אינטרקומים");
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
    new Date("2026-09-10T13:01:00+03:00").toLocaleString("en", { timeZone: "UTC" }),
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
  await navigate(page, "Intercoms");
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

async function holdReleaseResponses(page) {
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    const waiting = new Map();
    window.demoHass.callWS = function (message) {
      if (!message.type.endsWith("stations/test_unlock")) return original.call(this, message);
      window.calls.push(structuredClone(message));
      return new Promise((resolve, reject) => waiting.set(message.station_id, { resolve, reject }));
    };
    window.finishRelease = (id, code) => {
      const pending = waiting.get(id);
      waiting.delete(id);
      if (code) pending.reject({ code });
      else pending.resolve({ accepted: true });
    };
  });
}

test("a pending release leaves other doors independently clickable", async ({ page }) => {
  await page.goto("/");
  await holdReleaseResponses(page);
  const cards = page.locator("article.station");
  const first = cards.nth(0).getByRole("button", { name: "Open active lock", exact: true });
  const second = cards.nth(1).getByRole("button", { name: "Open active lock", exact: true });
  await first.click();
  await expect(first).toBeDisabled();
  await expect(second).toBeEnabled();
  await expect(
    cards.nth(5).getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      window.calls.filter((item) => item.type.endsWith("stations/test_unlock")),
    ),
  ).toEqual([
    { type: "hikvision_intercom/stations/test_unlock", station_id: "station-0", lock: 1 },
  ]);
  await second.click();
  await expect(second).toBeDisabled();
  await expect(
    cards.nth(2).getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.finishRelease("station-1"));
  await expect(second).toBeEnabled();
  await expect(first).toBeDisabled();
  await expect(cards.nth(1).locator(".release-feedback")).toContainText("Release acknowledged");
  await expect(cards.nth(0).locator(".release-feedback")).toContainText("Sending release");
  await page.evaluate(() => window.finishRelease("station-0"));
  await expect(first).toBeEnabled();
  expect(
    await page.evaluate(() =>
      window.calls
        .filter((item) => item.type.endsWith("stations/test_unlock"))
        .map((item) => item.station_id),
    ),
  ).toEqual(["station-0", "station-1"]);
});

test("same-door pending state follows the camera dialog and Intercoms view", async ({ page }) => {
  await page.goto("/");
  await holdReleaseResponses(page);
  const firstCard = page.locator("article.station").first();
  await firstCard.getByRole("button", { name: "Open active lock", exact: true }).click();
  await firstCard.getByRole("button", { name: "View camera" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeDisabled();
  await expect(dialog.locator(".release-feedback")).toContainText("Sending release");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await navigate(page, "Intercoms");
  const cards = page.locator("article.station");
  await expect(
    cards.first().getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeDisabled();
  await expect(
    cards.nth(1).getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    document.querySelector("hikvision-intercom-panel").unlock(window.demoData.stations[0]),
  );
  expect(
    await page.evaluate(() =>
      window.calls.filter((item) => item.type.endsWith("stations/test_unlock")),
    ),
  ).toHaveLength(1);
  await page.evaluate(() => window.finishRelease("station-0"));
  await expect(
    cards.first().getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeEnabled();
});

test("release failures stay with their station and are never automatically retried", async ({
  page,
}) => {
  await page.goto("/");
  await holdReleaseResponses(page);
  const cards = page.locator("article.station");
  await cards.nth(0).getByRole("button", { name: "Open active lock", exact: true }).click();
  await cards.nth(1).getByRole("button", { name: "Open active lock", exact: true }).click();
  await page.evaluate(() => {
    window.finishRelease("station-0", "PRIVATE_UNKNOWN_RELEASE_ERROR");
    window.finishRelease("station-1");
  });
  await expect(cards.nth(0).locator(".release-feedback")).toContainText(
    "Release was not confirmed",
  );
  await expect(cards.nth(1).locator(".release-feedback")).toContainText("Release acknowledged");
  await expect(cards.nth(2).locator(".release-feedback")).toHaveCount(0);
  await expect(page.locator("hikvision-intercom-panel")).not.toContainText(
    "PRIVATE_UNKNOWN_RELEASE_ERROR",
  );
  await page.evaluate(() => document.querySelector("hikvision-intercom-panel").refresh());
  expect(
    await page.evaluate(() =>
      window.calls.filter((item) => item.type.endsWith("stations/test_unlock")),
    ),
  ).toHaveLength(2);
  await cards.nth(0).getByRole("button", { name: "Open active lock", exact: true }).click();
  await expect(cards.nth(0).locator(".release-feedback")).toContainText("Sending release");
  await page.evaluate(() => window.finishRelease("station-0"));
  await expect(cards.nth(0).locator(".release-feedback")).toContainText("Release acknowledged");
});

test("slow overview refresh does not keep acknowledged doors disabled", async ({ page }) => {
  await page.goto("/");
  await holdReleaseResponses(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    window.demoHass.callWS = function (message) {
      if (!message.type.endsWith("overview")) return original.call(this, message);
      return new Promise((resolve) => {
        window.finishOverview = () => {
          window.demoHass.callWS = original;
          resolve(structuredClone(window.demoData));
        };
      });
    };
  });
  const first = page
    .locator("article.station")
    .first()
    .getByRole("button", { name: "Open active lock", exact: true });
  await first.click();
  await page.evaluate(() => window.finishRelease("station-0"));
  await expect(first).toBeEnabled();
  await expect(
    page
      .locator("article.station")
      .nth(1)
      .getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => typeof window.finishOverview)).toBe("function");
  await page.evaluate(() => window.finishOverview());
});

test("HA unlocking state blocks only its own station even without a local request", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = {
      ...window.demoHass,
      states: {
        ...window.demoHass.states,
        "lock.station_0": { state: "unlocking", attributes: {} },
      },
    };
  });
  const cards = page.locator("article.station");
  await expect(
    cards.first().getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeDisabled();
  await expect(
    cards.nth(1).getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    document.querySelector("hikvision-intercom-panel").unlock(window.demoData.stations[0]),
  );
  expect(
    await page.evaluate(() =>
      window.calls.some((item) => item.type.endsWith("stations/test_unlock")),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = {
      ...panel.hass,
      states: { ...panel.hass.states, "lock.station_0": { state: "locked", attributes: {} } },
    };
  });
  await expect(
    cards.first().getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeEnabled();
});

test("late release completion cannot restore state after the panel disconnects", async ({
  page,
}) => {
  await page.goto("/");
  await holdReleaseResponses(page);
  await page
    .locator("article.station")
    .first()
    .getByRole("button", { name: "Open active lock", exact: true })
    .click();
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.remove();
    document.body.append(panel);
    window.finishRelease("station-0");
  });
  await expect(page.locator("article.station")).toHaveCount(9);
  await expect(page.locator(".release-feedback")).toHaveCount(0);
  await expect(
    page
      .locator("article.station")
      .first()
      .getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeEnabled();
});

test("Hebrew mobile keeps other release buttons active and shows station feedback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await holdReleaseResponses(page);
  const cards = page.locator("article.station");
  await cards.first().getByRole("button", { name: "פתיחת המנעול הפעיל", exact: true }).click();
  await expect(
    cards.nth(1).getByRole("button", { name: "פתיחת המנעול הפעיל", exact: true }),
  ).toBeEnabled();
  await expect(cards.first().locator(".release-feedback")).toContainText("שולח פתיחה");
  await page.evaluate(() => window.finishRelease("station-0", "release_unconfirmed"));
  await expect(cards.first().locator(".release-feedback")).toContainText("לא התקבל אישור לפתיחה");
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((element) => element.shadowRoot.querySelector("main").scrollWidth <= 390),
  ).toBe(true);
  await cards.first().locator(".release-feedback").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/independent-release-he-mobile.png" });
});

test("reconnect refreshes after an old overview response and restores its subscription", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    let once = true;
    window.demoHass.callWS = function (message) {
      if (!message.type.endsWith("overview") || !once) return original.call(this, message);
      once = false;
      return new Promise(
        (resolve) =>
          (window.finishOldOverview = () =>
            resolve({ ...structuredClone(window.demoData), stations: [] })),
      );
    };
    const panel = document.querySelector("hikvision-intercom-panel");
    void panel.refresh();
    panel.remove();
    document.body.append(panel);
  });
  // Reattachment must recover without needing the abandoned response to settle.
  await expect(page.locator("article.station")).toHaveCount(9);
  await page.evaluate(() => window.finishOldOverview());
  await expect(page.locator("article.station")).toHaveCount(9);
  await page.evaluate(() => {
    window.demoData.stations[0].name = "Updated after reconnect";
    window.demoNotify();
  });
  await expect(page.getByRole("heading", { name: "Updated after reconnect" })).toBeVisible();
});

async function openReview(page) {
  await navigate(page, "Sync");
  await page.getByRole("button", { name: "Conflict", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Reconciliation targets" }),
  ).toBeVisible();
  return page.getByRole("dialog");
}

test("review shows field differences, logical changes and fleet impact without writes", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openReview(page);
  await expect(dialog.locator(".review-field")).toHaveCount(10);
  await expect(dialog.locator(".review-field.changed")).toHaveCount(3);
  await expect(dialog.locator('[data-field="pin"]')).toContainText("Different");
  await expect(dialog.locator('[data-field="validity"]')).toContainText("No expiry");
  await expect(dialog.locator('[data-field="cards"]')).toContainText("•••• 4822");
  await expect(dialog.locator(".review-plan")).toContainText("Update");
  await expect(dialog.locator("li")).toHaveCount(3);
  expect(
    await page.evaluate(() =>
      window.calls.some((item) => /conflicts\/resolve|users\/update|test_unlock/.test(item.type)),
    ),
  ).toBeFalsy();
});

test("central edits invalidate a review until it is read again", async ({ page }) => {
  await page.goto("/");
  const dialog = await openReview(page);
  await page.evaluate(() => {
    window.demoData.users[1].display_name = "Edited in another session";
    window.demoData.users[1].revision++;
    window.demoNotify();
  });
  await expect(dialog.getByRole("alert")).toContainText("central record changed");
  await expect(dialog.getByRole("button", { name: "Use central state" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Import device state" })).toBeDisabled();
  await expect(dialog.locator('[data-field="display_name"]')).toContainText("Dana Cohen");
  await dialog.getByRole("button", { name: "Read comparison again" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.locator('[data-field="display_name"]')).toContainText(
    "Edited in another session",
  );
  page.once("dialog", (popup) => popup.accept());
  await dialog.getByRole("button", { name: "Use central state" }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("conflicts/resolve")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    revision: 2,
    review_token: "synthetic-review",
    direction: "central",
    user_id: "person-1",
    station_id: "station-2",
  });
});

test("unsupported device schedule explains and disables both resolution actions", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      const result = await original(message);
      if (message.type.endsWith("conflicts/review")) {
        result.device.schedule_configured = true;
        for (const action of ["central", "device"])
          result.actions[action] = { allowed: false, reason: "schedule_unverified" };
      }
      return result;
    };
  });
  const dialog = await openReview(page);
  await expect(dialog.getByRole("button", { name: "Use central state" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Import device state" })).toBeDisabled();
  await expect(dialog.locator(".notice.error")).toHaveCount(2);
  await expect(dialog.locator('[data-field="schedule"]')).toContainText("Configured");
});

test("rejected stale device review stays open for a fresh read and does not retry", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("conflicts/resolve")) {
        window.calls.push(message);
        throw { code: "review_stale" };
      }
      return original(message);
    };
  });
  const dialog = await openReview(page);
  page.once("dialog", (popup) => popup.accept());
  await dialog.getByRole("button", { name: "Import device state" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Read comparison again" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Import device state" })).toBeDisabled();
  const calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("conflicts/resolve")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].revision).toBe(1);
});

test("Hebrew mobile review keeps comparison and resolution controls accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await navigate(page, "סנכרון");
  await page.getByRole("button", { name: "התנגשות", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "יעדי הסנכרון" })).toBeVisible();
  await expect(dialog.locator(".review-field")).toHaveCount(10);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await expect(dialog.getByRole("button", { name: "שימוש במצב המרכזי" })).toBeEnabled();
  await page.screenshot({ path: "test-results/review-he-mobile.png", fullPage: true });
});

test("unverified PIN readback is never labelled as matching", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      const result = await original(message);
      if (message.type.endsWith("conflicts/review")) {
        result.unverified_fields = ["pin"];
        result.differences = ["display_name"];
        result.device.pin_configured = null;
        result.central.pin_configured = null;
        for (const action of ["central", "device"])
          result.actions[action] = { allowed: false, reason: "pin_device_managed" };
      }
      return result;
    };
  });
  const dialog = await openReview(page);
  await expect(dialog.locator('[data-field="pin"]')).toContainText("Unverified");
  await expect(dialog.locator('[data-field="pin"]')).not.toContainText("Matches");
});

const csvImport =
  'employee_no,display_name,pin,cards,stations\r\n9001,CSV Resident,735291,"[""000012345678""]","{""station-0"":true}"\r\n';

async function uploadCsv(page, contents = csvImport) {
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("CSV file")
    .setInputFiles({ name: "residents.csv", mimeType: "text/csv", buffer: Buffer.from(contents) });
  await expect(dialog.getByText("residents.csv", { exact: true })).toBeVisible();
  return dialog;
}

test("CSV requires preview and explicit confirmation while keeping credentials out of the DOM", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await uploadCsv(page);
  await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Preview changes" }).click();
  await expect(dialog.getByText("CSV Resident", { exact: true })).toBeVisible();
  expect(await dialog.textContent()).not.toContain("735291");
  expect(await dialog.textContent()).not.toContain("000012345678");
  page.once("dialog", (popup) => popup.dismiss());
  await dialog.getByRole("button", { name: "Apply & sync batch" }).click();
  expect(
    await page.evaluate(() => window.calls.some((item) => item.type.endsWith("users/csv_apply"))),
  ).toBeFalsy();
  page.once("dialog", (popup) => popup.accept());
  await dialog.getByRole("button", { name: "Apply & sync batch" }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() =>
    window.calls.filter((item) => item.type.endsWith("users/csv_apply")),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    csv: csvImport,
    mode: "create",
    review_token: "synthetic-csv-review",
  });
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Preview changes" }),
  ).toBeDisabled();
});

test("CSV mode changes invalidate preview and server errors prevent partial confirmation", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await uploadCsv(page);
  await dialog.getByRole("button", { name: "Preview changes" }).click();
  await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeEnabled();
  await dialog.getByLabel("Import mode").selectOption("upsert");
  await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeDisabled();
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      const result = await original(message);
      if (message.type.endsWith("users/csv_preview")) {
        result.errors = [{ line: 3, code: "pin_conflict" }];
        result.review_token = null;
      }
      return result;
    };
  });
  await dialog.getByRole("button", { name: "Preview changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Line 3");
  await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeDisabled();
});

test("CSV stale apply requires another preview and never automatically retries", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("users/csv_apply")) {
        window.calls.push(message);
        throw { code: "review_stale" };
      }
      return original(message);
    };
  });
  const dialog = await uploadCsv(page);
  await dialog.getByRole("button", { name: "Preview changes" }).click();
  page.once("dialog", (popup) => popup.accept());
  await dialog.getByRole("button", { name: "Apply & sync batch" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.calls.filter((item) => item.type.endsWith("users/csv_apply")).length,
    ),
  ).toBe(1);
});

test("CSV export downloads credential-free content and template", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export users CSV" }).click();
  const download = await exported;
  expect(download.suggestedFilename()).toBe("hikvision-users.csv");
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("CSV Resident");
  expect(text).not.toContain("pin");
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const template = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download blank template" }).click();
  const file = await template;
  expect(await readFile((await file.path())!, "utf8")).toContain("employee_no,display_name");
});

test("activity report covers retained matches and export uses applied filters", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const events = page.locator("hikvision-intercom-events");
  await events.getByLabel("Result", { exact: true }).selectOption("denied");
  await events.getByRole("button", { name: "Apply filters", exact: true }).click();
  await events.getByRole("button", { name: "Generate report" }).click();
  const report = events.locator(".activity-report");
  await expect(report).toContainText("260");
  await expect(report).toContainText("200");
  await report.getByText("Daily breakdown", { exact: true }).click();
  await expect(report).toContainText("UTC");
  const downloadEvent = page.waitForEvent("download");
  await events.getByRole("button", { name: "Export filtered events CSV" }).click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, "utf8")).toContain("•••• 3210");
  const call = await page.evaluate(() =>
    window.calls.findLast((item) => item.type.endsWith("events/export")),
  );
  expect(call.filters).toEqual({ result: "denied" });
  await events.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(report).toHaveCount(0);
});

test("late report export is discarded when filters change", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      const result = await original(message);
      if (message.type.endsWith("events/export"))
        return new Promise((resolve) => {
          window.finishExport = () => resolve(result);
        });
      return result;
    };
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  const events = page.locator("hikvision-intercom-events");
  await events.getByRole("button", { name: "Export filtered events CSV" }).click();
  await events.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.evaluate(() => window.finishExport());
  await expect(events.locator(".activity-report")).toHaveCount(0);
  expect(downloads).toBe(0);
});

test("Hebrew mobile CSV preview and activity reports fit the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "משתמשים", exact: true }).click();
  await page.getByRole("button", { name: "ייבוא CSV", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("קובץ CSV")
    .setInputFiles({ name: "demo.csv", mimeType: "text/csv", buffer: Buffer.from(csvImport) });
  await dialog.getByRole("button", { name: "תצוגה מקדימה", exact: true }).click();
  await expect(dialog.getByText("CSV Resident", { exact: true })).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await page.screenshot({ path: "test-results/csv-he-mobile.png", fullPage: true });
  await dialog.getByRole("button", { name: "סגירה", exact: true }).click();
  await page.getByRole("button", { name: "אירועים", exact: true }).click();
  await page.getByRole("button", { name: "הפקת דוח", exact: true }).click();
  await expect(page.locator(".activity-report")).toContainText("260");
  expect(
    await page
      .locator("hikvision-intercom-panel")
      .evaluate((el) => el.shadowRoot.querySelector("main").scrollWidth <= 390),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/report-he-mobile.png", fullPage: true });
});

async function openReaderCapture(page) {
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Read card from station", exact: true })
    .click();
  return page.getByRole("dialog");
}

test("reader capture requires explicit approval and never receives a full card number", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openReaderCapture(page);
  await expect(dialog.getByLabel("Reader", { exact: true })).toHaveValue("0");
  await dialog.getByRole("button", { name: "Start card collection", exact: true }).click();
  await expect(dialog.getByText("•••• 7788", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("capture_confirm"))),
  ).toBeFalsy();
  await dialog.getByLabel("Card label", { exact: true }).fill("Reader card");
  page.once("dialog", (prompt) => prompt.dismiss());
  await dialog.getByRole("button", { name: "Add card & sync", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("capture_confirm"))),
  ).toBeFalsy();
  page.once("dialog", (prompt) => prompt.accept());
  await dialog.getByRole("button", { name: "Add card & sync", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const writes = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("capture_confirm")),
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ label: "Reader card", session_id: "synthetic-capture-0" });
  expect(JSON.stringify(writes)).not.toContain("card_no");
});

test("unsupported reader capability disables collection without starting it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    const call = panel.hass.callWS.bind(panel.hass);
    panel.hass.callWS = (message) =>
      message.type.endsWith("reader_capabilities")
        ? Promise.reject({ code: "capture_unsupported" })
        : call(message);
  });
  const dialog = await openReaderCapture(page);
  await expect(dialog.getByRole("alert")).toContainText("does not advertise");
  await expect(
    dialog.getByRole("button", { name: "Start card collection", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("capture_start"))),
  ).toBeFalsy();
});

test("closing a reader capture cancels waiting and ignores late status", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    const call = panel.hass.callWS.bind(panel.hass);
    panel.hass.callWS = (message) =>
      message.type.endsWith("capture_status")
        ? new Promise((resolve) => {
            window.captureResolve = resolve;
          })
        : call(message);
  });
  const dialog = await openReaderCapture(page);
  await dialog.getByRole("button", { name: "Start card collection", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.captureResolve)).toBeTruthy();
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.filter((c) => c.type.endsWith("capture_cancel")).length),
    )
    .toBe(1);
  await page.evaluate(() =>
    window.captureResolve({ state: "captured", card: { masked_number: "•••• 7788" }, error: null }),
  );
  await expect(page.getByText("•••• 7788", { exact: true })).toHaveCount(0);
});

test("late capture start after dialog close is cancelled", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    const call = panel.hass.callWS.bind(panel.hass);
    panel.hass.callWS = (message) =>
      message.type.endsWith("capture_start")
        ? new Promise((resolve) => {
            window.captureResolve = resolve;
          })
        : call(message);
  });
  const dialog = await openReaderCapture(page);
  await dialog.getByRole("button", { name: "Start card collection", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.captureResolve)).toBeTruthy();
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.evaluate(() => window.captureResolve({ session_id: "late-session" }));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.calls.filter(
            (c) => c.type.endsWith("capture_cancel") && c.session_id === "late-session",
          ).length,
      ),
    )
    .toBe(1);
});

test("concurrent user change prevents captured-card approval", async ({ page }) => {
  await page.goto("/");
  const dialog = await openReaderCapture(page);
  await dialog.getByRole("button", { name: "Start card collection", exact: true }).click();
  await expect(dialog.getByText("•••• 7788", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.demoData.users[0].revision++;
    window.demoNotify();
  });
  await expect(dialog.getByRole("alert")).toContainText("changed or was deleted");
  await expect(dialog.getByRole("button", { name: "Add card & sync", exact: true })).toBeDisabled();
});

test("Hebrew mobile reader capture displays masked preview and confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "משתמשים", exact: true }).click();
  await page.getByRole("button", { name: "עריכה", exact: true }).last().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "קריאת כרטיס מהאינטרקום", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "התחלת קריאת כרטיס", exact: true }).click();
  await expect(dialog.getByText("•••• 7788", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "הוספת הכרטיס וסנכרון", exact: true }),
  ).toBeVisible();
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/reader-capture-he-mobile.png", fullPage: true });
});

test("reader approval with an uncertain response never claims nothing was saved or retries", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openReaderCapture(page);
  await dialog.getByRole("button", { name: "Start card collection", exact: true }).click();
  await expect(dialog.getByText("•••• 7788", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    const call = panel.hass.callWS.bind(panel.hass);
    panel.hass.callWS = async (message) => {
      const result = await call(message);
      if (message.type.endsWith("capture_confirm")) throw { code: "connection_lost" };
      return result;
    };
  });
  page.once("dialog", (prompt) => prompt.accept());
  await dialog.getByRole("button", { name: "Add card & sync", exact: true }).click();
  await expect(dialog.getByText(/save result is unconfirmed/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add card & sync", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("capture_confirm")).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      window.demoData.users[0].cards.some((card) => card.id === "captured-card"),
    ),
  ).toBeTruthy();
});

test("a lost release reply exits pending as unconfirmed and ignores late acknowledgement", async ({
  page,
}) => {
  await page.goto("/");
  await page.clock.install();
  await holdReleaseResponses(page);
  const first = page.locator("article.station").first();
  await first.getByRole("button", { name: "Open active lock", exact: true }).click();
  await page.clock.fastForward(31000);
  await expect(first.locator(".release-feedback")).toContainText("Release was not confirmed");
  await expect(first.getByRole("button", { name: "Open active lock", exact: true })).toBeEnabled();
  await page.evaluate(() => window.finishRelease("station-0"));
  await expect(first.locator(".release-feedback")).toContainText("Release was not confirmed");
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("stations/test_unlock")).length,
    ),
  ).toBe(1);
});

test("a lost overview reply cannot block later updates and cannot replace newer data", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("article.station")).toHaveCount(9);
  await page.clock.install();
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    let once = true;
    window.demoHass.callWS = function (message) {
      if (message.type.endsWith("overview") && once) {
        once = false;
        return new Promise((resolve) => (window.lateOverview = resolve));
      }
      return original.call(this, message);
    };
    void document.querySelector("hikvision-intercom-panel").refresh();
  });
  await page.clock.fastForward(21000);
  await expect(
    page.getByRole("status").filter({ hasText: "Displayed data may be out of date" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.demoData.stations[0].name = "Recovered overview";
    window.demoNotify();
  });
  await expect(page.getByRole("heading", { name: "Recovered overview" })).toBeVisible();
  await page.evaluate(() =>
    window.lateOverview({ ...structuredClone(window.demoData), stations: [] }),
  );
  await expect(page.locator("article.station")).toHaveCount(9);
  await expect(page.getByText("Displayed data may be out of date", { exact: false })).toHaveCount(
    0,
  );
});

test("HA disconnect marks an in-flight release uncertain and reconnect refreshes without replay", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("article.station")).toHaveCount(9);
  await page.evaluate(() => {
    const listeners = new Map();
    window.panelConnectionListeners = listeners;
    window.demoHass.connection = {
      ...window.demoHass.connection,
      connected: true,
      addEventListener(name, callback) {
        const group = listeners.get(name) ?? new Set();
        group.add(callback);
        listeners.set(name, group);
      },
      removeEventListener(name, callback) {
        listeners.get(name)?.delete(callback);
      },
    };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  await holdReleaseResponses(page);
  await page.evaluate(() => {
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  });
  const first = page.locator("article.station").first();
  await first.getByRole("button", { name: "Open active lock", exact: true }).click();
  await page.evaluate(() => {
    window.demoHass.connection.connected = false;
    for (const callback of window.panelConnectionListeners.get("disconnected")) callback();
  });
  await expect(page.getByText("Home Assistant is disconnected.", { exact: false })).toBeVisible();
  await expect(first.locator(".release-feedback")).toContainText("Release was not confirmed");
  await expect(first.getByRole("button", { name: "Open active lock", exact: true })).toBeDisabled();
  await expect(
    page
      .locator("article.station")
      .nth(1)
      .getByRole("button", { name: "Open active lock", exact: true }),
  ).toBeDisabled();
  await page.evaluate(async () => {
    // Even a direct handler invocation must not queue a release for reconnect.
    await document.querySelector("hikvision-intercom-panel").unlock(window.demoData.stations[1]);
    window.finishRelease("station-0");
    window.demoData.stations[0].name = "Fresh after HA reconnect";
    window.demoHass.connection.connected = true;
    for (const callback of window.panelConnectionListeners.get("ready")) callback();
  });
  await expect(page.getByRole("heading", { name: "Fresh after HA reconnect" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Open active lock", exact: true })).toBeEnabled();
  await expect(first.locator(".release-feedback")).toContainText("Release was not confirmed");
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type.endsWith("stations/test_unlock")).length,
    ),
  ).toBe(1);
});

test("initial data timeout shows a retry hint and allows loading again", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("article.station")).toHaveCount(9);
  await page.clock.install();
  await page.evaluate(() => {
    const original = window.demoHass.callWS;
    window.demoHass.callWS = function (message) {
      if (message.type.endsWith("overview")) {
        window.demoHass.callWS = original;
        return new Promise(() => {});
      }
      return original.call(this, message);
    };
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.remove();
    document.body.append(panel);
  });
  await page.clock.fastForward(21000);
  await expect(
    page.getByText("Integration data could not be loaded.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Use Refresh after the connection returns.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator("article.station")).toHaveCount(9);
});
