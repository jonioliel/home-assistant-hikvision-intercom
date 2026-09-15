import { test, expect } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`offline station does not become a person status at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.evaluate(async () => {
      const w = window as any;
      const original = w.demoData.users[0];
      w.demoData.users = [
        {
          ...original,
          id: "verified",
          display_name: "Verified",
          assignments: {
            "station-0": {
              enabled: true,
              allowed_locks: [1],
              sync_state: "offline",
              desired_revision: 3,
              applied_revision: 3,
            },
          },
        },
        {
          ...original,
          id: "waiting",
          display_name: "Waiting",
          assignments: {
            "station-0": {
              enabled: true,
              allowed_locks: [1],
              sync_state: "offline",
              desired_revision: 4,
              applied_revision: 3,
            },
          },
        },
        {
          ...original,
          id: "unknown",
          display_name: "Unknown",
          assignments: {
            "station-0": { enabled: true, allowed_locks: [1], sync_state: "offline" },
          },
        },
        {
          ...original,
          id: "conflict",
          display_name: "Conflict person",
          assignments: {
            "station-0": {
              enabled: true,
              allowed_locks: [1],
              sync_state: "offline",
              desired_revision: 3,
              applied_revision: 3,
            },
            "station-1": { enabled: true, allowed_locks: [1], sync_state: "conflict" },
          },
        },
      ];
      await (document.querySelector("hikvision-intercom-panel") as any).refresh();
    });
    await page.getByRole("button", { name: "Users", exact: true }).click();
    const container = page.locator(width === 390 ? ".mobile-users" : ".desktop-users");
    await expect(container.locator(".status.offline")).toHaveCount(0);
    await expect(container.locator(".status.synced")).toHaveCount(1);
    await expect(container.locator(".status.pending")).toHaveCount(2);
    await expect(container.locator(".status.conflict")).toHaveCount(1);
    expect(
      await page.evaluate(() =>
        (window as any).calls.some(
          (c: any) => c.type.endsWith("users/update") || c.type.includes("sync/"),
        ),
      ),
    ).toBe(false);
  });
}
