import { expect, test } from "@playwright/test";
import { buildRichSnapshotFixture, getRichSnapshotCounts } from "../../test-support/rich-snapshot";

const richSnapshotId = "ui-rich-meta";
const richSnapshot = buildRichSnapshotFixture(richSnapshotId);
const richCounts = getRichSnapshotCounts(richSnapshot);

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("text=Sign in with Google")).toBeVisible();
  await expect(page.locator("text=Dev Environment Backup")).toBeVisible();
});

test("e2e auth bypass allows dashboard access", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Snapshots")).toBeVisible();
});

test("dashboard snapshot detail renders rich snapshot", async ({ page }) => {
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

  // Overview tab: verify category tabs and summary cards
  await expect(page.getByRole("tab", { name: /config\s+4/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /environment\s+8/i })).toBeVisible();
  await expect(page.getByText("Otter Rich Mac")).toBeVisible();
  await expect(page.getByText("By Category")).toBeVisible();
  await expect(page.getByText("Skipped pyenv: not installed")).toBeVisible();

  // Switch to Config tab and search
  await page.getByRole("tab", { name: /config\s+4/i }).click();
  await page.getByPlaceholder("Search collectors, files, items, or metadata...").fill("copilot");
  await expect(page.getByText("VS Code / Cursor Configuration")).toBeVisible();

  // Switch to Environment tab and verify an environment collector renders
  await page.getByRole("tab", { name: /environment\s+8/i }).click();
  await expect(page.getByText("Development Toolchain")).toBeVisible();

  // Search within environment tab
  await page.getByPlaceholder("Search collectors, files, items, or metadata...").fill("homebrew");
  await expect(page.getByText("Homebrew Packages")).toBeVisible();
  await expect(page.getByText("Docker Configuration")).not.toBeVisible();
});
