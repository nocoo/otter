import { test, expect } from "@playwright/test";
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

test("dashboard snapshot detail renders all rich collectors", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: /config 4 collectors/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /environment 8 collectors/i })).toBeVisible();
  await expect(page.getByText("pinned: true")).toBeVisible();
  await expect(page.getByText("editor: vscode")).toBeVisible();
  await expect(page.getByText("current: true")).toBeVisible();
  await expect(page.getByText("Skipped pyenv: not installed")).toBeVisible();
  await expect(page.getByText("Keys are detected only")).toBeVisible();
  await expect(page.getByText("crontab")).toBeVisible();

  await page.getByPlaceholder("Search collectors, files, items, or metadata...").fill("copilot");
  await expect(page.getByText("VS Code / Cursor Configuration")).toBeVisible();
  await expect(page.getByText("Homebrew Packages")).not.toBeVisible();

  await page.getByRole("button", { name: "Environment" }).click();
  await expect(page.getByText("No collectors match the current filters.")).toBeVisible();

  await page.getByRole("button", { name: "All" }).click();
  await page.getByPlaceholder("Search collectors, files, items, or metadata...").fill("aws-profile");
  await expect(page.getByText("Cloud CLI Configuration")).toBeVisible();
  await expect(page.getByText("macOS System Preferences")).not.toBeVisible();
});
