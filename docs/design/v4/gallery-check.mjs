import { fileURLToPath } from "node:url";
import { chromium } from "../../../frontend/node_modules/@playwright/test/index.mjs";
import fs from "node:fs/promises";
const b = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  }),
  p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(new URL("gallery.html", import.meta.url).href);
await p.evaluate(() => document.fonts.ready);
const featured = await p.locator(".screen-card").count();
await p.locator("[data-open]").first().click();
const modal = await p.locator("dialog").isVisible();
await p.keyboard.press("Escape");
const escapeClosed = !(await p.locator("dialog").isVisible());
await p.locator("#category").selectOption("everything");
const all = await p.locator(".screen-card").count();
await p.locator("#theme").selectOption("dark");
const dark = await p.locator(".thumb img").first().getAttribute("src");
await p.locator("#device").selectOption("mobile");
const mobile = await p.locator(".screen-card").count();
await p.locator("#query").fill("קולית");
const search = await p.locator(".screen-card").count();
await p.locator("#query").fill("");
await p.setViewportSize({ width: 390, height: 844 });
const overflow = await p.evaluate(
  () => document.documentElement.scrollWidth > 390,
);
await p.locator("#device").selectOption("desktop");
await p.locator("#theme").selectOption("light");
await p.locator("#category").selectOption("featured");
await p.setViewportSize({ width: 1440, height: 1000 });
await p.screenshot({
  path: fileURLToPath(new URL("qa/gallery.png", import.meta.url)),
});
const contrast = [];
for (const theme of ["light", "dark"]) {
  await p.goto(
    new URL(`index.html?theme=${theme}&freeze=1#overview`, import.meta.url)
      .href,
  );
  contrast.push(
    await p.evaluate((theme) => {
      const s = getComputedStyle(document.documentElement);
      const lum = (h) => {
        const v = h
          .trim()
          .replace("#", "")
          .replace(/^([0-9a-f])([0-9a-f])([0-9a-f])$/i, "$1$1$2$2$3$3")
          .match(/../g)
          .map((v) => parseInt(v, 16) / 255)
          .map((x) =>
            x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
          );
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const pairs = [
        ["--ink", "--surface"],
        ["--muted", "--surface"],
        ["--muted", "--bg"],
        ["--accent", "--surface"],
        ["--on-accent", "--accent"],
        ["--green", "--green-soft"],
        ["--amber", "--amber-soft"],
        ["--red", "--red-soft"],
      ];
      return {
        theme,
        pairs: pairs.map(([a, b]) => {
          const l1 = lum(s.getPropertyValue(a)),
            l2 = lum(s.getPropertyValue(b));
          return {
            a,
            b,
            ratio:
              Math.round(
                ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100,
              ) / 100,
          };
        }),
      };
    }, theme),
  );
}
const result = {
  featured,
  all,
  mobile,
  search,
  modal,
  escapeClosed,
  themeWorks: dark.includes("dark"),
  overflow,
  errors,
  contrast,
};
await fs.writeFile(
  new URL("qa/GALLERY_VALIDATION.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
await b.close();
if (
  featured !== 12 ||
  all !== 49 ||
  mobile !== 14 ||
  !modal ||
  !escapeClosed ||
  overflow ||
  errors.length ||
  search !== 1 ||
  contrast.some((x) => x.pairs.some((p) => !p.ratio || p.ratio < 4.5))
)
  process.exitCode = 1;
