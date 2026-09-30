import { chromium } from "../../../frontend/node_modules/@playwright/test/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const p = await b.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [],
  external = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("request", (r) => {
  if (/^https?:/.test(r.url())) external.push(r.url());
});
await p.goto(new URL("index.html?freeze=1", import.meta.url).href);
const screens = await p.evaluate(() => SCREENS);
const ids = new Set(screens.map((x) => x[0]));
const mobileIds = [
  "overview",
  "people",
  "person",
  "person-edit",
  "person-timing",
  "credentials",
  "station",
  "programs",
  "call",
  "whatsapp",
  "chat",
  "sync",
  "management",
  "appearance",
];
const tabletIds = [
  "overview",
  "people",
  "person",
  "station",
  "call",
  "person-timing",
];
const results = [],
  files = [];
for (const [device, w, h] of [
  ["desktop", 1440, 900],
  ["tablet", 1024, 900],
  ["mobile", 390, 844],
]) {
  for (const theme of ["light", "dark"]) {
    await p.setViewportSize({ width: w, height: h });
    await fs.mkdir(path.join(root, "images", `${device}-${theme}`), {
      recursive: true,
    });
    for (const [id] of screens) {
      await p.goto(
        new URL(`index.html?freeze=1&theme=${theme}#${id}`, import.meta.url)
          .href,
      );
      await p.evaluate(() => document.fonts.ready);
      const m = await p.evaluate(
        ({ id, device, theme, w, h }) => {
          const rect = (e) => {
            const r = e.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };
          return {
            id,
            device,
            theme,
            width: w,
            height: h,
            pageHeight: document.documentElement.scrollHeight,
            rootOverflow: document.documentElement.scrollWidth > w + 1,
            title: document.querySelector("h1")?.textContent,
            grants: [...document.querySelectorAll(".grant")].map(rect),
            video:
              document.querySelector(".call-stage") &&
              rect(document.querySelector(".call-stage")),
            tts:
              document.querySelector(".tts") &&
              rect(document.querySelector(".tts")),
            visibleDoors: [...document.querySelectorAll(".door-tile")].filter(
              (e) =>
                e.getBoundingClientRect().bottom <
                h - (device === "mobile" ? 64 : 0),
            ).length,
            unknownLinks: [...document.querySelectorAll('a[href^="#"]')].map(
              (a) => a.hash.slice(1),
            ),
          };
        },
        { id, device, theme, w, h },
      );
      m.unknownLinks = m.unknownLinks.filter((x) => !ids.has(x));
      results.push(m);
      if (
        device === "desktop" ||
        (device === "mobile" && mobileIds.includes(id)) ||
        (device === "tablet" && tabletIds.includes(id))
      ) {
        const relative = `images/${device}-${theme}/${id}.png`;
        await p.screenshot({ path: path.join(root, relative), fullPage: true });
        files.push({
          id,
          device,
          theme,
          path: relative,
          width: w,
          height: m.pageHeight,
        });
        if (device === "mobile") {
          const relativeFirst = `images/${device}-${theme}/${id}-viewport.png`;
          await p.screenshot({
            path: path.join(root, relativeFirst),
            fullPage: false,
          });
          files.push({
            id,
            device,
            theme,
            path: relativeFirst,
            width: w,
            height: h,
            viewport: true,
          });
        }
      }
    }
    console.log(`${device}/${theme}: ${screens.length} screens checked`);
  }
}
// Further constrained widths: root overflow / UI safety only, not falsely claiming field tests.
for (const [w, h] of [
  [360, 800],
  [1366, 768],
]) {
  await p.setViewportSize({ width: w, height: h });
  for (const [id] of screens) {
    await p.goto(new URL(`index.html?freeze=1#${id}`, import.meta.url).href);
    await p.evaluate(() => document.fonts.ready);
    results.push(
      await p.evaluate(
        ({ id, w, h }) => ({
          id,
          device: "extra",
          theme: "light",
          width: w,
          height: h,
          rootOverflow: document.documentElement.scrollWidth > w + 1,
          pageHeight: document.documentElement.scrollHeight,
        }),
        { id, w, h },
      ),
    );
  }
}
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(new URL("index.html?freeze=1#people", import.meta.url).href);
await p.locator("[data-search]").fill("מיה");
const searchFilters =
  (await p.locator(".people-table [data-person-row]:visible").count()) === 1;
await p.locator("[data-search]").fill("nothing-found");
const emptySearch = await p.locator("#no-results").isVisible();
await p.goto(new URL("index.html?freeze=1#person", import.meta.url).href);
await p.locator('.topbar a[href="#activity"]').click();
const routeIsolation =
  (await p.locator("h1").textContent()) === "פעילות" &&
  (await p.locator(".editor-footer").count()) === 0;
await p.goto(new URL("index.html?freeze=1#call", import.meta.url).href);
await p.locator("[data-listen]").click();
const listenLabel =
  (await p.locator("[data-listen-label]").textContent()) === "סגור האזנה";
await p.locator("[data-mic]").click();
const micLabel =
  (await p.locator("[data-mic-label]").textContent()) === "סגור דיבור";
await p.locator("[data-tts]").click();
const safeTts = (await p.locator("#tts-status").textContent()).includes(
  "לא נוצר",
);
await p.goto(new URL("index.html?freeze=1#whatsapp", import.meta.url).href);
await p.locator("#message-text").fill("הודעה ערוכה לדוגמה");
const preview =
  (await p.locator("#message-preview").textContent()) === "הודעה ערוכה לדוגמה";
await p.locator("[data-send]").click();
const safeSend = (await p.locator("#toast").textContent()).includes("לא נשלחה");
await p.locator("[data-theme-toggle]").click();
const themeToggle =
  (await p.locator("html").getAttribute("data-theme")) === "dark";
const checks = {
  searchFilters,
  emptySearch,
  routeIsolation,
  listenLabel,
  micLabel,
  safeTts,
  preview,
  safeSend,
  themeToggle,
};
const report = {
  generatedAt: new Date().toISOString(),
  baseVersion: "1.9.3",
  screens: screens.length,
  imageFiles: files.length,
  errors,
  externalRequests: external,
  checks,
  results,
};
await fs.writeFile(
  path.join(root, "qa", "VALIDATION.json"),
  JSON.stringify(report, null, 2),
);
await fs.writeFile(
  path.join(root, "screens.json"),
  JSON.stringify({ screens, files }, null, 2),
);
console.log(
  JSON.stringify(
    {
      screens: screens.length,
      images: files.length,
      errors,
      checks,
      overflow: results.filter((x) => x.rootOverflow),
      badLinks: results.filter((x) => x.unknownLinks?.length),
      coreFits: results
        .filter(
          (x) =>
            x.device === "desktop" &&
            x.theme === "light" &&
            ["overview", "overview-12", "people", "person", "call"].includes(
              x.id,
            ),
        )
        .map((x) => ({
          id: x.id,
          height: x.pageHeight,
          doors: x.visibleDoors,
        })),
    },
    null,
    2,
  ),
);
await b.close();
if (
  errors.length ||
  external.length ||
  results.some((x) => x.rootOverflow || x.unknownLinks?.length) ||
  Object.values(checks).includes(false)
)
  process.exitCode = 1;
