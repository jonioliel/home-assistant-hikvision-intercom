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

test("switching station during a slow call read cannot leave the next station loading", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const controls = page.getByRole("dialog").locator("hikvision-intercom-call-controls");
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeEnabled();
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (
        message.type.endsWith("media/call") &&
        message.station_id === window.demoData.stations[0].id
      )
        return await new Promise((resolve) => (window.lateRead = resolve));
      return base(message);
    };
  });
  await controls.getByRole("button", { name: "Refresh call state" }).click();
  await controls.evaluate((node: any) => {
    node.station = structuredClone(window.demoData.stations[1]);
  });
  await expect(controls.getByRole("button", { name: "Refresh call state" })).toBeEnabled();
  await page.evaluate(() =>
    window.lateRead({
      call_commands: ["answer"],
      state: "ringing",
      last_result: null,
      busy: false,
    }),
  );
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeDisabled();
});

test("a lost call read becomes retryable and cannot overwrite a newer result", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const controls = page.getByRole("dialog").locator("hikvision-intercom-call-controls");
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeEnabled();
  await page.clock.install();
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    let first = true;
    window.demoHass.callWS = async (message) => {
      if (first && message.type.endsWith("media/call")) {
        first = false;
        return await new Promise((resolve) => (window.lateRead = resolve));
      }
      return base(message);
    };
  });
  await controls.getByRole("button", { name: "Refresh call state" }).click();
  await page.clock.fastForward(21000);
  await expect(controls).toContainText("Call capabilities or state could not be read");
  await controls.getByRole("button", { name: "Refresh call state" }).click();
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeEnabled();
  await page.evaluate(() =>
    window.lateRead({ call_commands: [], state: "idle", last_result: null, busy: false }),
  );
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeEnabled();
});

test("a lost call signal releases the station controls with an uncertain result and no replay", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const controls = page.getByRole("dialog").locator("hikvision-intercom-call-controls");
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeEnabled();
  await page.clock.install();
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("media/signal")) {
        window.calls.push(message);
        return await new Promise((resolve) => (window.lateSignal = resolve));
      }
      return base(message);
    };
  });
  await controls.getByRole("button", { name: "Answer signal" }).click();
  await page.clock.fastForward(41000);
  await expect(controls).toContainText("Command result could not be verified");
  await expect(controls.getByRole("button", { name: "Refresh call state" })).toBeEnabled();
  await expect(controls.getByRole("button", { name: "Answer signal" })).toHaveCount(0);
  await page.evaluate(() =>
    window.lateSignal({
      acknowledged: true,
      observed_state: "in_call",
      observation: "state_changed",
      checked_at: new Date().toISOString(),
    }),
  );
  await expect(controls).toContainText("Command result could not be verified");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/signal")).length),
  ).toBe(1);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.locator(".station").first().getByRole("button", { name: "Answer signal" }),
  ).toBeEnabled();
});

test("HA disconnect invalidates a pending signal and reconnect requires a fresh state read", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.callListeners = new Map();
    window.demoHass.connection.connected = true;
    window.demoHass.connection.addEventListener = (name, callback) => {
      const listeners = window.callListeners.get(name) ?? new Set();
      listeners.add(callback);
      window.callListeners.set(name, listeners);
    };
    window.demoHass.connection.removeEventListener = (name, callback) =>
      window.callListeners.get(name)?.delete(callback);
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type.endsWith("media/signal")) {
        window.calls.push(message);
        return await new Promise((resolve) => (window.lateSignal = resolve));
      }
      return base(message);
    };
  });
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const controls = page.getByRole("dialog").locator("hikvision-intercom-call-controls");
  await controls.getByRole("button", { name: "Answer signal" }).click();
  await page.evaluate(() => {
    window.demoHass.connection.connected = false;
    for (const callback of window.callListeners.get("disconnected")) callback();
  });
  await expect(controls).toContainText("Call controls are paused until Home Assistant reconnects");
  await expect(controls.getByRole("button", { name: "Refresh call state" })).toBeDisabled();
  await page.evaluate(() => {
    window.lateSignal({
      acknowledged: true,
      observed_state: "in_call",
      observation: "state_changed",
      checked_at: new Date().toISOString(),
    });
    window.demoHass.connection.connected = true;
    for (const callback of window.callListeners.get("ready")) callback();
  });
  await expect(controls).toContainText("Command result could not be verified");
  await expect(controls.getByRole("button", { name: "Answer signal" })).toHaveCount(0);
  await controls.getByRole("button", { name: "Refresh call state" }).click();
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeEnabled();
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("media/signal")).length),
  ).toBe(1);
});

test("a call completed in another view refreshes the overview's stale command state", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const controls = page.getByRole("dialog").locator("hikvision-intercom-call-controls");
  await expect(controls.getByRole("button", { name: "Answer signal" })).toBeEnabled();
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      const result = await base(message);
      return message.type.endsWith("media/call") ? { ...result, state: "idle" } : result;
    };
  });
  await controls.getByRole("button", { name: "Answer signal" }).click();
  await expect(controls).toContainText("Command acknowledged");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  // The overview has not received its regular status refresh yet. Its old ring
  // buttons must not remain usable after a newer direct read says idle.
  await expect(
    page.locator(".station").first().getByRole("button", { name: "Answer signal" }),
  ).toBeDisabled();
});
