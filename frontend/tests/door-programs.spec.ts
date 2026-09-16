import { test, expect } from "@playwright/test";

test("door program can be saved inactive, activated, paused and removed", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as any;
    const base = w.demoHass.callWS.bind(w.demoHass);
    let programs: any[] = [];
    w.programCalls = [];
    w.demoHass.callWS = async (m: any) => {
      if (!m.type.includes("technical_program_")) return base(m);
      w.programCalls.push(m);
      if (m.type.endsWith("list")) return { programs, saved: [], timezone: "Asia/Jerusalem" };
      if (m.type.endsWith("save"))
        programs = [
          {
            ...m,
            revision: m.revision + 1,
            removing: false,
            error: null,
            checked_at: null,
            execution: { owned: false, status: "idle" },
          },
        ];
      if (m.type.endsWith("action")) {
        if (m.action === "remove") programs = [];
        else programs = programs.map((p) => ({ ...p, enabled: false, revision: p.revision + 1 }));
      }
      return { programs };
    };
    const el = document.createElement("wiskey-door-programs") as any;
    el.hass = w.demoHass;
    el.station = {
      id: "station-1",
      integrated_locks: [{ physical_index: 1, api_id: 1, name: "Front door" }],
    };
    document.body.append(el);
  });
  const panel = page.locator("body > wiskey-door-programs");
  await panel.getByRole("button", { name: "New program" }).click();
  await panel.locator('input[maxlength="32"]').fill("Office hours");
  await panel.getByRole("checkbox", { name: "Monday", exact: true }).check();
  await panel.getByRole("button", { name: "Save without activation" }).click();
  await expect(panel.locator("article")).toContainText("Office hours");
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  await panel.getByRole("button", { name: "Save and activate" }).click();
  await expect(panel.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
  page.on("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(panel.locator("article")).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).programCalls);
  expect(calls.filter((c: any) => c.type.endsWith("save")).map((c: any) => c.enabled)).toEqual([
    false,
    true,
  ]);
  expect(
    calls.filter((c: any) => c.type.endsWith("save"))[0].policy.schedule.weekly.Monday,
  ).toEqual([{ start: "08:00", end: "17:00" }]);
});
