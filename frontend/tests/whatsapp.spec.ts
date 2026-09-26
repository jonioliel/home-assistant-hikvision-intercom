import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

async function setup(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.users[0].phone = "+972511231234";
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (msg: Record<string, unknown>) => {
      if (!(msg.type as string).includes("/whatsapp/")) return original(msg);
      window.calls.push(msg);
      const command = (msg.type as string).split("/").pop();
      if (command === "status")
        return { available: true, history: true, accounts: [{ id: "wa", name: "Reception" }] };
      if (command === "preview")
        return {
          token: "preview-token",
          recipient: "+972511231234",
          message: "Hello Demo, your access code is 654321. Monday 12:00–18:00.",
        };
      if (command === "history")
        return {
          messages: [
            {
              id: "m1",
              outgoing: false,
              text: "Hello <script>safe text</script>",
              caption: "",
              timestamp: 1780000000,
              kind: "text",
              media_token: null,
            },
          ],
        };
      return { accepted: true };
    };
    window.demoNotify();
  });
  await navigate(page, "Users");
  await page.locator(".desktop-users .user-detail-link").first().click();
}

test("access message requires editable preview and explicit send", async ({ page }) => {
  await setup(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("051-123-1234", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Send access details via WhatsApp" }).click();
  const draft = dialog.getByRole("textbox", { name: "Review and edit before sending" });
  await expect(draft).toContainText("");
  await expect(draft).toHaveValue(/654321/);
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("whatsapp/send")).length),
  ).toBe(0);
  await draft.fill("An edited message");
  await dialog.getByRole("button", { name: "Confirm and send" }).click();
  await expect(dialog.getByRole("status")).toContainText("accepted");
  const sends = await page.evaluate(() =>
    window.calls.filter((c) => c.type.endsWith("whatsapp/send")),
  );
  expect(sends).toHaveLength(1);
  expect(sends[0].message).toBe("An edited message");
  expect(sends[0].confirmed).toBe(true);
  await expect(draft).toHaveCount(0);
});

test("chat escapes text and close discards unsent PIN draft", async ({ page }) => {
  await setup(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "WhatsApp conversation", exact: true }).click();
  await expect(dialog.locator(".bubble")).toContainText("<script>safe text</script>");
  await expect(dialog.locator(".bubble script")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Send access details via WhatsApp" }).click();
  await expect(dialog.locator("textarea")).toHaveValue(/654321/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("whatsapp/send"))),
  ).toBe(false);
});

for (const width of [390, 768, 1440]) {
  test(`user details fit at ${width}px and phone remains one line`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      window.demoData.users[0].phone = "0511231234";
      window.demoNotify();
    });
    await navigate(page, "Users");
    const links = page.locator(
      width < 700 ? ".mobile-users .user-detail-link" : ".desktop-users .user-detail-link",
    );
    await links.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("051-123-1234", { exact: true })).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("a user revision change discards the prepared access message", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Send access details via WhatsApp" }).click();
  await expect(page.getByRole("dialog").locator("textarea")).toHaveValue(/654321/);
  await page.evaluate(() => {
    window.demoData.users[0].revision++;
    window.demoNotify();
  });
  await expect(page.getByRole("dialog").locator("textarea")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("whatsapp/send"))),
  ).toBe(false);
});

test("stored image loads through the bridge without exposing upstream URLs", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const original = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (msg: Record<string, unknown>) => {
      if (msg.type === "hikvision_intercom/whatsapp/history")
        return {
          messages: [
            {
              id: "image",
              outgoing: false,
              text: "",
              caption: "Demo photo",
              timestamp: 1780000000,
              kind: "image",
              media_token: "media-token",
            },
          ],
        };
      if (msg.type === "hikvision_intercom/whatsapp/media")
        return {
          mime: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        };
      return original(msg);
    };
  });
  await page.getByRole("button", { name: "WhatsApp conversation", exact: true }).click();
  await page.getByRole("button", { name: /Load attachment/ }).click();
  await expect(page.getByRole("dialog").locator(".bubble img")).toHaveAttribute("src", /^blob:/);
});
