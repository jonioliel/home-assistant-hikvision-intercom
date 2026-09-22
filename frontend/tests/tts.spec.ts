import { expect, test, type Page } from "@playwright/test";

async function openTts(page: Page, hebrew = false) {
  await page.goto(hebrew ? "/?lang=he" : "/");
  await page
    .getByRole("button", { name: hebrew ? "צפייה במצלמה" : "View camera", exact: true })
    .first()
    .click();
  const tts = page.locator("wiskey-intercom-tts");
  await expect(tts.getByRole("textbox")).toBeVisible();
  await expect(
    tts.getByRole("combobox", { name: hebrew ? "מנוע קול" : "Voice engine" }),
  ).toHaveValue("tts.google_translate_en_com");
  return tts;
}

test("typed announcement uses configured HA TTS and only the selected intercom", async ({
  page,
}) => {
  const tts = await openTts(page);
  await tts.getByRole("textbox").fill("Please come to reception");
  await tts.getByRole("button", { name: "Speak at station", exact: true }).click();
  await expect(tts).toContainText("Generating speech in Home Assistant");
  await expect(tts).toContainText("Speaking at the selected station");
  await expect(tts).toContainText("The announcement was sent to the selected station");
  const result = await page.evaluate(() => {
    const calls = window.calls.filter((call) => call.type.endsWith("/tts/start"));
    return {
      call: calls.at(-1),
      starts: window.tts.starts,
      stops: window.tts.stops,
      microphoneCalls: window.calls.filter((call) => call.type.endsWith("/audio/start")).length,
    };
  });
  expect(result.call).toMatchObject({
    station_id: "station-0",
    engine_id: "tts.google_translate_en_com",
    language: "en",
    message: "Please come to reception",
  });
  expect(result.starts).toBe(1);
  expect(result.stops).toBe(1);
  expect(result.microphoneCalls).toBe(0);
});

test("operator can stop an in-progress announcement without opening a microphone", async ({
  page,
}) => {
  const tts = await openTts(page);
  await page.evaluate(() => {
    const original = window.demoHass.connection.subscribeMessage.bind(window.demoHass.connection);
    window.demoHass.connection.subscribeMessage = async (callback, message, options) => {
      if (message.type !== "hikvision_intercom/tts/start")
        return original(callback, message, options);
      window.calls.push(structuredClone(message));
      callback({ state: "generating" });
      callback({ state: "speaking", duration_seconds: 30 });
      return () => {
        window.tts ??= { starts: 0, stops: 0 };
        window.tts.stops++;
      };
    };
  });
  await tts.getByRole("textbox").fill("A long announcement");
  await tts.getByRole("button", { name: "Speak at station", exact: true }).click();
  await expect(tts.getByRole("button", { name: "Stop announcement" })).toBeVisible();
  await tts.getByRole("button", { name: "Stop announcement" }).click();
  await expect(tts.getByRole("button", { name: "Speak at station" })).toBeEnabled();
  expect(await page.evaluate(() => window.tts.stops)).toBeGreaterThan(0);
});

test("closing the call window cancels a live announcement", async ({ page }) => {
  const tts = await openTts(page);
  await page.evaluate(() => {
    const original = window.demoHass.connection.subscribeMessage.bind(window.demoHass.connection);
    window.demoHass.connection.subscribeMessage = async (callback, message, options) => {
      if (message.type !== "hikvision_intercom/tts/start")
        return original(callback, message, options);
      callback({ state: "speaking", duration_seconds: 30 });
      return () => {
        window.tts ??= { starts: 0, stops: 0 };
        window.tts.stops++;
      };
    };
  });
  await tts.getByRole("textbox").fill("Close safety check");
  await tts.getByRole("button", { name: "Speak at station" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.tts.stops)).toBeGreaterThan(0);
});

test("Hebrew mobile composer selects iw, submits with keyboard and does not overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tts = await openTts(page, true);
  await expect(tts.getByRole("combobox", { name: "שפה" })).toHaveValue("iw");
  const input = tts.getByRole("textbox");
  await input.fill("נא להגיע לדלת הראשית");
  await input.press("Control+Enter");
  await expect(tts).toContainText("ההודעה נשלחה להשמעה בתחנה שנבחרה");
  const sent = await page.evaluate(() =>
    window.calls.findLast((call) => call.type.endsWith("/tts/start")),
  );
  expect(sent).toMatchObject({
    station_id: "station-0",
    language: "iw",
    message: "נא להגיע לדלת הראשית",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(tts.getByText("20/500", { exact: true })).toBeVisible();
});

test("composer reports missing HA engines and keeps transmission disabled", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type === "hikvision_intercom/tts/engines") return { default: null, engines: [] };
      return base(message);
    };
  });
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const tts = page.locator("wiskey-intercom-tts");
  await expect(tts.getByRole("alert")).toContainText("No Home Assistant TTS engine");
  await expect(tts.getByRole("button", { name: "Speak at station" })).toBeDisabled();
});
