import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

for (const width of [360, 1440]) {
  test(`CSV mappings survive preview and invalidate after editing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await page.evaluate(() => {
      window.demoData.profile_settings = {
        revision: 1,
        fields: [{ id: "dept", label: "Department", enabled: true, options: [] }],
        groups: [],
        photo_enabled: false,
      };
      window.demoNotify();
      const base = window.demoHass.callWS.bind(window.demoHass);
      window.demoHass.callWS = async (message) => {
        if (message.type.endsWith("users/csv_inspect")) {
          window.calls.push(message);
          return {
            headers: ["Number", "Name", "Department"],
            mapping: { Number: "", Name: "", Department: "" },
          };
        }
        return base(message);
      };
    });
    await navigate(page, "Users");
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("CSV file").setInputFiles({
      name: "mapped.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Number,Name,Department\n123,Example,Staff\n"),
    });
    const mapping = dialog.locator(".csv-mapping");
    await mapping.getByLabel("Number", { exact: true }).selectOption("employee_no");
    await mapping.getByLabel("Name", { exact: true }).selectOption("display_name");
    await mapping.getByLabel("Department", { exact: true }).selectOption("profile:dept");
    await dialog.getByRole("button", { name: "Preview changes" }).click();
    await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeEnabled();
    expect(
      await page.evaluate(
        () => window.calls.findLast((call) => call.type.endsWith("users/csv_preview"))?.column_map,
      ),
    ).toEqual({ Number: "employee_no", Name: "display_name", Department: "profile:dept" });
    await mapping.getByLabel("Department", { exact: true }).selectOption("");
    await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
}

test("CSV errors download only line, canonical column and error code", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const base = window.demoHass.callWS.bind(window.demoHass);
    window.demoHass.callWS = async (message) => {
      if (!message.type.endsWith("users/csv_preview")) return base(message);
      window.calls.push(message);
      return {
        review_token: null,
        counts: { create: 0, update: 0, unchanged: 0 },
        rows: [],
        errors: [
          { line: 2, column: "pin", code: "invalid_pin" },
          { line: 3, column: "group_ids", code: "csv_group_unknown" },
        ],
      };
    };
  });
  await navigate(page, "Users");
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("CSV file").setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("employee_no,display_name,pin\n123,Example,PRIVATE-PIN\n"),
  });
  await dialog.getByRole("button", { name: "Preview changes" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download row error report" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const report = Buffer.concat(chunks).toString();
  expect(report).toContain('"column": "pin"');
  expect(report).not.toContain("PRIVATE-PIN");
  await expect(dialog.getByRole("button", { name: "Apply & sync batch" })).toBeDisabled();
});
