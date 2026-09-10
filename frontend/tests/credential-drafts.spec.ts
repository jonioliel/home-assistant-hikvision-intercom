import { test, expect } from "@playwright/test";

for (const restore of [false, true]) {
  test(`removing a PIN clears typed replacement fields${restore ? " before keeping the saved PIN" : ""}`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Users", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New PIN", { exact: true }).fill("274916");
    await dialog.getByLabel("Confirm PIN", { exact: true }).fill("274916");
    await dialog.getByRole("button", { name: "Remove PIN", exact: true }).click();
    await expect(dialog.getByLabel("New PIN", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("Confirm PIN", { exact: true })).toHaveValue("");
    if (restore)
      await dialog.getByRole("button", { name: "Keep current PIN", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const sent = await page.evaluate(() =>
      (window as any).calls.find((c: any) => c.type.endsWith("users/update")),
    );
    if (restore) expect(sent.data).not.toHaveProperty("pin");
    else expect(sent.data.pin).toBeNull();
  });
}
