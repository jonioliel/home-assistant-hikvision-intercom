import { expect, test, type Page } from "@playwright/test";

async function openTts(page: Page, hebrew = false) {
  await page.goto(hebrew ? "/?lang=he" : "/");
  await page
    .getByRole("button", { name: hebrew ? "צפייה במצלמה" : "View camera", exact: true })
    .first()
    .click();
  const tts = page.locator("wiskey-intercom-tts");
  await expect(tts.getByRole("textbox")).toBeVisible();
  await expect(tts.getByRole("combobox")).toHaveCount(0);
  return tts;
}

test("typed announcement uses configured HA TTS and only the selected intercom", async ({
  page,
}) => {
  const tts = await openTts(page);
  await tts.getByRole("textbox").fill("Please come to reception");
  await tts.getByRole("button", { name: "Speak at station", exact: true }).click();
  await expect(tts).toContainText("Generating speech in system infrastructure");
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
  await expect(tts.getByRole("alert")).toContainText("No system infrastructure TTS engine");
  await expect(tts.getByRole("button", { name: "Speak at station" })).toBeDisabled();
});

test("administrator saves one voice and quick phrases for every station", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav").getByRole("button", { name: "Management tools" }).click();
  await page
    .locator(".tools-grid")
    .getByRole("button", { name: "Video, audio and announcements" })
    .click();
  const settings = page.locator("hikvision-media-settings");
  await expect(settings.getByRole("combobox", { name: "Voice engine" })).toBeVisible();
  await settings
    .getByRole("combobox", { name: "Voice engine" })
    .selectOption("tts.google_translate_en_com");
  await settings.getByRole("combobox", { name: "Language" }).selectOption("iw");
  await settings.getByRole("button", { name: "Add phrase" }).click();
  await settings.getByRole("textbox", { name: "Announcement phrase 1" }).fill("נא להגיע לכניסה");
  await settings.getByRole("button", { name: "Save global settings" }).click();
  await expect(settings).toContainText("Saved globally");
  expect(await page.evaluate(() => window.demoData.media_settings)).toMatchObject({
    tts_engine_id: "tts.google_translate_en_com",
    tts_language: "iw",
    tts_phrases: ["נא להגיע לכניסה"],
  });
  await page.locator(".nav").getByRole("button", { name: "Overview" }).click();
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const tts = page.locator("wiskey-intercom-tts");
  await expect(tts.getByRole("combobox")).toHaveCount(0);
  await tts.getByRole("button", { name: "נא להגיע לכניסה" }).click();
  await expect(tts).toContainText("The announcement was sent to the selected station");
  expect(
    await page.evaluate(() => window.calls.findLast((call) => call.type.endsWith("/tts/start"))),
  ).toMatchObject({
    station_id: "station-0",
    engine_id: "tts.google_translate_en_com",
    language: "iw",
    message: "נא להגיע לכניסה",
  });
});

test("WisKey 04 mobile camera keeps typed composer and sends a saved phrase to its station", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", "wiskey-dark"),
  );
  await page.goto("/?lang=he");
  await page.evaluate(() => {
    window.demoData.media_settings = {
      ...window.demoData.media_settings,
      tts_engine_id: "tts.google_translate_en_com",
      tts_language: "iw",
      tts_phrases: ["נא להמתין ליד הדלת"],
    };
    window.demoNotify();
  });
  await page.locator(".wk4-open-camera").first().click();
  const call = page.getByRole("dialog");
  const tts = call.locator("wiskey-intercom-tts");
  await expect(call.locator("hikvision-intercom-camera")).toBeVisible();
  await expect(tts.getByRole("textbox")).toBeVisible();
  await expect(tts.getByRole("combobox")).toHaveCount(0);
  await tts.getByRole("button", { name: "נא להמתין ליד הדלת" }).click();
  expect(
    await page.evaluate(() => window.calls.findLast((call) => call.type.endsWith("/tts/start"))),
  ).toMatchObject({
    station_id: "station-0",
    language: "iw",
    message: "נא להמתין ליד הדלת",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

for (const { appearance, width, height } of [
  { appearance: "wiskey-light", width: 1440, height: 900 },
  { appearance: "wiskey-dark", width: 390, height: 844 },
]) {
  test(`quick TTS phrases stack without horizontal scrolling in ${appearance} at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((theme) => {
      localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", theme);
    }, appearance);
    await page.goto("/?lang=he");
    const phrases = [
      "נא להמתין ליד הדלת",
      "האזור מצולם, נא לשמור על הסדר ולהמתין לנציג שיגיע אליכם בתוך זמן קצר",
      "דלת מורדת",
    ];
    await page.evaluate((items) => {
      window.demoData.media_settings = {
        ...window.demoData.media_settings,
        tts_engine_id: "tts.google_translate_en_com",
        tts_language: "iw",
        tts_phrases: items,
      };
      window.demoNotify();
    }, phrases);
    await page.locator(".wk4-open-camera").first().click();
    const tts = page.getByRole("dialog").locator("wiskey-intercom-tts");
    const list = tts.locator(".quick-phrases");
    await expect(list.getByRole("button")).toHaveCount(3);
    const layout = await list.evaluate((element) => {
      const buttons = Array.from(element.querySelectorAll("button"));
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      return {
        listOverflowsHorizontally: element.scrollWidth > element.clientWidth,
        buttonOverflowsHorizontally: buttons.some(
          (button) => button.scrollWidth > button.clientWidth,
        ),
        stacked: boxes.every((box, index) => index === 0 || box.top >= boxes[index - 1].bottom),
        completeLabels: buttons.map((button) => button.textContent?.trim()),
      };
    });
    expect(layout).toEqual({
      listOverflowsHorizontally: false,
      buttonOverflowsHorizontally: false,
      stacked: true,
      completeLabels: phrases,
    });
    await list.getByRole("button", { name: phrases[1] }).click();
    expect(
      await page.evaluate(() => window.calls.findLast((call) => call.type.endsWith("/tts/start"))),
    ).toMatchObject({ station_id: "station-0", message: phrases[1] });
  });
}
test("blank and duplicate quick phrases cannot be saved", async ({ page }) => {
  await page.goto("/");
  await page.locator(".nav").getByRole("button", { name: "Management tools" }).click();
  await page
    .locator(".tools-grid")
    .getByRole("button", { name: "Video, audio and announcements" })
    .click();
  const settings = page.locator("hikvision-media-settings");
  await settings.getByRole("button", { name: "Add phrase" }).click();
  await expect(settings.getByRole("button", { name: "Save global settings" })).toBeDisabled();
  await settings.getByRole("textbox", { name: "Announcement phrase 1" }).fill("Please wait");
  await settings.getByRole("button", { name: "Add phrase" }).click();
  await settings.getByRole("textbox", { name: "Announcement phrase 2" }).fill("please wait");
  await expect(settings.getByRole("alert")).toContainText("remove duplicates");
  await expect(settings.getByRole("button", { name: "Save global settings" })).toBeDisabled();
  await settings.getByRole("button", { name: "Remove phrase 2" }).click();
  await expect(settings.getByRole("button", { name: "Save global settings" })).toBeEnabled();
});
