import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";
async function setup(page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.demoData.profile_settings = {
      revision: 1,
      fields: [
        { id: "dept", label: "Department", enabled: true, options: [] },
        { id: "role", label: "Role", enabled: true, options: [] },
      ],
      groups: [],
      photo_enabled: false,
    };
    window.demoNotify();
  });
  await navigate(page, "Users");
}
test("saved view restores filters and custom column order across field rename", async ({
  page,
}) => {
  await setup(page);
  const views = page.locator("wiskey-saved-user-views");
  await views.locator("summary").click();
  await page.locator(".user-filters > summary").click();
  await page.getByRole("combobox", { name: "Filter by user state" }).selectOption("active");
  await views.getByRole("button", { name: "Move earlier Role", exact: true }).click();
  await expect(page.locator(".desktop-users th.custom-user-field")).toHaveText([
    "Role",
    "Department",
  ]);
  await views.getByRole("textbox", { name: "View name", exact: true }).fill("Active staff");
  await views.getByRole("button", { name: "Save current view" }).click();
  const saved = await page.evaluate(() => localStorage.getItem("wiskey:user-views:v1:demo-admin"));
  expect(JSON.parse(saved)[0].value.columns).toEqual(["role", "dept"]);
  await page.getByRole("combobox", { name: "Filter by user state" }).selectOption("inactive");
  await views.getByRole("checkbox", { name: "Department", exact: true }).uncheck();
  await page.evaluate(() => {
    window.demoData.profile_settings.fields[0].label = "Apartment";
    window.demoNotify();
  });
  await views.getByRole("button", { name: "Load view" }).click();
  await expect(page.getByRole("combobox", { name: "Filter by user state" })).toHaveValue("active");
  await expect(page.locator(".desktop-users th.custom-user-field")).toHaveText([
    "Role",
    "Apartment",
  ]);
  await setup(page);
  await views.locator("summary").click();
  await views
    .getByRole("combobox", { name: "Saved view", exact: true })
    .selectOption({ label: "Active staff" });
  await views.getByRole("button", { name: "Load view" }).click();
  await expect(page.locator(".desktop-users th.custom-user-field")).toHaveText([
    "Role",
    "Department",
  ]);
});

test("USB reader Enter only reviews; explicit use adds an exact identifier to the draft", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  const usb = dialog.locator("wiskey-usb-card-input");
  await usb.locator("summary").click();
  const input = usb.getByLabel("USB reader input", { exact: true });
  await input.fill("000012345678");
  await input.press("Enter");
  await expect(usb.getByRole("status")).toContainText("5678");
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update")))).toBe(
    false,
  );
  await usb.getByRole("button", { name: "Use card in draft" }).click();
  await expect(input).toHaveValue("");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const patch = await page.evaluate(
    () => window.calls.filter((c) => c.type.endsWith("users/update")).at(-1).data,
  );
  expect(patch.cards.some((c) => c.card_no === "000012345678")).toBe(true);
});

test("overlength USB input is rejected without truncating to an accepted card", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const usb = page.locator("wiskey-usb-card-input");
  await usb.locator("summary").click();
  await usb.getByLabel("USB reader input", { exact: true }).fill("1".repeat(33));
  await usb.getByLabel("USB reader input", { exact: true }).press("Enter");
  await expect(usb.getByRole("alert")).toBeVisible();
  await expect(usb.getByRole("button", { name: "Use card in draft" })).toHaveCount(0);
  expect(await page.evaluate(() => window.calls.some((c) => c.type.endsWith("users/update")))).toBe(
    false,
  );
});

test("standalone new controls remain idle and responsive without administrator access", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const tags = ["wiskey-microphone-input", "wiskey-saved-user-views", "wiskey-camera-wall"];
    const controls = tags.map((tag) => {
      const element = document.createElement(tag) as HTMLElement & {
        hass?: unknown;
        updateComplete?: Promise<unknown>;
      };
      element.hass = { ...window.demoHass, user: { ...window.demoHass.user, is_admin: false } };
      document.body.append(element);
      return element;
    });
    await Promise.all(controls.map((control) => control.updateComplete));
    await new Promise(requestAnimationFrame);
    const counts = controls.map(
      (control) => control.shadowRoot?.querySelectorAll("input,button,select,video").length,
    );
    controls.forEach((control) => control.remove());
    return counts;
  });
  expect(result).toEqual([0, 0, 0]);
});
