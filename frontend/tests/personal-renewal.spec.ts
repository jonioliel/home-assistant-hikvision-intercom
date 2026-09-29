import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, linked = true) {
  await page.goto("/");
  await page.evaluate((linked) => {
    const w = window as any;
    document.querySelector("hikvision-intercom-panel")?.remove();
    w.personalData = {
      linked,
      name: "Personal user",
      revision: 2,
      active: true,
      valid_from: "2030-01-01T00:00:00Z",
      valid_until: "2035-01-01T00:00:00Z",
      can_request: true,
      requests: [],
      timezone: "Asia/Jerusalem",
    };
    w.personalCalls = [];
    w.personalHass = {
      ...w.demoHass,
      user: { id: "personal", is_admin: false },
      language: "en",
      callWS: async (message: any) => {
        w.personalCalls.push(structuredClone(message));
        if (message.type.endsWith("renewal/request")) {
          w.personalData.requests = [
            {
              id: "request-one",
              state: "pending",
              reason: message.reason,
              until: message.until,
              created_at: "2030-01-01T00:00:00Z",
            },
          ];
          if (w.loseAck) throw { code: "connection_lost" };
        }
        if (message.type.endsWith("renewal/cancel")) w.personalData.requests[0].state = "cancelled";
        return structuredClone(w.personalData);
      },
    };
    const panel = document.createElement("wiskey-renewal-panel") as any;
    panel.hass = w.personalHass;
    document.body.append(panel);
  }, linked);
  return page.locator("wiskey-renewal-panel");
}
test("personal form shows only own expiry and converts the facility timezone", async ({ page }) => {
  const portal = await setup(page);
  await expect(portal).toContainText("Personal user");
  await portal.getByLabel("Requested expiry", { exact: true }).fill("2036-01-01T12:00");
  await portal.getByLabel("Reason", { exact: true }).fill("Continue work");
  await expect(portal.getByRole("button", { name: "Send request", exact: true })).toBeDisabled();
  await portal.getByRole("checkbox").check();
  await portal.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(portal).toContainText("Awaiting approval");
  const sent = await page.evaluate(() =>
    (window as any).personalCalls.find((m: any) => m.type.endsWith("renewal/request")),
  );
  expect(sent.until).toBe("2036-01-01T10:00:00.000Z");
  expect(sent.api_contract).toBe(1);
  expect(sent).not.toHaveProperty("user_id");
  expect(sent).not.toHaveProperty("actor");
  page.once("dialog", (d) => d.accept());
  await portal.getByRole("button", { name: "Cancel request" }).click();
  await expect(portal).toContainText("Cancelled");
});
test("lost acknowledgement never retries automatically and refresh discovers saved request", async ({
  page,
}) => {
  const portal = await setup(page);
  await page.evaluate(() => {
    (window as any).loseAck = true;
  });
  await portal.getByLabel("Requested expiry", { exact: true }).fill("2036-01-01T12:00");
  await portal.getByLabel("Reason", { exact: true }).fill("Continue work");
  await portal.getByRole("checkbox").check();
  await portal.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(portal.getByRole("alert")).toBeVisible();
  await expect(portal.getByRole("button", { name: "Send request", exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).personalCalls.filter((m: any) => m.type.endsWith("renewal/request")).length,
    ),
  ).toBe(1);
  await portal.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(portal).toContainText("Awaiting approval");
  await expect(portal.getByRole("button", { name: "Send request", exact: true })).toHaveCount(0);
});
test("changing account clears private data and an unlinked account sees no previous name", async ({
  page,
}) => {
  const portal = await setup(page);
  await expect(portal).toContainText("Personal user");
  await portal.getByLabel("Reason", { exact: true }).fill("Private draft");
  await page.evaluate(() => {
    const panel = document.querySelector("wiskey-renewal-panel") as any;
    panel.hass = {
      ...(window as any).personalHass,
      user: { id: "another", is_admin: false },
      callWS: async () => ({ linked: false, timezone: "UTC" }),
    };
  });
  await expect(portal).toContainText("Account not linked");
  await expect(portal).not.toContainText("Personal user");
  await expect(portal.getByRole("textbox")).toHaveCount(0);
});
test("mobile personal renewal remains inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const portal = await setup(page);
  await expect(portal).toContainText("Personal user");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test("admin mapping requires explicit confirmation and exposes the personal route", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    document.querySelector("hikvision-intercom-panel")?.remove();
    w.bindingCalls = [];
    const data = {
      revision: 0,
      bindings: {},
      directory: [{ id: "personal", name: "Personal account", active: true }],
    };
    const widget = document.createElement("wiskey-renewal-bindings") as any;
    widget.hass = {
      ...w.demoHass,
      callWS: async (message: any) => {
        w.bindingCalls.push(message);
        if (message.type.endsWith("users/query"))
          return {
            records: [{ id: "person-one", display_name: "Person one", employee_no: "1000" }],
            total: 1,
            snapshot: "one",
            next_offset: null,
            previous_offset: null,
          };
        if (message.type.endsWith("binding_update")) {
          data.revision++;
          (data.bindings as any).personal = {
            user_id: "person-one",
            name: "Person one",
            available: true,
          };
        }
        return structuredClone(data);
      },
    };
    document.body.append(widget);
  });
  const widget = page.locator("wiskey-renewal-bindings");
  await expect(widget.getByRole("link")).toHaveAttribute("href", "/wiskey-renewal");
  await widget.getByLabel("Personal account", { exact: true }).selectOption("personal");
  await widget.getByRole("button", { name: "Search", exact: true }).click();
  await widget.getByLabel("Access record", { exact: true }).selectOption("person-one");
  page.once("dialog", (d) => d.dismiss());
  await widget.getByRole("button", { name: "Save mapping", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).bindingCalls.filter((m: any) => m.type.endsWith("binding_update")).length,
    ),
  ).toBe(0);
  page.once("dialog", (d) => d.accept());
  await widget.getByRole("button", { name: "Save mapping", exact: true }).click();
  await expect(widget).toContainText("Mapping saved.");
  expect(
    await page.evaluate(
      () =>
        (window as any).bindingCalls.find((m: any) => m.type.endsWith("binding_update")).confirmed,
    ),
  ).toBe(true);
});

test("main panel gives an ungranted personal account only its renewal screen", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    document.querySelector("wiskey-renewal-panel")?.remove();
    const base = w.personalHass.callWS;
    const hass = {
      ...w.personalHass,
      callWS: async (message: any) => {
        if (message.type.endsWith("authorization/session"))
          return {
            allowed: false,
            is_admin: false,
            personal_renewal: true,
            revision: 0,
            areas: {
              overview: "none",
              users: "none",
              events: "none",
              stations: "none",
              management: "none",
            },
          };
        return base(message);
      },
    };
    w.personalCalls = [];
    const panel = document.createElement("hikvision-intercom-panel") as any;
    panel.hass = hass;
    document.body.append(panel);
  });
  const main = page.locator("hikvision-intercom-panel");
  await expect(main.locator("wiskey-personal-renewal")).toContainText("Personal user");
  expect(
    await page.evaluate(() =>
      (window as any).personalCalls.some(
        (m: any) =>
          m.type.endsWith("overview") ||
          m.type.endsWith("users/list") ||
          m.type.endsWith("subscribe"),
      ),
    ),
  ).toBe(false);
  await expect(main.getByRole("button", { name: "Users", exact: true })).toHaveCount(0);
});
