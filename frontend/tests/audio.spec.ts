import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, appearance = "current") {
  await page.addInitScript(
    (design) => localStorage.setItem("hikvision-intercom:appearance:v1:demo-admin", design),
    appearance,
  );
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
      if (message.type.endsWith("/diagnostics")) {
        if (w.audio.delayDiagnostics)
          return new Promise((resolve) => {
            w.audio.resolveDiagnostics = resolve;
          });
        if (w.audio.failDiagnostics) throw new Error("synthetic diagnostics failure");
        return {
          microphone_packets_accepted: w.audio.sent.length,
          microphone_bytes_written: w.audio.sent.length * 800,
          total_bytes_written: w.audio.sent.length * 800 + 160,
          received_bytes: 800,
          upload_http_status: 200,
        };
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
  if (appearance.startsWith("access-")) await page.locator(".access-door-camera").first().click();
  else if (appearance === "modern") await page.locator(".camera-wrap > button").first().click();
  else await page.getByRole("button", { name: "View camera", exact: true }).first().click();
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
  await audio.locator(".audio-options > summary").click();
  await audio.getByText(/^(Audio diagnostics|אבחון שמע)$/, { exact: true }).click();
  const download = page.waitForEvent("download");
  await audio.getByRole("button", { name: "Download audio diagnostics" }).click();
  const { readFile } = await import("node:fs/promises");
  const result = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(result.microphone_packets_acknowledged).toBeGreaterThan(2);
  expect(result.microphone_packets_captured).toBeGreaterThan(2);
  expect(result.microphone_peak_percent).toBeGreaterThan(0);
  expect(result.backend.upload_http_status).toBe(200);
  expect(result.backend.microphone_bytes_written).toBeGreaterThan(0);
  expect(result.backend_sampled_at).toBeTruthy();
  expect(result.physical_audibility).toBe("unverified");
  expect(result.path).toBe("browser_ha_isapi");
  expect(result.recording_saved).toBe(false);
  expect(JSON.stringify(result)).not.toContain("a".repeat(32));
});

test("visible server counters distinguish transmission from microphone acceptance and retain the peak", async ({
  page,
}) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio.locator(".audio-options > summary").click();
  await audio.getByText(/^(Audio diagnostics|אבחון שמע)$/, { exact: true }).click();
  await expect(audio.getByTestId("audio-upload")).toHaveText("200");
  await expect(audio.getByTestId("audio-written")).toHaveText("0");
  await audio
    .getByRole("button", { name: "Hold to talk", exact: true })
    .dispatchEvent("pointerdown", { pointerId: 1 });
  await expect
    .poll(() => page.evaluate(() => (window as any).audio.sent.length))
    .toBeGreaterThan(2);
  await audio.getByRole("button", { name: "Talking — release to mute" }).dispatchEvent("pointerup");
  await expect
    .poll(async () => Number(await audio.getByTestId("audio-written").innerText()))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number((await audio.getByTestId("audio-peak").innerText()).replace("%", "")))
    .toBeGreaterThan(0);
  expect(await audio.evaluate((node: any) => node._signal)).toBe(0);
  await expect(audio.getByRole("button", { name: "Download audio diagnostics" })).toBeVisible();
});

test("failed diagnostics retain a labelled old sample without stopping audio", async ({ page }) => {
  const audio = await setup(page);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio.locator(".audio-options > summary").click();
  await audio.getByText(/^(Audio diagnostics|אבחון שמע)$/, { exact: true }).click();
  await expect(audio.getByTestId("audio-upload")).toHaveText("200");
  await page.evaluate(() => {
    (window as any).audio.failDiagnostics = true;
  });
  await audio.getByRole("button", { name: "Refresh server counters" }).click();
  await expect(audio).toContainText("Server diagnostics could not be refreshed");
  await expect(audio.getByTestId("audio-upload")).toHaveText("200");
  await expect(audio.getByRole("button", { name: "Hold to talk", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    (window as any).audio.failDiagnostics = false;
  });
  await audio.getByRole("button", { name: "Refresh server counters" }).click();
  await expect(audio).not.toContainText("Server diagnostics could not be refreshed");
});

test("late diagnostic results cannot populate a replacement audio session", async ({ page }) => {
  const audio = await setup(page);
  await page.evaluate(() => {
    (window as any).audio.delayDiagnostics = true;
  });
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio.locator(".audio-options > summary").click();
  await audio.getByText(/^(Audio diagnostics|אבחון שמע)$/, { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).audio.resolveDiagnostics))
    .toBe("function");
  await page.evaluate(() => {
    (window as any).oldAudioDiagnostic = (window as any).audio.resolveDiagnostics;
  });
  await audio.getByRole("button", { name: "Stop audio", exact: true }).click();
  await page.evaluate(() => {
    (window as any).audio.delayDiagnostics = false;
  });
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect(audio.getByTestId("audio-upload")).toHaveText("200");
  await page.evaluate(() => {
    (window as any).oldAudioDiagnostic({
      microphone_bytes_written: 999999,
      upload_http_status: 403,
    });
  });
  await expect(audio.getByTestId("audio-written")).toHaveText("0");
  await expect(audio.getByTestId("audio-upload")).toHaveText("200");
});

for (const width of [390, 1440])
  test(`Hebrew audio diagnostics and download remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const audio = await setup(page);
    await page.evaluate(() => {
      window.demoHass.language = "he";
      document.querySelector("hikvision-intercom-panel")!.hass = { ...window.demoHass };
    });
    await audio.getByRole("button", { name: "הפעל שמע", exact: true }).click();
    await audio.locator(".audio-options > summary").click();
    await audio.getByText(/^(Audio diagnostics|אבחון שמע)$/, { exact: true }).click();
    await expect(audio.getByTestId("audio-upload")).toHaveText("200");
    const downloadButton = audio.getByRole("button", { name: "הורד קובץ אבחון", exact: true });
    await downloadButton.scrollIntoViewIfNeeded();
    await expect(downloadButton).toBeInViewport();
    const download = page.waitForEvent("download");
    await downloadButton.click();
    expect((await download).suggestedFilename()).toBe("wiskey-audio-diagnostics.json");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/audio-diagnostics-${width}-he.png` });
  });

test("local microphone meter sends no audio and selected device is used only on press", async ({
  page,
}) => {
  const audio = await setup(page);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.audio.constraints = constraints;
      return original(constraints);
    };
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: "audioinput", deviceId: "mic-a", label: "Desk microphone" },
      { kind: "audioinput", deviceId: "mic-b", label: "Headset" },
    ];
  });
  await audio.locator(".audio-options > summary").click();
  const mic = audio.locator("wiskey-microphone-input");
  await mic.locator("summary").click();
  await mic.getByRole("button", { name: "Refresh microphones" }).click();
  await mic.getByRole("combobox", { name: "Microphone", exact: true }).selectOption("mic-b");
  expect(await page.evaluate(() => window.audio.microphones)).toBe(0);
  await mic.getByRole("button", { name: "Test microphone locally" }).click();
  await expect.poll(() => mic.locator("meter").evaluate((el) => el.value)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.audio.constraints.audio.deviceId)).toEqual({
    exact: "mic-b",
  });
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.includes("/audio/")).length),
  ).toBe(0);
  await mic.getByRole("button", { name: "Stop local test" }).click();
  expect(await page.evaluate(() => window.audio.stopped)).toBe(1);
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio
    .getByRole("button", { name: "Hold to talk", exact: true })
    .dispatchEvent("pointerdown", { pointerId: 1 });
  await expect.poll(() => page.evaluate(() => window.audio.sent.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.audio.constraints.audio.deviceId)).toEqual({
    exact: "mic-b",
  });
  await audio.getByRole("button", { name: "Talking — release to mute" }).dispatchEvent("pointerup");
});

for (const action of ["close", "change", "background"]) {
  test(`local microphone test releases tracks on ${action}`, async ({ page }) => {
    const audio = await setup(page);
    await audio.locator(".audio-options > summary").click();
    const mic = audio.locator("wiskey-microphone-input");
    await mic.locator("summary").click();
    await mic.getByRole("button", { name: "Test microphone locally" }).click();
    await expect.poll(() => page.evaluate(() => window.audio.microphones)).toBe(1);
    if (action === "close")
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    if (action === "change")
      await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
    if (action === "background")
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    await expect.poll(() => page.evaluate(() => window.audio.stopped)).toBe(1);
    expect(await page.evaluate(() => window.audio.sent.length)).toBe(0);
  });
}

for (const ending of ["click", "background", "mode change"]) {
  test(`toggle microphone stays active after release and stops on ${ending}`, async ({ page }) => {
    const audio = await setup(page);
    await page.evaluate(() => {
      window.demoData.media_settings = { ...window.demoData.media_settings, talk_mode: "toggle" };
      window.demoNotify();
    });
    await audio.getByRole("button", { name: "Start audio", exact: true }).click();
    expect(await page.evaluate(() => (window as any).audio.microphones)).toBe(0);
    await audio.getByRole("button", { name: "Start talking", exact: true }).click();
    const stop = audio.getByRole("button", { name: "Stop talking", exact: true });
    await expect(stop).toHaveAttribute("aria-pressed", "true");
    await stop.dispatchEvent("pointerup");
    await expect(stop).toHaveAttribute("aria-pressed", "true");
    if (ending === "click") await stop.click();
    else if (ending === "background")
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    else
      await page.evaluate(() => {
        window.demoData.media_settings.talk_mode = "ptt";
        window.demoNotify();
      });
    await expect.poll(() => page.evaluate(() => (window as any).audio.stopped)).toBe(1);
  });
}

for (const appearance of ["current", "modern", "access-light", "access-dark"]) {
  test(`audio packet transport works with production permission contract in ${appearance}`, async ({
    page,
  }) => {
    const audio = await setup(page, appearance);
    await page.evaluate(() => {
      window.demoData.api = {
        version: 1,
        min_client: 0,
        capabilities: ["panel_permissions"],
        commands: ["overview", "media/call", "media/signal"],
      };
      window.demoNotify();
      const w = window as any;
      const base = w.demoHass.callWS.bind(w.demoHass);
      w.demoHass.callWS = async (message: any) => {
        if (message.type.includes("/audio/") && "api_contract" in message)
          throw { code: "audio_invalid_packet" };
        return base(message);
      };
    });
    await expect
      .poll(() =>
        page.locator("hikvision-intercom-panel").evaluate((el: any) => el._data.api.capabilities),
      )
      .toContain("panel_permissions");
    await audio.getByRole("button", { name: "Start audio", exact: true }).click();
    await expect(audio).toContainText("Audio connected");
    await expect
      .poll(() =>
        page.evaluate(() => window.calls.filter((c) => c.type.endsWith("audio/receive")).length),
      )
      .toBeGreaterThan(2);
    const talk = audio.getByRole("button", { name: "Hold to talk", exact: true });
    await talk.focus();
    await page.keyboard.down("Space");
    await expect
      .poll(() => page.evaluate(() => (window as any).audio.sent.length))
      .toBeGreaterThan(1);
    await page.keyboard.up("Space");
    await expect
      .poll(() => page.evaluate(() => window.calls.some((c) => c.type.endsWith("audio/mute"))))
      .toBe(true);
    await audio.getByRole("button", { name: "Stop audio", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).audio.unsubscribed)).toBe(1);
  });
}

test("audio transport exemption preserves management authorization and compatibility gates", async ({
  page,
}) => {
  await setup(page);
  const result = await page.locator("hikvision-intercom-panel").evaluate(async (node: any) => {
    const policy = {
      version: 1,
      min_client: 0,
      capabilities: ["panel_permissions"],
      commands: ["overview", "audio/diagnostics"],
    };
    node._data = { ...node._data, api: policy };
    const call = async (command: string) => {
      try {
        await node.protectedHass.callWS({
          type: `hikvision_intercom/${command}`,
          token: "synthetic",
        });
        return "allowed";
      } catch (e: any) {
        return e.code;
      }
    };
    const management = await call("users/delete");
    const unknownAudio = await call("audio/unknown");
    const diagnostics = await call("audio/diagnostics");
    const wire = window.calls.filter((c) => c.type.endsWith("audio/diagnostics")).at(-1);
    node._data = { ...node._data, api: { ...policy, min_client: 2 } };
    return {
      management,
      unknownAudio,
      diagnostics,
      envelope: "api_contract" in wire,
      incompatible: await call("audio/send"),
      mute: await call("audio/mute"),
    };
  });
  expect(result).toEqual({
    management: "unauthorized",
    unknownAudio: "unauthorized",
    diagnostics: "allowed",
    envelope: false,
    incompatible: "api_incompatible",
    mute: "allowed",
  });
});

test("restored microphone selection matches its label and can be reset to browser default", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("wiskey:microphone:v1:demo-admin", "old-device"),
  );
  const audio = await setup(page);
  await audio.locator(".audio-options > summary").click();
  const mic = audio.locator("wiskey-microphone-input");
  await mic.locator("summary").click();
  const select = mic.getByRole("combobox", { name: "Microphone", exact: true });
  await expect(select).toHaveValue("old-device");
  await expect(select.locator("option:checked")).toHaveText("Saved selection");
  await page.evaluate(() => {
    const base = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () =>
      [
        { kind: "audioinput", deviceId: "new-device", label: "Connected microphone" },
      ] as MediaDeviceInfo[];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.audio.constraints = constraints;
      if ((constraints.audio as MediaTrackConstraints).deviceId)
        throw new DOMException("Gone", "NotFoundError");
      return base(constraints);
    };
  });
  await mic.getByRole("button", { name: "Refresh microphones" }).click();
  await expect(select).toHaveValue("old-device");
  await mic.getByRole("button", { name: "Test microphone locally" }).click();
  await expect(mic.getByRole("alert")).toContainText("selected microphone");
  await select.selectOption("");
  await expect(select).toHaveValue("");
  expect(
    await page.evaluate(() => localStorage.getItem("wiskey:microphone:v1:demo-admin")),
  ).toBeNull();
  await mic.getByRole("button", { name: "Test microphone locally" }).click();
  await expect.poll(() => mic.locator("meter").evaluate((el) => el.value)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.audio.constraints.audio.deviceId)).toBeUndefined();
  await mic.getByRole("button", { name: "Stop local test" }).click();
  await audio.getByRole("button", { name: "Start audio", exact: true }).click();
  await audio.getByRole("button", { name: "Hold to talk", exact: true }).focus();
  await page.keyboard.down("Space");
  await expect.poll(() => page.evaluate(() => window.audio.sent.length)).toBeGreaterThan(0);
  await page.keyboard.up("Space");
  await audio.getByRole("button", { name: "Stop audio", exact: true }).click();
});
