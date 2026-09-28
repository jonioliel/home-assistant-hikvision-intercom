import { test, expect } from "@playwright/test";
async function setup(page, lang = "en") {
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto("/?lang=" + lang);
  await page.evaluate(() => {
    const flows = new Map();
    let sequence = 0;
    window.flowCalls = [];
    window.demoHass.callApi = async (method, path, values) => {
      window.flowCalls.push({ method, path, values });
      if (method === "DELETE") return { type: "abort" };
      if (path.endsWith("/flow")) {
        const id = "flow-" + ++sequence;
        flows.set(id, { step: "user" });
        return { type: "form", flow_id: id, step_id: "user", data_schema: [] };
      }
      const id = path.split("/").pop();
      const row = flows.get(id);
      const result = (step, data_schema = [], extra = {}) => ({
        type: "form",
        flow_id: id,
        step_id: step,
        data_schema,
        ...extra,
      });
      if (row.step === "user") {
        row.host = values.host;
        if (row.host === "offline") return { type: "abort", reason: "cannot_connect" };
        row.step = "confirm_device";
        return result("confirm_device", [], {
          description_placeholders: {
            model: "DS-KV6124-E1",
            serial: "MOCK-" + id,
            firmware: "V3.9.0",
          },
        });
      }
      if (row.step === "confirm_device") {
        row.step = "locks";
        return result("locks", [
          { name: "mode", selector: { select: { options: ["camera_only", "map_active_relay"] } } },
          { name: "lock_name", type: "string" },
        ]);
      }
      if (row.step === "locks") {
        if (values.mode === "camera_only")
          return { type: "create_entry", result: { entry_id: "installed-" + id } };
        row.step = "mapping";
        return result("mapping", [
          {
            name: "api_id",
            type: "select",
            options: [
              [1, "1"],
              [2, "2"],
            ],
          },
          { name: "test_unlock", type: "boolean", default: false },
        ]);
      }
      if (row.step === "mapping") {
        if (values.test_unlock !== true) throw { code: "test_required" };
        row.step = "confirm_mapping";
        return result("confirm_mapping", [
          {
            name: "result",
            selector: {
              select: { options: ["released_and_returned", "choose_again", "camera_only"] },
            },
          },
        ]);
      }
      if (row.step === "confirm_mapping") {
        if (values.result !== "released_and_returned")
          throw { code: "physical_confirmation_required" };
        return { type: "create_entry" };
      }
      throw { code: "unexpected_step" };
    };
    const node = document.createElement("wiskey-station-onboarding");
    node.hass = { ...window.demoHass };
    document.body.append(node);
  });
  const node = page.locator("wiskey-station-onboarding");
  await node.locator("summary").click();
  return node;
}
test("sequence preserves native identity and physical confirmation; one failure does not block the next row", async ({
  page,
}) => {
  const node = await setup(page);
  await node
    .locator("textarea")
    .fill("offline | Disconnected\n192.0.2.11 | Lobby\n192.0.2.12 | Office");
  await node.getByRole("button", { name: "Validate first station", exact: true }).click();
  await expect(node).toContainText("Needs attention");
  await node.getByRole("button", { name: "Next station", exact: true }).click();
  await expect(node).toContainText("MOCK-flow-2");
  await node.getByRole("button", { name: "Continue this station", exact: true }).click();
  await node.getByLabel("Station management", { exact: true }).selectOption("map_active_relay");
  await node.getByRole("button", { name: "Continue this station", exact: true }).click();
  const testButton = node.getByRole("button", { name: "Run authorized relay test", exact: true });
  await expect(testButton).toBeDisabled();
  expect(await page.evaluate(() => window.flowCalls.some((c) => c.values?.test_unlock))).toBe(
    false,
  );
  await node.getByLabel("API relay", { exact: true }).selectOption("1");
  await node.getByLabel("I am at the door and authorize a relay test", { exact: true }).check();
  await testButton.click();
  await expect(node.getByLabel("Observed physical result", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.flowCalls.filter((c) => c.values?.test_unlock === true).length,
    ),
  ).toBe(1);
  await node
    .getByLabel("Observed physical result", { exact: true })
    .selectOption("released_and_returned");
  await node.getByRole("button", { name: "Continue this station", exact: true }).click();
  await expect(node).toContainText("Added");
  await node.getByRole("button", { name: "Next station", exact: true }).click();
  await node.getByRole("button", { name: "Continue this station", exact: true }).click();
  await node.getByRole("button", { name: "Continue this station", exact: true }).click();
  await expect(node).toContainText("Sequence finished");
  expect(await node.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
});
test("duplicate endpoints do not initiate flows and role loss clears credentials", async ({
  page,
}) => {
  const node = await setup(page, "he");
  await node.locator("textarea").fill("192.0.2.10\n192.0.2.10");
  await node.getByRole("button", { name: "אמת תחנה ראשונה", exact: true }).click();
  await expect(node.getByRole("alert")).toContainText("כתובות שונות");
  expect(await page.evaluate(() => window.flowCalls.length)).toBe(0);
  await node.getByLabel("סיסמה", { exact: true }).fill("synthetic-connection-password");
  await node.evaluate((n) => (n.hass = { ...n.hass, user: { ...n.hass.user, is_admin: false } }));
  await expect(node.locator("details")).toHaveCount(0);
  expect(await node.evaluate((n) => n.credentials.password)).toBe("");
});

for (const returnedType of ["form", "create_entry"]) {
  test(
    "detaching handles late " + returnedType + " without mutating a different view",
    async ({ page }) => {
      const node = await setup(page);
      await page.evaluate(() => {
        const original = window.demoHass.callApi;
        window.demoHass.callApi = (method, path, values) => {
          if (method === "DELETE") return original(method, path, values);
          return new Promise((resolve) => (window.finishFlow = resolve));
        };
        const node = document.querySelector("wiskey-station-onboarding");
        node.hass = { ...window.demoHass };
      });
      await node.locator("textarea").fill("192.0.2.21 | Delayed");
      await node.getByRole("button", { name: "Validate first station", exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.finishFlow)).toBe("function");
      await node.evaluate((n) => n.remove());
      await page.evaluate(
        (type) =>
          window.finishFlow({ type, flow_id: "late-form", step_id: "user", data_schema: [] }),
        returnedType,
      );
      if (returnedType === "form")
        await expect
          .poll(() =>
            page.evaluate(() => window.flowCalls.filter((c) => c.method === "DELETE").length),
          )
          .toBe(1);
      else {
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        expect(
          await page.evaluate(() => window.flowCalls.filter((c) => c.method === "DELETE").length),
        ).toBe(0);
      }
      expect(await page.evaluate(() => window.flowCalls.some((c) => c.values?.test_unlock))).toBe(
        false,
      );
    },
  );
}
