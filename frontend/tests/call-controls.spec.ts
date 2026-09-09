import { test, expect } from "@playwright/test";

test("camera exposes state-gated commands and requires refresh after uncertain delivery", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("media/signal")) {
        window.calls.push(message);
        return {
          command: message.command,
          acknowledged: null,
          physical_result: "unverified",
          observation: "state_changed",
          observed_state: "idle",
          checked_at: new Date().toISOString(),
        };
      }
      return base(message);
    };
  });
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const controls = page.getByRole("dialog").locator("hikvision-intercom-call-controls");
  await expect(controls.getByRole("button", { name: "Hang up signal" })).toBeDisabled();
  await controls.getByRole("button", { name: "Reject signal" }).click();
  await expect(controls).toContainText("Command delivery is uncertain");
  await expect(controls).toContainText("Observed state: Idle");
  await expect(controls.getByRole("button", { name: "Reject signal" })).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/signal")).length),
  ).toBe(1);
});

test("pending call only blocks its station and is released after closing camera", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("media/signal")) {
        window.calls.push(message);
        return await new Promise(
          (resolve) =>
            (window.finishCall = () =>
              resolve({
                command: message.command,
                acknowledged: true,
                physical_result: "unverified",
                observation: "unchanged",
                observed_state: "ringing",
                checked_at: new Date().toISOString(),
              })),
        );
      }
      return base(message);
    };
  });
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Reject signal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  const overview = page.locator(".station");
  await expect(overview.first().getByRole("button", { name: "Reject signal" })).toBeDisabled();
  await expect(overview.nth(1).getByRole("button", { name: /Open/ })).toBeEnabled();
  await page.evaluate(() => window.finishCall());
  await expect(overview.first().getByRole("button", { name: "Reject signal" })).toBeEnabled();
});

test("losing administrator status during a call read does not reveal late results", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) =>
      message.type.endsWith("media/call")
        ? await new Promise(
            (resolve) =>
              (window.finishContext = () =>
                resolve({
                  call_commands: ["answer"],
                  state: "ringing",
                  checked_at: new Date().toISOString(),
                  busy: false,
                  last_result: null,
                })),
          )
        : base(message);
  });
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  await page.evaluate(() => {
    document.querySelector("hikvision-intercom-panel").hass = {
      ...window.demoHass,
      user: { is_admin: false },
    };
    window.finishContext?.();
  });
  await expect(page.getByRole("button", { name: "Answer signal" })).toHaveCount(0);
});
