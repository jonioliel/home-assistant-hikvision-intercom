import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { navigate } from "./navigation";
const policy = {
  revision: 1,
  transport: "webrtc",
  webrtc_mode: "mse",
  fallback_hls: false,
  go2rtc_url: "",
};
async function selectPolicy(page: Page, value = policy) {
  await page.evaluate((value) => {
    window.demoData.media_settings = value;
    window.demoNotify();
  }, value);
}
async function open(page: Page) {
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
}
async function signing(page: Page) {
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type === "auth/sign_path") {
        window.calls.push(message);
        return { path: message.path + "?authSig=synthetic-signature" };
      }
      return base(message);
    };
  });
}

test("global options save, reload, broadcast and conflicts", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Camera playback options");
  const form = page.locator("hikvision-media-settings");
  await form.getByLabel("WebRTC / go2rtc player mode", { exact: true }).selectOption("mse");
  await form.getByLabel("Allow automatic HLS fallback if the selected mode fails").uncheck();
  await form.getByRole("button", { name: "Save for all cameras" }).click();
  await expect(form).toContainText("Saved globally");
  expect(await page.evaluate(() => window.demoData.media_settings.webrtc_mode)).toBe("mse");
  await navigate(page, "Camera playback options");
  await expect(form.getByLabel("WebRTC / go2rtc player mode", { exact: true })).toHaveValue("mse");
  await page.evaluate(() => {
    window.demoData.media_settings.revision++;
    window.demoNotify();
  });
  await form.getByRole("button", { name: "Save for all cameras" }).click();
  await expect(form).toContainText("Another administrator changed");
  await form.getByRole("button", { name: "Reload saved settings" }).click();
  await expect(form.getByRole("button", { name: "Save for all cameras" })).toBeEnabled();
});

test("explicit HLS never probes RTC or opens MSE", async ({ page }) => {
  await page.goto("/");
  await selectPolicy(page, { ...policy, transport: "hls" });
  await open(page);
  await expect
    .poll(() => page.evaluate(() => window.calls.some((c) => c.type === "camera/stream")))
    .toBeTruthy();
  expect(
    await page.evaluate(() =>
      window.calls.some((c) =>
        ["camera/capabilities", "auth/sign_path", "camera/webrtc/get_client_config"].includes(
          c.type,
        ),
      ),
    ),
  ).toBeFalsy();
});

for (const fallback of [false, true]) {
  test(`MSE failure respects fallback ${fallback}`, async ({ page }) => {
    await page.routeWebSocket(/\/api\/hikvision_intercom\/mse\//, (ws) =>
      ws.onMessage(() =>
        ws.send(JSON.stringify({ type: "error", code: "mse_provider_unavailable" })),
      ),
    );
    await page.goto("/");
    await signing(page);
    await selectPolicy(page, { ...policy, fallback_hls: fallback });
    await open(page);
    await expect(page.getByRole("dialog")).toContainText("Video failed");
    expect(await page.evaluate(() => window.calls.some((c) => c.type === "camera/stream"))).toBe(
      fallback,
    );
    expect(
      await page.evaluate(() => window.calls.some((c) => c.type === "camera/capabilities")),
    ).toBeFalsy();
  });
}

test("MSE decodes synthetic fMP4, exports safe evidence and stops on global change", async ({
  page,
}) => {
  let data: number[] = [];
  let closed = false;
  await page.routeWebSocket(/\/api\/hikvision_intercom\/mse\//, (ws) => {
    ws.onClose(() => (closed = true));
    ws.onMessage((message) => {
      expect(JSON.parse(message.toString()).codecs).toContain("avc1.640029");
      ws.send(JSON.stringify({ type: "mse", value: 'video/mp4; codecs="avc1.42001E"' }));
      ws.send(Buffer.from(data));
    });
  });
  await page.goto("/");
  data = await page.evaluate(async () => {
    const mime = "video/mp4;codecs=avc1.42001E";
    if (!MediaRecorder.isTypeSupported(mime)) throw Error("Test browser needs MP4 MediaRecorder");
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = frame++ % 2 ? "#4466cc" : "#66cc44";
      ctx.fillRect(0, 0, 160, 90);
    }, 50);
    const stream = canvas.captureStream(10),
      recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));
    recorder.start(100);
    await new Promise((r) => setTimeout(r, 1300));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await signing(page);
  await selectPolicy(page);
  await open(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("MSE");
  const download = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Playback report" }).click();
  const file = await download;
  const result = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(result.active_transport).toBe("mse");
  expect(result.mse.video_decoded).toBe(true);
  expect(result.mse.bytes_received).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toContain("synthetic-signature");
  await selectPolicy(page, { ...policy, revision: 2, transport: "hls" });
  await expect.poll(() => closed).toBeTruthy();
  await expect
    .poll(() => page.evaluate(() => window.calls.some((c) => c.type === "camera/stream")))
    .toBeTruthy();
});

for (const width of [360, 768, 1440]) {
  test(`global settings fit ${width}px with Hebrew and new appearance`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?lang=he");
    await page.evaluate(() => {
      const panel = document.querySelector("hikvision-intercom-panel") as any;
      panel._appearance = "modern";
    });
    await navigate(page, "אפשרויות ניגון מצלמות");
    const form = page.locator("hikvision-media-settings");
    await form.getByLabel("מצב נגן WebRTC / go2rtc", { exact: true }).selectOption("mse");
    await expect(form.getByRole("button", { name: "שמירה לכל המצלמות" })).toBeVisible();
    expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    if (width === 1440)
      await page.screenshot({ path: "test-results/media-options-he.png", fullPage: true });
  });
}
