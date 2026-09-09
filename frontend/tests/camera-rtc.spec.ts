import { test, expect } from "@playwright/test";

async function rtc(page, mode = "success") {
  await page.goto("/");
  await page.evaluate((mode) => {
    window.rtcClosed = 0;
    window.rtcUnsubscribed = 0;
    window.rtcTracks = 0;
    class Peer {
      connectionState = "new";
      remoteDescription = null;
      localDescription = null;
      ontrack;
      onconnectionstatechange;
      onicecandidate;
      constructor() {
        window.testPeer = this;
      }
      addTransceiver() {}
      createDataChannel() {}
      async createOffer() {
        return { type: "offer", sdp: "synthetic" };
      }
      async setLocalDescription(desc) {
        this.localDescription = desc;
      }
      async setRemoteDescription(desc) {
        this.remoteDescription = desc;
        if (mode === "success") {
          const canvas = document.createElement("canvas");
          canvas.width = 20;
          canvas.height = 20;
          canvas.getContext("2d").fillRect(0, 0, 20, 20);
          const track = canvas.captureStream().getVideoTracks()[0];
          window.rtcTrack = track;
          this.ontrack?.({ track });
        }
      }
      async addIceCandidate() {
        window.rtcTracks++;
      }
      close() {
        window.rtcClosed++;
        this.connectionState = "closed";
      }
    }
    window.RTCPeerConnection = Peer;
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type === "camera/capabilities") {
        window.calls.push(message);
        return { frontend_stream_types: mode === "hls" ? ["hls"] : ["web_rtc", "hls"] };
      }
      if (message.type === "camera/webrtc/get_client_config") {
        window.calls.push(message);
        if (mode === "pending")
          return await new Promise((resolve) => (window.rtcResolve = resolve));
        return { configuration: { iceServers: [] } };
      }
      return base(message);
    };
    const subscribe = window.demoHass.connection.subscribeMessage.bind(window.demoHass.connection);
    window.demoHass.connection.subscribeMessage = async (callback, message) => {
      if (message.type !== "camera/webrtc/offer") return subscribe(callback, message);
      window.calls.push(message);
      window.rtcCallback = callback;
      if (mode === "fail") callback({ type: "error" });
      else {
        callback({ type: "session", session_id: "synthetic" });
        callback({ type: "candidate", candidate: { candidate: "synthetic" } });
        callback({ type: "answer", answer: "synthetic" });
      }
      return () => {
        window.rtcUnsubscribed++;
      };
    };
  }, mode);
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
}

test("advertised WebRTC uses HA signaling and cleans up peer, tracks and subscription", async ({
  page,
}) => {
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type === "camera/webrtc/offer")),
  ).toBeTruthy();
  expect(await page.evaluate(() => window.rtcTracks)).toBe(1);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rtcClosed)).toBe(1);
  expect(await page.evaluate(() => window.rtcUnsubscribed)).toBe(1);
  expect(await page.evaluate(() => window.rtcTrack.readyState)).toBe("ended");
});

test("WebRTC rejection falls back to HLS and exposes safe failure status", async ({ page }) => {
  await rtc(page, "fail");
  await expect(page.getByRole("dialog")).toContainText("Video failed");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/stream").length),
  ).toBe(1);
  expect(await page.evaluate(() => window.rtcUnsubscribed)).toBe(1);
});

test("HLS-only capabilities do not create a WebRTC offer", async ({ page }) => {
  await rtc(page, "hls");
  await expect(page.getByRole("dialog")).toContainText("Video failed");
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type === "camera/webrtc/offer")),
  ).toBeFalsy();
});

test("late RTC configuration after closing camera cannot create a peer", async ({ page }) => {
  await rtc(page, "pending");
  await expect.poll(() => page.evaluate(() => !!window.rtcResolve)).toBeTruthy();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.rtcResolve({ configuration: {} }));
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type === "camera/webrtc/offer")),
  ).toBeFalsy();
});

test("connected RTC failure tears down once and tries HLS once", async ({ page }) => {
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  await page.evaluate(() => {
    window.testPeer.connectionState = "failed";
    window.testPeer.onconnectionstatechange();
  });
  await expect(page.getByRole("dialog")).toContainText("Video failed");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/stream").length),
  ).toBe(1);
  expect(await page.evaluate(() => window.rtcClosed)).toBe(1);
});
