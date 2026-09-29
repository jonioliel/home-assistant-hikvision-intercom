import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [390, 1440]) {
  test(`type change requires explicit impact review at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      window.demoData.profile_settings.fields = [
        { id: "room", label: "Room", enabled: true, options: [], type: "text", required: false },
      ];
      window.demoData.users[0].profile = { room: "Legacy" };
      window.fixtureFieldChanges = [
        {
          field_id: "room",
          label: "Room",
          before: {
            id: "room",
            label: "Room",
            enabled: true,
            type: "text",
            required: false,
            options: [],
          },
          after: {
            id: "room",
            label: "Room",
            enabled: true,
            type: "number",
            required: false,
            options: [],
          },
          checked: 3,
          missing: 0,
          invalid: 1,
          previous_issues: 0,
          template_issues: 0,
          examples: [
            {
              user_id: "u1",
              display_name: "Example",
              employee_no: "1001",
              reason: "profile_value_invalid",
              archived: false,
            },
          ],
          examples_truncated: false,
        },
      ];
      window.demoNotify();
    });
    await navigate(page, "User profile options");
    const settings = page.locator("hikvision-profile-settings");
    await settings
      .getByRole("combobox", { name: "Field type", exact: true })
      .selectOption("number");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    const review = settings.getByRole("region", { name: "Review fields and group permissions" });
    await expect(review).toContainText("Values outside the proposed rules: 1");
    await expect(review).toContainText("preserved without conversion");
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => c.type === "hikvision_intercom/profiles/settings_apply"),
      ),
    ).toBe(false);
    expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => window.demoData.profile_settings.fields[0].type)).toBe("text");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await review.getByRole("button", { name: "Apply reviewed policy" }).click();
    await expect(settings.getByRole("status")).toContainText("Saved");
    expect(await page.evaluate(() => window.demoData.users[0].profile.room)).toBe("Legacy");
  });
}
