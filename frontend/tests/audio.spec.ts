import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    w.audio = { unsubscribed: 0, microphones: 0, stopped: 0, sent: [], delay: false };
    const base = w.demoHass.callWS.bind(w.demoHass),
      subscribe = w.demoHass.connection.subscribeMessage.bind(w.demoHass.connection);
    const listeners = new Map<string, Set<() => void>>();
    w.demoHass.connection.connected = true;
    w.demoHass.connection.addEventListener = (event: string, callback: () => void) => {
      const group = listeners.get(event) ?? new Set();
      group.add(callback);
      listeners.set(event, group);
    };
    w.demoHass.connection.removeEventListener = (event: string, callback: () => void) => {
      listeners.get(event)?.delete(callback);
    };
    w.audio.disconnected = () => {
      w.demoHass.connection.connected = false;
      for (const callback of listeners.get("disconnected") ?? []) callback();
    };
    w.audio.reconnected = () => {
      w.demoHass.connection.connected = true;
      for (const callback of listeners.get("ready") ?? []) callback();
    };
    w.demoHass.connection.subscribeMessage = async (callback: any, message: any, options: any) => {
      if (message.type !== "hikvision_intercom/audio/start") return subscribe(callback, message);
      w.audio.subscriptionOptions = options;
      w.calls.push(message);
      w.audio.event = callback;
      if (w.audio.delay) await new Promise<void>((r) => (w.audio.ready = r));
      callback({ state: "ready", token: "a".repeat(32), sample_rate: 8000, packet_bytes: 800 });
      return () => {
        w.audio.unsubscribed++;
      };
    };
    w.demoHass.callWS = async (message: any) => {
      if (!message.type.includes("/audio/")) return base(message);
      w.calls.push(message);
      if (message.type.endsWith("/receive")) {
        await new Promise((r) => setTimeout(r, 100));
        return { data: btoa("\xff".repeat(800)) };
      }
      if (message.type.endsWith("/send")) {
        w.audio.sent.push(message);
        return { sequence: message.sequence + 1 };
      }
      return {};
    };
    navigator.mediaDevices.getUserMedia = async () => {
      w.audio.microphones++;
      const context = new AudioContext({ sampleRate: 8000 });
      const osc = context.createOscillator();
      osc.frequency.value = 440;
      const destination = context.createMediaStreamDestination();
      osc.connect(destination);
      osc.start();
      destination.stream.getTracks().forEach((track) => {
        const stop = track.stop.bind(track);
        track.stop = () => {
          w.audio.stopped++;
          stop();
          void context.close();
        };
      });
      if (w.audio.delayMic) await new Promise<void>((r) => (w.audio.grantMic = r));
      return destination.stream;
    };
  });
  await page.getByRole("button", { name: "View camera", exact: true }).first().click();
  return page.locator("hikvision-intercom-audio-controls");
}

test("explicit listen and real audio worklet transmit only while held", async ({ page }) => {
  const audio = await setup(page);
  expect(await page.evaluate(() => (window as any).audio.microphones)).toBe(0);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.includes("/audio/")).length),
  ).toBe(0);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect(audio).toContainText("Audio connected");
  expect(await page.evaluate(() => (window as any).audio.microphones)).toBe(0);
  const talk = audio.getByRole("button", { name: "Hold to talk", exact: true });
  await talk.dispatchEvent("pointerdown", { pointerId: 1 });
  await expect
    .poll(() => page.evaluate(() => (window as any).audio.sent.length))
    .toBeGreaterThan(1);
  await expect(audio.getByRole("button", { name: "Talking — release to mute" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await audio.getByRole("button", { name: "Talking — release to mute" }).dispatchEvent("pointerup");
  await expect.poll(() => page.evaluate(() => (window as any).audio.stopped)).toBe(1);
  const packets = await page.evaluate(() =>
    (window as any).audio.sent.map((p: any) => ({
      sequence: p.sequence,
      length: atob(p.data).length,
      nonSilent: [...atob(p.data)].some((x: any) => x.charCodeAt(0) !== 255),
    })),
  );
  expect(
    packets.every((p: any, i: number) => p.sequence === i && p.length === 800 && p.nonSilent),
  ).toBe(true);
  await audio.getByRole("button", { name: "Stop audio", exact: true }).click();
  expect(await page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
});

test("releasing while microphone permission is pending stops late tracks", async ({ page }) => {
  const audio = await setup(page);
  await page.evaluate(() => ((window as any).audio.delayMic = true));
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  const talk = audio.getByRole("button", { name: "Hold to talk", exact: true });
  await talk.focus();
  await page.keyboard.down("Space");
  await expect.poll(() => page.evaluate(() => (window as any).audio.microphones)).toBe(1);
  await page.keyboard.up("Space");
  await page.evaluate(() => (window as any).audio.grantMic());
  await expect.poll(() => page.evaluate(() => (window as any).audio.stopped)).toBe(1);
  expect(await page.evaluate(() => (window as any).audio.sent.length)).toBe(0);
  await expect(audio.getByRole("button", { name: "Hold to talk", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("late subscription is released after camera closes during opening", async ({ page }) => {
  const audio = await setup(page);
  await page.evaluate(() => ((window as any).audio.delay = true));
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).audio.ready)).toBe("function");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => (window as any).audio.ready());
  await expect.poll(() => page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("/audio/receive")).length),
  ).toBe(0);
});

for (const action of ["close", "background", "logout", "offline"]) {
  test(`audio is stopped on ${action}`, async ({ page }) => {
    const audio = await setup(page);
    await audio.getByRole("button", { name: "Start audio", exact: true }).click();
    await expect(audio).toContainText("Audio connected");
    if (action === "close")
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    else
      await page.evaluate((action) => {
        const panel = document.querySelector("hikvision-intercom-panel") as any;
        const control = panel.shadowRoot.querySelector("hikvision-intercom-audio-controls");
        if (action === "background") {
          Object.defineProperty(document, "hidden", { configurable: true, value: true });
          document.dispatchEvent(new Event("visibilitychange"));
        }
        if (action === "logout") control.hass = { ...window.demoHass, user: { is_admin: false } };
        if (action === "offline") control.station = { ...control.station, online: false };
      }, action);
    await expect.poll(() => page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
    expect(await page.evaluate(() => (window as any).audio.microphones)).toBe(0);
  });
}

test("server expiry ends session and explains how it ended", async ({ page }) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect(audio).toContainText("Audio connected");
  await page.evaluate(() =>
    (window as any).audio.event({
      state: "closed",
      reason: "audio_expired",
      close_confirmed: true,
    }),
  );
  await expect(audio).toContainText("The 3-minute audio session ended");
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeEnabled();
});

test("microphone denial leaves listening available and does not send frames", async ({ page }) => {
  const audio = await setup(page);
  await page.evaluate(
    () =>
      (navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("denied", "NotAllowedError");
      }),
  );
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio.getByRole("button", { name: "Hold to talk", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(audio).toContainText("Microphone permission was denied");
  await expect(audio).toContainText("Audio connected");
  expect(await page.evaluate(() => (window as any).audio.sent.length)).toBe(0);
});

test("Hebrew audio controls fit a mobile camera dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=he");
  await page.getByRole("button", { name: "צפייה במצלמה", exact: true }).first().click();
  const audio = page.locator("hikvision-intercom-audio-controls");
  await expect(audio.getByRole("button", { name: "הפעל שמע", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
});

test("ending a call stops audio for the same station", async ({ page }) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect(audio).toContainText("Audio connected");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reject signal", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeEnabled();
});

test("HA reconnect cannot automatically reopen a microphone session", async ({ page }) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect(audio).toContainText("Audio connected");
  expect(await page.evaluate(() => (window as any).audio.subscriptionOptions.resubscribe)).toBe(
    false,
  );
  await page.evaluate(() => (window as any).audio.disconnected());
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).audio.reconnected());
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).audio.subscriptionOptions.preCheck())).toBe(
    false,
  );
  expect(await page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
});

test("moving keyboard focus releases the microphone without needing keyup", async ({ page }) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio.getByRole("button", { name: "Hold to talk", exact: true }).focus();
  await page.keyboard.down("Space");
  await expect
    .poll(() => page.evaluate(() => (window as any).audio.sent.length))
    .toBeGreaterThan(0);
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => (window as any).audio.stopped)).toBe(1);
  await expect(audio.getByRole("button", { name: "Hold to talk", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.up("Space");
});

for (const operation of ["receive", "send", "mute"]) {
  test(`a lost ${operation} response closes the session and late results cannot restart it`, async ({
    page,
  }) => {
    const audio = await setup(page);
    await page.evaluate((operation) => {
      const base = window.demoHass.callWS.bind(window.demoHass);
      window.demoHass.callWS = async (message: any) => {
        if (message.type === "hikvision_intercom/audio/" + operation)
          return await new Promise((r) => ((window as any).audio.late = r));
        return base(message);
      };
    }, operation);
    await audio.getByRole("button", { name: "Start audio", exact: true }).click();
    await expect(audio).toContainText("Audio connected");
    if (operation !== "receive") {
      await audio.getByRole("button", { name: "Hold to talk", exact: true }).focus();
      await page.keyboard.down("Space");
      await expect.poll(() => page.evaluate(() => (window as any).audio.microphones)).toBe(1);
      if (operation === "mute") await page.keyboard.up("Space");
    }
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).audio.late))
      .toBe("function");
    await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeEnabled({
      timeout: 8000,
    });
    await page.evaluate(() =>
      (window as any).audio.late({ data: btoa("\xff".repeat(800)), sequence: 1 }),
    );
    await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
    if (operation !== "receive")
      expect(await page.evaluate(() => (window as any).audio.stopped)).toBe(1);
    await page.keyboard.up("Space");
  });
}

test("browser audio suspension releases active microphone and requires explicit restart", async ({
  page,
}) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio.getByRole("button", { name: "Hold to talk", exact: true }).focus();
  await page.keyboard.down("Space");
  await expect
    .poll(() => page.evaluate(() => (window as any).audio.sent.length))
    .toBeGreaterThan(0);
  await audio.evaluate(async (node: any) => {
    await node.context.suspend();
  });
  await expect(audio).toContainText("Audio was interrupted by the browser");
  await expect.poll(() => page.evaluate(() => (window as any).audio.stopped)).toBe(1);
  expect(await page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
  await page.keyboard.up("Space");
});

test("audio cannot be started while HA is already disconnected", async ({ page }) => {
  const audio = await setup(page);
  await audio.evaluate((node: any) => {
    window.demoHass.connection.connected = false;
    node.hass = { ...window.demoHass };
  });
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeDisabled();
  await audio.evaluate((node: any) => node.start());
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type === "hikvision_intercom/audio/start").length,
    ),
  ).toBe(0);
});

test("a delayed browser audio start cannot subscribe to a newly selected station", async ({
  page,
}) => {
  const audio = await setup(page);
  await page.evaluate(() => {
    const original = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      AudioContext.prototype.resume = original;
      return new Promise((resolve) => (window.resumeOpeningAudio = () => resolve()));
    };
  });
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.resumeOpeningAudio)).toBe("function");
  await audio.evaluate((node: any) => {
    // Queue resume before Lit's changed-station cleanup, then switch synchronously.
    window.resumeOpeningAudio();
    node.station = structuredClone(window.demoData.stations[1]);
  });
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type === "hikvision_intercom/audio/start").length,
    ),
  ).toBe(0);
});

test("reattaching idle audio restores connection listeners without starting a session", async ({
  page,
}) => {
  const audio = await setup(page);
  await audio.evaluate(async (node: any) => {
    const parent = node.parentNode;
    node.remove();
    await node.updateComplete;
    parent.append(node);
    await node.updateComplete;
    (window as any).audio.disconnected();
  });
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).audio.reconnected());
  await expect(audio.getByRole("button", { name: "Start audio", exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type === "hikvision_intercom/audio/start").length,
    ),
  ).toBe(0);
});

for (const [name, message] of [
  ["NotAllowedError", "Microphone permission was denied"],
  ["NotFoundError", "No microphone was found"],
  ["NotReadableError", "could not open the microphone"],
]) {
  test(`microphone failure explains ${name}`, async ({ page }) => {
    const audio = await setup(page);
    await page.evaluate((name) => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("synthetic", name);
      };
    }, name);
    await audio.getByRole("button", { name: "Start audio", exact: true }).click();
    await audio
      .getByRole("button", { name: "Hold to talk", exact: true })
      .dispatchEvent("pointerdown", { pointerId: 1 });
    await expect(audio.getByRole("alert")).toContainText(message);
    expect(await page.evaluate(() => (window as any).audio.sent.length)).toBe(0);
  });
}

test("audio diagnostics report actual worklet counters without sound or session secrets", async ({
  page,
}) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio
    .getByRole("button", { name: "Hold to talk", exact: true })
    .dispatchEvent("pointerdown", { pointerId: 1 });
  await expect
    .poll(() => page.evaluate(() => (window as any).audio.sent.length))
    .toBeGreaterThan(2);
  await audio.getByRole("button", { name: "Talking — release to mute" }).dispatchEvent("pointerup");
  await audio.locator("summary").click();
  const download = page.waitForEvent("download");
  await audio.getByRole("button", { name: "Download audio diagnostics" }).click();
  const { readFile } = await import("node:fs/promises");
  const result = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(result.microphone_packets_acknowledged).toBeGreaterThan(2);
  expect(result.microphone_packets_captured).toBeGreaterThan(2);
  expect(result.physical_audibility).toBe("unverified");
  expect(result.path).toBe("browser_ha_isapi");
  expect(result.recording_saved).toBe(false);
  expect(JSON.stringify(result)).not.toContain("a".repeat(32));
});
