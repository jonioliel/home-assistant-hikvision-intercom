import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation";
async function configure(page: Page, photo = false) {
  await page.goto("/");
  await page.evaluate((photo) => {
    window.demoData.profile_settings = {
      revision: 1,
      photo_enabled: photo,
      fields: [
        { id: "dept", label: "Department", enabled: true, options: ["Staff", "Maintenance"] },
        { id: "role", label: "Role", enabled: true, options: [] },
      ],
      groups: [
        { id: "team", label: "Team", enabled: true },
        { id: "floor", label: "Floor", enabled: true },
      ],
    };
    window.demoNotify();
  }, photo);
  await navigate(page, "Users");
}
async function edit(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  return page.getByRole("dialog");
}
async function camera(page: Page) {
  await page.evaluate(() => {
    window.photoTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#306fbd";
      ctx.fillRect(0, 0, 256, 256);
      const stream = canvas.captureStream(5);
      window.photoTracks.push(...stream.getTracks());
      return stream;
    };
  });
}
test("row has only edit and sync; unsaved edits guard editor actions", async ({ page }) => {
  await configure(page);
  const row = page.locator(".desktop-users tbody tr").first();
  await expect(row.locator("button")).toHaveText(["Edit", "Sync now"]);
  const dialog = await edit(page);
  await expect(dialog.getByRole("button", { name: "Read card from station" })).toBeVisible();
  await dialog.getByLabel("Department", { exact: true }).fill("Staff");
  await dialog.getByRole("button", { name: "User change history" }).click();
  await expect(dialog).toContainText("Save or discard your edits");
  await expect(dialog.getByLabel("Department", { exact: true })).toHaveValue("Staff");
});
test("custom values and multiple groups persist and filter users", async ({ page }) => {
  await configure(page);
  const dialog = await edit(page);
  await dialog.getByLabel("Department", { exact: true }).fill("Staff");
  await dialog.getByLabel("Role", { exact: true }).fill("Guide");
  await dialog.getByLabel("Team", { exact: true }).check();
  await dialog.getByLabel("Floor", { exact: true }).check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".user-filters > summary").click();
  await page
    .locator(".profile-filters")
    .getByLabel("Department", { exact: true })
    .selectOption("Staff");
  await page.locator(".profile-filters").getByLabel("Groups", { exact: true }).selectOption("team");
  await expect(page.locator(".desktop-users tbody tr")).toHaveCount(1);
  const again = await edit(page);
  await expect(again.getByLabel("Role", { exact: true })).toHaveValue("Guide");
  await expect(again.getByLabel("Floor", { exact: true })).toBeChecked();
});
test("field rename keeps identity and values; global photo option saves", async ({ page }) => {
  await configure(page);
  await page.evaluate(() => {
    window.demoData.users[0].profile = { dept: "101" };
    window.demoNotify();
  });
  await navigate(page, "User profile options");
  const settings = page.locator("hikvision-profile-settings");
  await settings.getByLabel("Field name", { exact: true }).first().fill("Apartment");
  await settings.getByLabel("Allow user photo capture").check();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("Saved");
  await navigate(page, "Users");
  const dialog = await edit(page);
  await expect(dialog.getByLabel("Apartment", { exact: true })).toHaveValue("101");
  await expect(dialog.getByRole("button", { name: "Open camera", exact: true })).toBeVisible();
});
test("camera capture retake use and remove are explicit; tracks close", async ({ page }) => {
  await configure(page, true);
  await camera(page);
  const dialog = await edit(page);
  const photo = dialog.locator("hikvision-user-photo");
  await photo.getByRole("button", { name: "Open camera", exact: true }).click();
  await photo.getByRole("button", { name: "Capture photo", exact: true }).click();
  expect(await page.evaluate(() => window.photoTracks[0].readyState)).toBe("ended");
  await expect(photo.getByRole("img", { name: "Photo preview", exact: true })).toBeVisible();
  await photo.getByRole("button", { name: "Discard and retake" }).click();
  await photo.getByRole("button", { name: "Capture photo", exact: true }).click();
  await photo.getByRole("button", { name: "Use this photo" }).click();
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c.type === "hikvision_intercom/users/update").length,
    ),
  ).toBe(0);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const payload = await page.evaluate(
    () => window.calls.find((c) => c.type === "hikvision_intercom/users/update").data.photo,
  );
  expect(payload).toMatch(/^data:image\/jpeg;base64,/);
  expect(payload.length).toBeLessThan(44000);
  expect(await page.evaluate(() => JSON.stringify(window.demoData))).not.toContain(payload);
  const reopened = await edit(page);
  await expect(reopened.locator("hikvision-user-photo").getByRole("img")).toBeVisible();
  await reopened.getByRole("button", { name: "Remove user photo" }).click();
  await reopened.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => window.demoData.users[0].photo_configured)).toBe(false);
});
for (const reason of ["close", "hidden", "denied"]) {
  test(`camera cleanup: ${reason}`, async ({ page }) => {
    await configure(page, true);
    await camera(page);
    if (reason === "denied")
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw Error("permission");
        };
      });
    const dialog = await edit(page);
    await dialog.getByRole("button", { name: "Open camera", exact: true }).click();
    if (reason === "denied") {
      await expect(dialog).toContainText("Could not open the camera");
      return;
    }
    await expect(dialog.getByRole("button", { name: "Capture photo", exact: true })).toBeEnabled();
    if (reason === "close")
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    else
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    expect(
      await page.evaluate(() => window.photoTracks.every((t) => t.readyState === "ended")),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => c.type === "hikvision_intercom/users/update"),
      ),
    ).toBe(false);
  });
}
for (const width of [360, 768, 1440]) {
  test(`profile options and editor fit Hebrew ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?lang=he");
    await page.evaluate(() => {
      const p = document.querySelector("hikvision-intercom-panel");
      p._appearance = "modern";
    });
    await navigate(page, "אפשרויות פרטי משתמש");
    const form = page.locator("hikvision-profile-settings");
    await form.getByRole("button", { name: "הוספת שדה משתמש" }).click();
    await form.getByLabel("שם השדה", { exact: true }).fill("מחלקה");
    await form.getByLabel("לאפשר קליטת תמונת משתמש").check();
    await form.getByRole("button", { name: "שמירה", exact: true }).click();
    expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (width === 1440)
      await page.screenshot({ path: "test-results/profiles-options-he.png", fullPage: true });
    await navigate(page, "משתמשים");
    await page.getByRole("button", { name: "עריכה", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("מחלקה", { exact: true })).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (width === 1440)
      await page.screenshot({ path: "test-results/profiles-editor-he.png", fullPage: true });
  });
}

test("discover add-on then select it for both RTC and MSE", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Camera playback options");
  const form = page.locator("hikvision-media-settings");
  await form.getByRole("button", { name: "Find installed go2rtc add-on" }).click();
  await expect(form.getByLabel("go2rtc server address (RTC and MSE)")).toHaveValue(
    "http://a889bffc-go2rtc-hardware:1984",
  );
  await expect(form).toContainText("1.9.14");
  await form.getByRole("button", { name: "Save for all cameras" }).click();
  expect(await page.evaluate(() => window.demoData.media_settings.go2rtc_url)).toBe(
    "http://a889bffc-go2rtc-hardware:1984",
  );
});
