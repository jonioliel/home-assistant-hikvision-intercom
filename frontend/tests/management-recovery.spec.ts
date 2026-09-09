import { test, expect, type Page } from "@playwright/test";

async function hold(page: Page, command: string) {
  await page.evaluate((command) => {
    const original = window.demoHass.callWS;
    window.demoHass.callWS = function (message) {
      if (message.type === "hikvision_intercom/" + command) {
        window.calls.push(message);
        return new Promise((resolve) => {
          window.lateManagement = resolve;
        });
      }
      return original.call(this, message);
    };
    document.querySelector("hikvision-intercom-panel").hass = { ...window.demoHass };
  }, command);
}

async function submit(page: Page) {
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Pending resident");
  await dialog.getByLabel("New PIN", { exact: true }).fill("847291");
  await dialog.getByLabel("Confirm PIN", { exact: true }).fill("847291");
  await dialog.getByRole("button", { name: "Save & sync" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.lateManagement)).toBe("function");
}

test("a missing user save result closes the sensitive draft without replaying the change", async ({
  page,
}) => {
  await page.goto("/");
  await hold(page, "users/create");
  await page.clock.install();
  await submit(page);
  await page.clock.fastForward(61000);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("The change may have been saved");
  await expect(page.getByRole("button", { name: "+ Add user", exact: true })).toBeEnabled();
  await page.evaluate(() => window.lateManagement({ id: "late-user" }));
  await expect(page.getByRole("alert")).toContainText("The change may have been saved");
  const result = await page.evaluate(() => ({
    requests: window.calls.filter((c) => c.type.endsWith("users/create")).length,
    draft: document.querySelector("hikvision-intercom-panel")._draft,
  }));
  expect(result.requests).toBe(1);
  expect(result.draft).toBeUndefined();
});

test("logout abandons a pending inventory read and discards late private results", async ({
  page,
}) => {
  await page.goto("/");
  await hold(page, "stations/inventory");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "Import existing", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.lateManagement)).toBe("function");
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.hass = { ...window.demoHass, user: { is_admin: false } };
  });
  await expect
    .poll(() => page.evaluate(() => document.querySelector("hikvision-intercom-panel")._busy))
    .toBe(false);
  await page.evaluate(() =>
    window.lateManagement([{ employee_no: "PRIVATE-LATE", display_name: "Private resident" }]),
  );
  expect(
    await page.evaluate(() => document.querySelector("hikvision-intercom-panel")._importRows),
  ).toEqual([]);
});

test("returning to the panel during an old save permits new work and ignores its late success", async ({
  page,
}) => {
  await page.goto("/");
  await hold(page, "users/create");
  await submit(page);
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel");
    panel.remove();
    document.body.append(panel);
  });
  await expect(page.getByRole("button", { name: "+ Add user", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "+ Add user", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Next draft");
  await page.evaluate(() => window.lateManagement({ id: "old-result" }));
  await expect(page.getByRole("dialog").getByLabel("Name", { exact: true })).toHaveValue(
    "Next draft",
  );
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/create")).length),
  ).toBe(1);
});

test("disconnect during a user save releases the form immediately and never resends on reconnect", async ({
  page,
}) => {
  await page.goto("/");
  await hold(page, "users/create");
  await submit(page);
  await page.evaluate(() => {
    window.demoHass.connection.connected = false;
    document.querySelector("hikvision-intercom-panel").haDisconnected();
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("The change may have been saved");
  await page.evaluate(() => {
    window.demoHass.connection.connected = true;
    document.querySelector("hikvision-intercom-panel").haReady();
    window.lateManagement({ id: "saved-before-disconnect" });
  });
  await expect(page.getByRole("alert")).toContainText("The change may have been saved");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/create")).length),
  ).toBe(1);
});
