import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function rtc(page, mode = "success") {
  await page.goto("/");
  await page.evaluate((mode) => {
    if (mode === "stalled") {
      const streams = new WeakMap();
      // Simulate a received track whose decoder never produces a video frame.
      Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
        configurable: true,
        get() {
          return streams.get(this) ?? null;
        },
        set(value) {
          streams.set(this, value);
        },
      });
    }
    window.rtcConnectionListeners = new Map();
    window.demoHass.connection.addEventListener = (name, callback) => {
      const callbacks = window.rtcConnectionListeners.get(name) ?? new Set();
      callbacks.add(callback);
      window.rtcConnectionListeners.set(name, callbacks);
    };
    window.demoHass.connection.removeEventListener = (name, callback) => {
      window.rtcConnectionListeners.get(name)?.delete(callback);
    };
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
        if (mode === "success" || mode === "stalled" || mode === "addon") {
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
    if (mode === "addon") {
      window.demoData.media_settings = {
        revision: 1,
        transport: "webrtc",
        webrtc_mode: "rtc",
        fallback_hls: false,
        go2rtc_url: "http://addon.test:1984",
      };
      window.demoNotify();
    }
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (message.type === "auth/sign_path") {
        window.calls.push(message);
        return { path: message.path + "?authSig=synthetic-signature" };
      }
      if (message.type === "camera/capabilities") {
        window.calls.push(message);
        if (mode === "caps_pending")
          return await new Promise((resolve) => (window.rtcCapsResolve = resolve));
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
    window.demoHass.connection.subscribeMessage = async (callback, message, options) => {
      if (message.type !== "camera/webrtc/offer") return subscribe(callback, message);
      window.calls.push(message);
      window.rtcCallback = callback;
      window.rtcOptions = options;
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

test("a track without a decoded frame times out into HLS", async ({ page }) => {
  await page.clock.install();
  await rtc(page, "stalled");
  await expect.poll(() => page.evaluate(() => !!window.rtcTrack)).toBeTruthy();
  // Audio data can arrive before a video frame; it must not clear the video deadline.
  await page
    .getByRole("dialog")
    .locator("video")
    .evaluate((video) => {
      video.dispatchEvent(new Event("loadeddata"));
    });
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("Connecting video");
  await page.clock.fastForward(13000);
  await expect(page.getByRole("dialog")).toContainText("Video failed");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/stream").length),
  ).toBe(1);
  expect(await page.evaluate(() => window.rtcClosed)).toBe(1);
});

test("capability timeout falls back once and ignores its late reply", async ({ page }) => {
  await page.clock.install();
  await rtc(page, "caps_pending");
  await expect.poll(() => page.evaluate(() => !!window.rtcCapsResolve)).toBeTruthy();
  await page.clock.fastForward(11000);
  await expect(page.getByRole("dialog")).toContainText("Camera capability request timed out");
  await page.evaluate(() => window.rtcCapsResolve({ frontend_stream_types: ["web_rtc"] }));
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/stream").length),
  ).toBe(1);
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type === "camera/webrtc/offer")),
  ).toBe(false);
});

test("backgrounding releases RTC and returning starts a fresh session", async ({ page }) => {
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  await page.evaluate(() => {
    window.fakeHidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.fakeHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("dialog")).toContainText(
    "Video paused while this page is in the background",
  );
  expect(await page.evaluate(() => window.rtcClosed)).toBe(1);
  await page.evaluate(() => {
    window.fakeHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/webrtc/offer").length),
  ).toBe(2);
});

test("short RTC disconnect can recover without selecting HLS", async ({ page }) => {
  await page.clock.install();
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  await page.evaluate(() => {
    window.testPeer.connectionState = "disconnected";
    window.testPeer.onconnectionstatechange();
  });
  await page.clock.fastForward(2000);
  await page.evaluate(() => {
    window.testPeer.connectionState = "connected";
    window.testPeer.onconnectionstatechange();
  });
  await page.clock.fastForward(3000);
  expect(await page.evaluate(() => window.rtcClosed)).toBe(0);
  expect(await page.evaluate(() => window.calls.some((c) => c.type === "camera/stream"))).toBe(
    false,
  );
});

test("playback export includes decode evidence and omits SDP and network addresses", async ({
  page,
}) => {
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  await page.evaluate(() => {
    window.testPeer.getStats = async () =>
      new Map([
        [
          "v",
          {
            type: "inbound-rtp",
            kind: "video",
            bytesReceived: 1234,
            framesDecoded: 42,
            codecId: "c",
            remoteAddress: "PRIVATE_IP",
          },
        ],
        ["c", { type: "codec", mimeType: "video/H264", sdp: "PRIVATE_SDP" }],
        ["address", { type: "local-candidate", address: "PRIVATE_IP" }],
      ]);
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Playback report" }).click();
  const text = await readFile((await (await downloaded).path())!, "utf8");
  const report = JSON.parse(text);
  expect(report.rtc.video.framesDecoded).toBe(42);
  expect(report.rtc.video.codec).toBe("video/H264");
  expect(report.rtc.video_decoded).toBe(true);
  expect(text).not.toContain("PRIVATE");
  expect(text).not.toContain("entity_id");
});

test("ending a received track closes RTC and starts one fallback", async ({ page }) => {
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  await page.evaluate(() => window.rtcTrack.dispatchEvent(new Event("ended")));
  await expect(page.getByRole("dialog")).toContainText("The video track ended");
  expect(await page.evaluate(() => window.rtcClosed)).toBe(1);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/stream").length),
  ).toBe(1);
});

test("HA reconnect tears down old RTC and negotiates a fresh visible video session", async ({
  page,
}) => {
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  expect(await page.evaluate(() => window.rtcOptions.resubscribe)).toBe(false);
  await page.evaluate(() => {
    window.oldRTCOptions = window.rtcOptions;
    for (const callback of window.rtcConnectionListeners.get("disconnected")) callback();
  });
  await expect(page.getByRole("dialog")).toContainText(
    "Video paused until Home Assistant reconnects",
  );
  expect(await page.evaluate(() => window.rtcClosed)).toBe(1);
  expect(await page.evaluate(() => window.rtcUnsubscribed)).toBe(1);
  expect(await page.evaluate(() => window.oldRTCOptions.preCheck())).toBe(false);
  await page.evaluate(() => {
    for (const callback of window.rtcConnectionListeners.get("ready")) callback();
  });
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/webrtc/offer").length),
  ).toBe(2);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("/audio/start")).length),
  ).toBe(0);
});

test("closing camera while HA is disconnected prevents a reconnect from opening video", async ({
  page,
}) => {
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  await page.evaluate(() => {
    for (const callback of window.rtcConnectionListeners.get("disconnected")) callback();
  });
  const listeners = await page.evaluate(() => window.rtcConnectionListeners.get("ready").size);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.rtcConnectionListeners.get("ready").size))
    // Video, call and audio controls each detach their ready listener.
    .toBe(listeners - 3);
  await page.evaluate(() => {
    for (const callback of window.rtcConnectionListeners.get("ready")) callback();
  });
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/webrtc/offer").length),
  ).toBe(1);
  expect(await page.evaluate(() => window.rtcClosed)).toBe(1);
});

test("selected add-on RTC uses signed bridge without native provider and cleans up", async ({
  page,
}) => {
  let closed = false;
  await page.routeWebSocket(/\/api\/hikvision_intercom\/rtc\//, (ws) => {
    ws.onClose(() => {
      closed = true;
    });
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.offer) {
        ws.send(JSON.stringify({ type: "answer", answer: "synthetic" }));
        ws.send(
          JSON.stringify({ type: "candidate", candidate: { candidate: "synthetic", sdpMid: "0" } }),
        );
      }
    });
  });
  await rtc(page, "addon");
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) => c.type.startsWith("camera/webrtc/") || c.type === "camera/capabilities",
      ),
    ),
  ).toBe(false);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => closed).toBe(true);
  expect(await page.evaluate(() => window.rtcClosed)).toBe(1);
});

test("add-on RTC retries normal ICE once when TCP cannot connect", async ({ page }) => {
  let attempts = 0;
  await page.routeWebSocket(/\/api\/hikvision_intercom\/rtc\//, (ws) => {
    const attempt = ++attempts;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (!message.offer) return;
      if (attempt === 1) ws.send(JSON.stringify({ type: "error" }));
      else ws.send(JSON.stringify({ type: "answer", answer: "synthetic" }));
    });
  });
  await rtc(page, "addon");
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => window.calls.some((c) => c.type === "camera/stream"))).toBe(
    false,
  );
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  expect(await page.evaluate(() => window.rtcClosed)).toBe(2);
});

test("decoded video stall retries twice then falls back without microphone access", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
    HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
  });
  await page.clock.install();
  await rtc(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".player-status")).toHaveText("WebRTC");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.clock.fastForward(13000);
    await expect
      .poll(() =>
        page.evaluate(() => window.calls.filter((c) => c.type === "camera/webrtc/offer").length),
      )
      .toBe(attempt + 2);
    await expect(dialog.locator(".player-status")).toHaveText("WebRTC");
  }
  await page.clock.fastForward(13000);
  await expect(dialog).toContainText("Video failed");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/webrtc/offer").length),
  ).toBe(3);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/stream").length),
  ).toBe(1);
  expect(await page.evaluate(() => window.calls.some((c) => c.type.includes("/audio/")))).toBe(
    false,
  );
});

test("paused video and detached views do not trigger stall reconnects", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
    HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
  });
  await page.clock.install();
  await rtc(page);
  await expect(page.getByRole("dialog").locator(".player-status")).toHaveText("WebRTC");
  await page
    .getByRole("dialog")
    .locator("video")
    .evaluate((video) => video.pause());
  await page.clock.fastForward(60000);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/webrtc/offer").length),
  ).toBe(1);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.clock.fastForward(60000);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type === "camera/webrtc/offer").length),
  ).toBe(1);
});
