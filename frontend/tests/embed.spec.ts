import { test, expect, type Page, type Frame } from "@playwright/test";

async function openHost(page: Page, query = "embed=1&tab=users") {
  await page.addInitScript(() => {
    (window as any).kioskEvents = [];
    (window as any).storageWrites = [];
    window.addEventListener("hass-kiosk-mode", (event: Event) => {
      (window as any).kioskEvents.push((event as CustomEvent).detail);
    });
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      (window as any).storageWrites.push({ key, value });
      return set.call(this, key, value);
    };
  });
  await page.goto("/embed-host.html?frame=" + encodeURIComponent("/hikvision-intercom?" + query));
  await expect.poll(() => messages(page, "wiskey:ready")).toHaveLength(1);
  return page.frames().find((frame) => frame.url().includes("/hikvision-intercom"))!;
}

async function messages(page: Page, type: string) {
  return page.evaluate(
    (type) => (window as any).embedMessages.filter((m: any) => m.type === type),
    type,
  );
}

async function navigate(page: Page, tab: string, tool: string | null = null) {
  await page.evaluate(({ tab, tool }) => (window as any).vmsNavigate(tab, tool), { tab, tool });
}

function view(frame: Frame) {
  return frame.locator(".app-shell");
}

test("embedded people open without toolbar; handshake has permitted screen IDs and no secrets", async ({
  page,
}) => {
  const frame = await openHost(page);
  await expect(view(frame)).toHaveAttribute("data-view", "users");
  await expect(frame.locator("hikvision-intercom-panel")).toHaveAttribute("data-embed-api", "1");
  await expect(view(frame)).toHaveAttribute("data-embed-api", "1");
  await expect(view(frame).locator(":scope > header")).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "Menu", exact: true })).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "+ Add user", exact: true })).toBeVisible();
  const [ready] = await messages(page, "wiskey:ready");
  expect(ready.version).toBe(1);
  expect(ready.tabs.map((item: any) => item.id)).toEqual(
    expect.arrayContaining(["users", "devices", "sync", "tools", "camera_wall"]),
  );
  expect(ready.tools.map((item: any) => item.id)).toContain("media_options");
  expect(JSON.stringify(ready)).not.toMatch(/Or Levy|station-0|access_token|SUPERVISOR_TOKEN/);
  expect(await frame.evaluate(() => (window as any).kioskEvents)).toEqual([{ enable: true }]);
  expect(await frame.evaluate(() => (window as any).storageWrites)).toEqual([]);
  expect(await page.evaluate(() => (window as any).kioskEvents)).toEqual([]);
});

test("normal URL keeps toolbar and does not activate kiosk or persist embed", async ({ page }) => {
  const frame = await openHost(page, "tab=users");
  await expect(view(frame)).toHaveAttribute("data-view", "users");
  await expect(view(frame).locator(":scope > header")).toBeVisible();
  await expect(frame.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  expect(await frame.evaluate(() => (window as any).kioskEvents)).toEqual([]);
  await frame.getByRole("button", { name: "Events", exact: true }).click();
  await expect(view(frame)).toHaveAttribute("data-view", "events");
  expect(new URL(frame.url()).searchParams.get("tab")).toBe("events");
  await page.goto("/hikvision-intercom");
  await expect(page.locator(".app-shell > header")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-view", "overview");
});

test("tool URLs are canonical and in-page hub navigation updates parent without history growth", async ({
  page,
}) => {
  const frame = await openHost(page, "embed=1&tab=tools&tool=media_options&lang=he#bookmark");
  await expect(view(frame)).toHaveAttribute("data-view", "media_options");
  await expect(frame.locator("hikvision-media-settings")).toBeVisible();
  const historyLength = await frame.evaluate(() => history.length);
  await frame.locator(".tools-back").click();
  await expect(view(frame)).toHaveAttribute("data-view", "tools");
  await frame.locator(".tools-grid").getByRole("button", { name: "סנכרון", exact: true }).click();
  await expect(view(frame)).toHaveAttribute("data-view", "sync");
  await expect
    .poll(async () => (await messages(page, "wiskey:location")).at(-1))
    .toEqual({ type: "wiskey:location", tab: "sync", tool: null });
  const url = new URL(frame.url());
  expect(url.searchParams.get("lang")).toBe("he");
  expect(url.hash).toBe("#bookmark");
  expect(url.searchParams.has("tool")).toBe(false);
  expect(await frame.evaluate(() => history.length)).toBe(historyLength);
  expect(await messages(page, "wiskey:ready")).toHaveLength(1);
  await navigate(page, "tools", "media_options");
  await expect(view(frame)).toHaveAttribute("data-view", "media_options");
  await expect
    .poll(async () => (await messages(page, "wiskey:location")).at(-1))
    .toEqual({ type: "wiskey:location", tab: "tools", tool: "media_options" });
});

test("popstate and infrastructure location-changed apply URL; router history state survives", async ({
  page,
}) => {
  const frame = await openHost(page);
  await frame.evaluate(() => {
    history.replaceState({ router: "retained" }, "", "?embed=1&tab=events&extra=yes#anchor");
    window.dispatchEvent(new Event("location-changed"));
  });
  await expect(view(frame)).toHaveAttribute("data-view", "events");
  await navigate(page, "tools", "media_options");
  expect(await frame.evaluate(() => history.state)).toEqual({ router: "retained" });
  await frame.evaluate(() => {
    history.pushState({ router: "second" }, "", "?embed=1&tab=users");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(view(frame)).toHaveAttribute("data-view", "users");
  await frame.evaluate(() => history.back());
  await expect(view(frame)).toHaveAttribute("data-view", "media_options");
  await frame.evaluate(() => history.forward());
  await expect(view(frame)).toHaveAttribute("data-view", "users");
});

test("unknown URL defaults safely; malformed, unknown, wrong-origin and sibling messages are ignored", async ({
  page,
}) => {
  const frame = await openHost(page, "embed=1&tab=tools&tool=not-a-tool");
  await expect(view(frame)).toHaveAttribute("data-view", "overview");
  await navigate(page, "users");
  await expect(view(frame)).toHaveAttribute("data-view", "users");
  await navigate(page, "not-a-tab");
  await navigate(page, "tools", "not-a-tool");
  await frame.evaluate(() => {
    for (const data of [
      null,
      "wiskey:navigate",
      { type: "unknown" },
      { type: "wiskey:navigate", tab: {} },
      { type: "wiskey:navigate", tab: "users", tool: "schedules" },
    ])
      window.dispatchEvent(
        new MessageEvent("message", { origin: location.origin, source: window.parent, data }),
      );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://different.example",
        source: window.parent,
        data: { type: "wiskey:navigate", tab: "events" },
      }),
    );
    window.postMessage({ type: "wiskey:navigate", tab: "events" }, location.origin);
  });
  await expect(view(frame)).toHaveAttribute("data-view", "users");
  await navigate(page, "events");
  await expect(view(frame)).toHaveAttribute("data-view", "events");
});

test("URL and parent navigation preserve permissions and server mutation gates", async ({
  page,
}) => {
  const frame = await openHost(
    page,
    "embed=1&tab=tools&tool=access_control&reader&grant=users:view",
  );
  await expect(view(frame)).toHaveAttribute("data-view", "users");
  const [ready] = await messages(page, "wiskey:ready");
  expect(ready.tabs.map((item: any) => item.id)).toEqual(["users"]);
  expect(ready.tools.map((item: any) => item.id)).not.toContain("access_control");
  await navigate(page, "devices");
  await navigate(page, "tools", "access_control");
  await navigate(page, "tools", "platform_center");
  await expect(view(frame)).toHaveAttribute("data-view", "users");
  await expect(frame.getByRole("button", { name: "+ Add user", exact: true })).toBeDisabled();
  expect(
    await frame.evaluate(() =>
      (window as any).calls.some((call: any) =>
        /authorization\/settings_update|users\/(create|update)|test_unlock/.test(call.type),
      ),
    ),
  ).toBe(false);
});

test("revocation and session lock stop parent commands", async ({ page }) => {
  const frame = await openHost(page);
  await frame.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel") as any;
    panel._locked = true;
  });
  await navigate(page, "events");
  expect(
    await frame.evaluate(() => (document.querySelector("hikvision-intercom-panel") as any)._tab),
  ).toBe("users");
  await frame.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel") as any;
    panel._locked = false;
    panel._session = null;
  });
  await navigate(page, "events");
  await expect(
    frame.getByRole("heading", { name: "WisKey access has not been granted", exact: true }),
  ).toBeVisible();
  expect(
    await frame.evaluate(() => (document.querySelector("hikvision-intercom-panel") as any)._tab),
  ).toBe("users");
});

test("title follows heading and document title changes; navigation sends no automatic writes", async ({
  page,
}) => {
  const frame = await openHost(page);
  await navigate(page, "events");
  await expect.poll(async () => (await messages(page, "wiskey:title")).at(-1).text).toBe("Events");
  await frame.locator("hikvision-intercom-events").evaluate((element) => {
    element.shadowRoot!.querySelector("h2")!.textContent = "Updated activity heading";
  });
  await expect
    .poll(async () => (await messages(page, "wiskey:title")).at(-1).text)
    .toBe("Updated activity heading");
  await frame.evaluate(() => {
    document.title = "Infrastructure title";
  });
  await expect
    .poll(async () => (await messages(page, "wiskey:title")).at(-1).text)
    .toBe("Infrastructure title");
  expect(
    await frame.evaluate(() =>
      (window as any).calls.some((call: any) =>
        /test_unlock|whatsapp\/send|tts\/start|media\/signal|users\/(create|update)/.test(
          call.type,
        ),
      ),
    ),
  ).toBe(false);
});

test("leaving embed restores only in-frame kiosk state; disconnected listeners cannot react", async ({
  page,
}) => {
  const frame = await openHost(page);
  await frame.evaluate(() => {
    history.replaceState(history.state, "", "?tab=users");
    window.dispatchEvent(new Event("location-changed"));
  });
  await expect(view(frame).locator(":scope > header")).toBeVisible();
  expect(await frame.evaluate(() => (window as any).kioskEvents)).toEqual([
    { enable: true },
    { enable: false },
  ]);
  await frame.evaluate(() => {
    history.replaceState(history.state, "", "?embed=1&tab=users");
    window.dispatchEvent(new Event("location-changed"));
    const panel = document.querySelector("hikvision-intercom-panel") as any;
    panel.remove();
    (window as any).removedPanel = panel;
  });
  await navigate(page, "events");
  expect(await frame.evaluate(() => (window as any).removedPanel._tab)).toBe("users");
  expect(await frame.evaluate(() => (window as any).kioskEvents)).toEqual([
    { enable: true },
    { enable: false },
    { enable: true },
    { enable: false },
  ]);
  expect(await page.evaluate(() => (window as any).kioskEvents)).toEqual([]);
});

test("parent and URL navigation honor unsaved schedule confirmation and retain the actual location", async ({
  page,
}) => {
  const frame = await openHost(page, "embed=1&tab=tools&tool=schedules");
  await frame.getByRole("button", { name: "New schedule", exact: true }).click();
  await frame.getByLabel("Schedule name", { exact: true }).fill("Unsaved embedded schedule");
  page.once("dialog", (dialog) => dialog.dismiss());
  await navigate(page, "events");
  await expect(frame.getByLabel("Schedule name", { exact: true })).toHaveValue(
    "Unsaved embedded schedule",
  );
  await expect(view(frame)).toHaveAttribute("data-view", "schedules");
  page.once("dialog", (dialog) => dialog.dismiss());
  await frame.evaluate(() => {
    history.replaceState(history.state, "", "?embed=1&tab=events");
    window.dispatchEvent(new Event("location-changed"));
  });
  await expect.poll(() => new URL(frame.url()).searchParams.get("tool")).toBe("schedules");
  page.once("dialog", (dialog) => dialog.accept());
  await navigate(page, "events");
  await expect(view(frame)).toHaveAttribute("data-view", "events");
  expect(
    await frame.evaluate(() =>
      (window as any).calls.some((call: any) => /schedules\/(create|update)/.test(call.type)),
    ),
  ).toBe(false);
});

for (const appearance of ["wiskey-light", "wiskey-dark"]) {
  test(`embed fills a short iframe host in ${appearance} without viewport-height offset`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const frame = await openHost(page, "embed=1&tab=tools");
    await page.locator("iframe").evaluate((element) => {
      element.style.height = "500px";
    });
    await frame.evaluate((appearance) => {
      (window as any).demoData.appearance_settings.default = appearance;
      (window as any).demoNotify();
    }, appearance);
    await expect(frame.locator("hikvision-intercom-panel")).toHaveAttribute(
      "data-appearance",
      appearance,
    );
    const sizes = await frame.evaluate(() => {
      const panel = document.querySelector("hikvision-intercom-panel")!;
      const main = panel.shadowRoot!.querySelector("main")!;
      return {
        panelMin: getComputedStyle(panel).minHeight,
        mainWidth: main.getBoundingClientRect().width,
        mainLeft: main.getBoundingClientRect().left,
        width: innerWidth,
        height: panel.getBoundingClientRect().height,
      };
    });
    expect(sizes.height).toBe(500);
    expect(sizes.panelMin).toBe("100%");
    expect(sizes.mainLeft).toBe(0);
    expect(sizes.mainWidth).toBe(sizes.width);
  });
}

for (const width of [390, 1440]) {
  test(`embedded hub, appearance and user editor remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const frame = await openHost(page, "embed=1&tab=tools&lang=he");
    await frame.locator(".tools-grid .appearance-button").click();
    const picker = frame.locator("hikvision-appearance-picker");
    await expect(picker.getByRole("dialog")).toBeVisible();
    await picker.getByRole("button", { name: "ביטול", exact: true }).click();
    await navigate(page, "users");
    await expect(view(frame)).toHaveAttribute("data-view", "users");
    await frame.getByRole("button", { name: "+ הוספת משתמש", exact: true }).click();
    await expect(frame.getByRole("dialog")).toBeVisible();
    await frame.getByRole("dialog").getByRole("button", { name: "ביטול", exact: true }).click();
    expect(
      await view(frame).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: `test-results/embed-${width}.png`, fullPage: true });
  });
}

test("VMS reference adapter negotiates, navigates, refreshes and disposes without internal panel calls", async ({
  page,
}) => {
  await page.goto("/embed-host.html");
  await page.evaluate(async () => {
    const { attachWiskey } = await import("/wiskey-embed-client.mjs");
    (window as any).adapterEvents = [];
    (window as any).adapter = attachWiskey(document.querySelector("iframe"), {
      initial: { tab: "events", tool: null },
      onReady: (value: unknown) => (window as any).adapterEvents.push({ type: "ready", value }),
      onLocation: (value: unknown) =>
        (window as any).adapterEvents.push({ type: "location", value }),
      onTitle: (value: unknown) => (window as any).adapterEvents.push({ type: "title", value }),
    });
  });
  const readyCount = () =>
    page.evaluate(
      () => (window as any).adapterEvents.filter((e: any) => e.type === "ready").length,
    );
  await expect.poll(readyCount).toBe(1);
  const frame = page.frames().find((frame) => frame.url().includes("/hikvision-intercom"))!;
  await expect(view(frame)).toHaveAttribute("data-view", "events");
  expect(
    await page.evaluate(() =>
      (window as any).adapter.navigate({ tab: "tools", tool: "media_options" }),
    ),
  ).toBe(true);
  await expect(view(frame)).toHaveAttribute("data-view", "media_options");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).adapterEvents.filter((e: any) => e.type === "location").at(-1).value,
      ),
    )
    .toEqual({ tab: "tools", tool: "media_options" });
  expect(await page.evaluate(() => (window as any).adapter.navigate({ tab: "bad-screen" }))).toBe(
    false,
  );
  await page.evaluate(() => (window as any).adapter.refresh());
  await expect.poll(readyCount).toBe(2);
  await expect(view(frame)).toHaveAttribute("data-view", "media_options");
  await page.evaluate(() => (window as any).adapter.dispose());
  const count = await page.evaluate(() => (window as any).adapterEvents.length);
  await frame.evaluate(() =>
    window.parent.postMessage({ type: "wiskey:title", text: "After dispose" }, location.origin),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => (window as any).adapterEvents.length)).toBe(count);
});

test("VMS reference adapter rejects forged-origin and sibling messages", async ({ page }) => {
  await page.goto("/embed-host.html");
  await page.evaluate(async () => {
    const { attachWiskey } = await import("/wiskey-embed-client.mjs");
    (window as any).adapterEvents = [];
    (window as any).adapter = attachWiskey(document.querySelector("iframe"), {
      onReady: () => (window as any).adapterEvents.push("ready"),
      onTitle: (text: string) => (window as any).adapterEvents.push(text),
      onLegacy: () => (window as any).adapterEvents.push("legacy"),
      onWaiting: () => (window as any).adapterEvents.push("waiting"),
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).adapterEvents.includes("ready")))
    .toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://other.example",
        source: document.querySelector("iframe")!.contentWindow,
        data: { type: "wiskey:title", text: "Forged" },
      }),
    );
    window.postMessage({ type: "wiskey:title", text: "Sibling" }, location.origin);
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const events = await page.evaluate(() => (window as any).adapterEvents);
  for (const unexpected of ["Forged", "Sibling", "legacy"])
    expect(events).not.toContain(unexpected);
});

for (const scenario of [
  { marker: 'data-embed-api="1"', root: true, result: "waiting" },
  { marker: "", root: true, result: "legacy" },
  { marker: "", root: false, result: "waiting" },
]) {
  test(`VMS timeout uses ${scenario.result} for ${scenario.root ? scenario.marker || "old panel" : "login without panel"}`, async ({
    page,
  }) => {
    await page.route("**/hikvision-intercom*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><body>${scenario.root ? `<hikvision-intercom-panel ${scenario.marker}></hikvision-intercom-panel>` : "Sign in"}</body></html>`,
      }),
    );
    await page.clock.install();
    await page.goto("/embed-host.html");
    await page.evaluate(async () => {
      const { attachWiskey } = await import("/wiskey-embed-client.mjs");
      (window as any).adapterEvents = [];
      (window as any).adapter = attachWiskey(document.querySelector("iframe"), {
        onLegacy: () => (window as any).adapterEvents.push("legacy"),
        onWaiting: () => (window as any).adapterEvents.push("waiting"),
      });
    });
    await expect(page.frameLocator("iframe").locator("body")).toBeVisible();
    await page.clock.fastForward(13000);
    await expect
      .poll(() => page.evaluate(() => (window as any).adapterEvents))
      .toEqual([scenario.result]);
  });
}
