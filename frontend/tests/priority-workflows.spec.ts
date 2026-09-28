import { test, expect } from "@playwright/test";
import { navigate } from "./navigation";

test("encrypted backup downloads content rather than a filename and requires import review", async ({
  page,
}) => {
  await page.goto("/?workflows");
  await navigate(page, "Advanced operations");
  const center = page.locator("wiskey-workflow-center");
  await center
    .getByLabel("Backup passphrase — at least 12 characters")
    .fill("synthetic backup password");
  const downloadPromise = page.waitForEvent("download");
  await center.getByRole("button", { name: "Download encrypted backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("demo.encrypted.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString()).format).toBe("smplwise-access");
  await center.getByLabel("Backup file").setInputFiles({
    name: "sample.encrypted.json",
    mimeType: "application/json",
    buffer: Buffer.from("encrypted sample"),
  });
  await center.getByRole("button", { name: "Check collisions and preview" }).click();
  await expect(center.getByText("Restored person", { exact: true })).toBeVisible();
  await center.getByRole("button", { name: "Approve import" }).click();
  expect(
    await page.evaluate(() => window.calls.some((c) => c.type.endsWith("/backups/apply"))),
  ).toBe(false);
  await center.getByLabel("I reviewed and approve this import").check();
  await center.getByRole("button", { name: "Approve import" }).click();
  await expect(center.getByRole("status")).toContainText("Import saved");
});

for (const width of [390, 1440]) {
  test(`inventory label and status can be edited without revealing card number, width ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?workflows");
    await navigate(page, "Advanced operations");
    const center = page.locator("wiskey-workflow-center");
    await center.getByRole("button", { name: "Card inventory", exact: true }).click();
    await center.getByLabel("Card number", { exact: true }).fill("827361");
    await center.getByLabel("Name", { exact: true }).fill("Visitor card");
    await center.getByRole("button", { name: "Save", exact: true }).click();
    await expect(center.getByText("•••• 7361", { exact: true })).toBeVisible();
    await center.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(center.getByLabel("Card number", { exact: true })).toBeDisabled();
    await center.getByLabel("Name", { exact: true }).fill("Reception card");
    await center.getByRole("button", { name: "Save", exact: true }).click();
    await expect(center.getByText("Reception card", { exact: true })).toBeVisible();
    const saved = await page.evaluate(() =>
      window.calls.filter((c) => c.type.endsWith("/workflows/inventory_save")).at(-1),
    );
    expect(saved.values.card_no).toBe("");
    expect(saved.revision).toBe(1);
    expect(await center.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}

test("staff preset fills a new user draft and message without saving", async ({ page }) => {
  await page.goto("/?workflows");
  await page.evaluate(() => {
    window.workflowData.templates = [
      {
        id: "staff",
        revision: 1,
        label: "Facilities",
        message: "Welcome {name}",
        data: {
          profile: { department: "Facilities" },
          group_ids: [],
          assignments: { "station-0": { enabled: true, allowed_locks: [1] } },
        },
      },
    ];
  });
  await navigate(page, "Advanced operations");
  const center = page.locator("wiskey-workflow-center");
  await center.getByRole("button", { name: "Staff presets", exact: true }).click();
  await center.getByRole("button", { name: "Use preset", exact: true }).click();
  await expect(page.locator("dialog[open] #user-form")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.calls.filter(
          (c) => c.type.endsWith("/users/create") || c.type.endsWith("/users/update"),
        ).length,
    ),
  ).toBe(0);
  await expect(
    page.getByRole("textbox", { name: "Message draft for this person", exact: true }),
  ).toHaveValue("Welcome {name}");
});

test("mobile fresh-authentication form clears password, requires MFA and emits only after proof", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => {
    const panel = document.querySelector("hikvision-intercom-panel") as any;
    const gate = document.createElement("wiskey-reauth") as any;
    gate.locked = true;
    let step = 0;
    gate.hass = {
      ...panel.hass,
      callWS: async (message: any) => {
        if (message.type.endsWith("/security/reauth_start"))
          return {
            flow_id: "test",
            fields: [{ name: "password", choices: null }],
            authenticated: false,
          };
        step++;
        if (step === 1)
          return {
            flow_id: "test",
            fields: [{ name: "password", choices: null }],
            authenticated: false,
            errors: ["invalid_auth"],
          };
        if (step === 2)
          return {
            flow_id: "test",
            fields: [{ name: "code", choices: null }],
            authenticated: false,
          };
        return { authenticated: true };
      },
    };
    gate.addEventListener("reauthenticated", () => gate.setAttribute("data-proved", "yes"));
    document.body.append(gate);
  });
  const gate = page.locator("wiskey-reauth");
  await gate.getByLabel("Password", { exact: true }).fill("synthetic-wrong-password");
  await gate.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(gate.getByRole("alert")).toContainText("Authentication failed");
  await expect(gate.getByLabel("Password", { exact: true })).toHaveValue("");
  await gate.getByLabel("Password", { exact: true }).fill("synthetic-correct-password");
  await gate.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(gate.getByLabel("Verification code", { exact: true })).toBeVisible();
  await expect(gate).not.toHaveAttribute("data-proved", "yes");
  await expect(gate.getByLabel("Password", { exact: true })).toHaveCount(0);
  await gate.getByLabel("Verification code", { exact: true }).fill("123456");
  await gate.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(gate).toHaveAttribute("data-proved", "yes");
  expect(await gate.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
