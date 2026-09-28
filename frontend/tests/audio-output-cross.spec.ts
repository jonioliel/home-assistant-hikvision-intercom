import { test, expect } from "@playwright/test";

test("local output selection fits Hebrew mobile, requests no microphone and sends no station command", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.evaluate(() => {
    window.outputCalls = [];
    Object.defineProperty(AudioContext.prototype, "setSinkId", {
      configurable: true,
      value: async function (id) {
        window.outputCalls.push(id);
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: async function (id) {
        window.outputCalls.push(id);
      },
    });
    // Mock the prototype so every WebKit MediaDevices wrapper uses the same fixture.
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), "enumerateDevices", {
      configurable: true,
      value: async () => [{ kind: "audiooutput", deviceId: "headphones", label: "אוזניות בדיקה" }],
    });
    navigator.mediaDevices.getUserMedia = async () => {
      throw Error("Microphone must not be requested");
    };
  });
  await page.getByRole("button", { name: "צפייה במצלמה", exact: true }).first().click();
  const audio = page.locator("hikvision-intercom-audio-controls");
  await audio.locator(".audio-options > summary").click();
  const output = audio.locator("wiskey-audio-output");
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
  await output.getByRole("button", { name: "רענון התקני פלט", exact: true }).click();
  await expect(output.locator('option[value="headphones"]')).toHaveCount(1);
  await output.locator("select").selectOption("headphones");
  await expect(output).toContainText("נבחר פלט להאזנה");
  expect(await output.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => window.outputCalls.includes("headphones"))).toBe(true);
  expect(
    await page.evaluate(
      () =>
        window.calls.filter(
          (c) => c.type.includes("/audio/") || /test_unlock$|stations\/.*update$/.test(c.type),
        ).length,
    ),
  ).toBe(0);
});

test("a browser without sink routing keeps system output and shows no extra permission prompt", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    Object.defineProperty(AudioContext.prototype, "setSinkId", {
      configurable: true,
      value: undefined,
    });
    navigator.mediaDevices.getUserMedia = async () => {
      throw Error("Microphone must not be requested");
    };
  });
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  const audio = page.locator("hikvision-intercom-audio-controls");
  await audio.locator(".audio-options > summary").click();
  const output = audio.locator("wiskey-audio-output");
  await expect(output.locator("select")).toBeDisabled();
  await expect(output.locator("select")).toHaveValue("");
  await expect(output).toContainText("sound settings");
  await expect(
    output.getByRole("button", { name: "Choose output in browser", exact: true }),
  ).toHaveCount(0);
  await expect(audio.getByRole("button", { name: "Start listening", exact: true })).toBeEnabled();
});
