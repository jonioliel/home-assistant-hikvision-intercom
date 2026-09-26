import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

const defaults = {
  organization: "מתנ״ס אפרת",
  he_unrestricted:
    "שלום {{name}}, 🥇\n\n🏫 {{organization}}\nקוד הגישה האישי שלך:\n📟 {{pin}} 📟\n\n{{doors_section}}אין להעביר את הקוד לאחרים.",
  he_scheduled:
    "שלום {{name}}, 🥇\n\n🏫 {{organization}}\nקוד הגישה האישי שלך:\n📟 {{pin}} 📟\n\n{{doors_section}}{{access_window_section}}אין להעביר את הקוד לאחרים.",
  en_unrestricted: "Hello {{name}}\n{{organization}}\n{{pin}}\n{{doors_section}}",
  en_scheduled:
    "Hello {{name}}\n{{organization}}\n{{pin}}\n{{doors_section}}{{access_window_section}}",
};
const placeholders = ["name", "organization", "pin", "doors_section", "access_window_section"];

async function installApi(page) {
  await page.evaluate(
    ({ defaults, placeholders }) => {
      let revision = 0;
      let values = structuredClone(defaults);
      const base = window.demoHass.callWS.bind(window.demoHass);
      window.demoHass.callWS = async (message) => {
        if (message.type === "hikvision_intercom/whatsapp/templates_get")
          return { revision, ...structuredClone(values), defaults, placeholders };
        if (message.type === "hikvision_intercom/whatsapp/templates_update") {
          window.calls.push(structuredClone(message));
          if (message.revision !== revision) throw { code: "revision_conflict" };
          values = structuredClone(message.values);
          revision++;
          return { revision, ...structuredClone(values), defaults, placeholders };
        }
        return base(message);
      };
    },
    { defaults, placeholders },
  );
}

test("administrator edits, previews and saves WhatsApp templates", async ({ page }) => {
  await page.goto("/?lang=he");
  await installApi(page);
  await navigate(page, "תבניות הודעות WhatsApp");
  const editor = page.locator("wiskey-whatsapp-templates");
  await expect(editor.getByLabel("שם הארגון בהודעות")).toHaveValue("מתנ״ס אפרת");
  await expect(editor.getByLabel("תצוגה מקדימה לדוגמה")).toContainText("יהונתן אוליאל");
  await editor.getByLabel("סוג ההרשאה").selectOption("scheduled");
  await expect(editor.getByLabel("תצוגה מקדימה לדוגמה")).toContainText("שני, שלישי, חמישי");
  await editor.getByLabel("שם הארגון בהודעות").fill("המרכז הקהילתי");
  await editor.getByRole("button", { name: "שמירה" }).click();
  await expect(editor).toContainText("תבניות הודעות WhatsApp נשמרו");
  const update = await page.evaluate(() =>
    window.calls.findLast((call) => call.type.endsWith("templates_update")),
  );
  expect(update.values.organization).toBe("המרכז הקהילתי");
});

test("template editor fits a mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/?lang=he");
  await installApi(page);
  await navigate(page, "תבניות הודעות WhatsApp");
  const editor = page.locator("wiskey-whatsapp-templates");
  await expect(editor.getByRole("button", { name: "שמירה" })).toBeVisible();
  expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBeTruthy();
});
