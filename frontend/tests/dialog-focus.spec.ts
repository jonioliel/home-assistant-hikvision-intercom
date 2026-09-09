import { test, expect } from "@playwright/test";

for (const method of ["button", "escape"] as const) {
  test(`closing the user editor by ${method} restores keyboard focus to its opener`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Users", exact: true }).click();
    const opener = page.getByRole("button", { name: "+ Add user", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Unsaved draft");
    if (method === "button")
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.evaluate(() => window.demoNotify());
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.calls.filter((c) => /users\/(create|update)$/.test(c.type)).length,
      ),
    ).toBe(0);
  });
}

test("saving the editor restores focus after the opening button becomes enabled again", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  const opener = page.getByRole("button", { name: "+ Add user", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Focus return resident");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(() => window.calls.filter((c) => c.type.endsWith("users/create")).length),
  ).toBe(1);
});
