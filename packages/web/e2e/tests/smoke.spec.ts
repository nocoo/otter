import { expect, test } from "@playwright/test";
import { buildRichSnapshotFixture, getRichSnapshotCounts } from "../support/rich-snapshot";

const richSnapshotId = "ui-rich-meta";
const richSnapshot = buildRichSnapshotFixture(richSnapshotId);
const richCounts = getRichSnapshotCounts(richSnapshot);

test.beforeEach(async ({ page }) => {
  // Stub list endpoints so AppShell / dashboard widgets don't 404 from miniflare.
  await page.route("**/api/snapshots", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshots: [], total: 0, nextBefore: null }),
    });
  });
  await page.route("**/api/snapshots?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshots: [], total: 0, nextBefore: null }),
    });
  });
  await page.route("**/api/webhooks", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ webhooks: [] }),
    });
  });
});

test("dashboard renders for localhost-stamped session", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("snapshot detail renders rich snapshot", async ({ page }) => {
  await page.route(`**/api/snapshots/${richSnapshotId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        snapshot: {
          id: richSnapshot.id,
          hostname: richSnapshot.machine.computerName ?? richSnapshot.machine.hostname,
          platform: richSnapshot.machine.platform,
          arch: richSnapshot.machine.arch,
          username: richSnapshot.machine.username,
          collectorCount: richCounts.collectorCount,
          fileCount: richCounts.fileCount,
          listCount: richCounts.listCount,
          sizeBytes: 8192,
          snapshotAt: Date.now(),
          uploadedAt: Date.now(),
        },
        data: richSnapshot,
      }),
    });
  });

  await page.goto(`/snapshots/${richSnapshotId}`);

  await expect(page.getByRole("tab", { name: /config\s+4/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /environment\s+8/i })).toBeVisible();
  await expect(page.getByText("Otter Rich Mac")).toBeVisible();
  await expect(page.getByText("By Category")).toBeVisible();
  await expect(page.getByText("Skipped pyenv: not installed")).toBeVisible();

  await page.getByRole("tab", { name: /config\s+4/i }).click();
  await page.getByPlaceholder("Search collectors, files, items, or metadata...").fill("copilot");
  await expect(page.getByText("VS Code / Cursor Configuration")).toBeVisible();

  await page.getByRole("tab", { name: /environment\s+8/i }).click();
  await expect(page.getByText("Development Toolchain")).toBeVisible();

  await page.getByPlaceholder("Search collectors, files, items, or metadata...").fill("homebrew");
  await expect(page.getByText("Homebrew Packages")).toBeVisible();
  await expect(page.getByText("Docker Configuration")).not.toBeVisible();
});
