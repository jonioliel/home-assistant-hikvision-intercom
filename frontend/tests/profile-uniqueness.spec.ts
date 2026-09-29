import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [390, 1440]) {
  test(`conflicting uniqueness cannot be applied at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => {
      const field = {
        id: "external",
        label: "External identity",
        enabled: true,
        options: [],
        type: "text",
        unique: false,
      };
      window.demoData.profile_settings.fields = [field];
      window.fixtureCanApply = false;
      window.fixtureFieldChanges = [
        {
          field_id: field.id,
          label: field.label,
          before: field,
          after: { ...field, unique: true },
          checked: 2,
          missing: 0,
          invalid: 0,
          previous_issues: 0,
          template_issues: 0,
          examples: [],
          examples_truncated: false,
          duplicates: 2,
          duplicate_examples: [
            {
              user_id: "u1",
              display_name: "Example",
              employee_no: "1001",
              archived: true,
              retiring: false,
            },
          ],
          duplicate_examples_truncated: false,
        },
      ];
      window.demoNotify();
    });
    await navigate(page, "User profile options");
    const settings = page.locator("hikvision-profile-settings");
    await settings.getByLabel("Unique across people and archive", { exact: true }).check();
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    const review = settings.getByRole("region", { name: "Review fields and group permissions" });
    await expect(review).toContainText("Conflicting identities: 2");
    await expect(review.getByRole("button", { name: "Apply reviewed policy" })).toBeDisabled();
    await review.getByText("People with conflicting values (up to 20)", { exact: true }).click();
    await expect(review).toContainText("Example");
    expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      await page.evaluate(() =>
        window.calls.some((c) => c.type === "hikvision_intercom/profiles/settings_apply"),
      ),
    ).toBe(false);
    expect(await page.evaluate(() => window.demoData.profile_settings.fields[0].unique)).toBe(
      false,
    );
  });
}
