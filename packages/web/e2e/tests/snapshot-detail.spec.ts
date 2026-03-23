import { expect, test } from "@playwright/test";
import { buildRichSnapshotFixture, getRichSnapshotCounts } from "../../test-support/rich-snapshot";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const richSnapshotId = "e2e-detail-test";
const richSnapshot = buildRichSnapshotFixture(richSnapshotId);

function mockSnapshotDetail(snapshot: typeof richSnapshot) {
  const counts = getRichSnapshotCounts(snapshot);
  return {
    snapshot: {
      id: snapshot.id,
      hostname: snapshot.machine.computerName ?? snapshot.machine.hostname,
      platform: snapshot.machine.platform,
      arch: snapshot.machine.arch,
      username: snapshot.machine.username,
      collectorCount: counts.collectorCount,
      fileCount: counts.fileCount,
      listCount: counts.listCount,
      sizeBytes: 8192,
      snapshotAt: Date.now(),
      uploadedAt: Date.now(),
    },
    data: snapshot,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Snapshot Detail", () => {
  test("export JSON button triggers download", async ({ page }) => {
    await page.route(`**/api/snapshots/${richSnapshotId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSnapshotDetail(richSnapshot)),
      });
    });

    await page.goto(`/snapshots/${richSnapshotId}`);

    // Wait for content to load
    await expect(page.getByText("Otter Rich Mac")).toBeVisible();

    // Intercept the download triggered by the Export JSON button
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export JSON/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`snapshot-${richSnapshotId}.json`);
  });

  test("file viewer dialog opens when clicking view button", async ({ page }) => {
    await page.route(`**/api/snapshots/${richSnapshotId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSnapshotDetail(richSnapshot)),
      });
    });

    await page.goto(`/snapshots/${richSnapshotId}`);

    // Switch to Config tab which has file rows
    await page
      .getByRole("tab", { name: /config/i })
      .first()
      .click();

    // Find a "View file" button (Eye icon) and click it
    const viewButton = page.getByTitle("View file").first();
    await expect(viewButton).toBeVisible();
    await viewButton.click();

    // Dialog should open — check for dialog header elements
    await expect(page.getByRole("dialog")).toBeVisible();
    // The dialog should show the filename and file path
    await expect(page.getByRole("dialog").locator("code, span").first()).toBeVisible();
    // Copy button inside dialog
    await expect(page.getByRole("dialog").getByRole("button", { name: /Copy/i })).toBeVisible();
  });

  test("404 state when snapshot not found", async ({ page }) => {
    await page.route("**/api/snapshots/nonexistent-id", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Snapshot not found" }),
      });
    });

    await page.goto("/snapshots/nonexistent-id");

    await expect(page.getByText("Snapshot not found")).toBeVisible();
  });

  test("error state when API returns 500", async ({ page }) => {
    await page.route("**/api/snapshots/broken-id", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Failed to load snapshot (500)" }),
      });
    });

    await page.goto("/snapshots/broken-id");

    await expect(page.getByText(/Failed to load snapshot/)).toBeVisible();
  });

  test("tab navigation between Overview, Config, and Environment", async ({ page }) => {
    await page.route(`**/api/snapshots/${richSnapshotId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSnapshotDetail(richSnapshot)),
      });
    });

    await page.goto(`/snapshots/${richSnapshotId}`);

    // Overview tab should be active by default
    const overviewTab = page.getByRole("tab", { name: /overview/i });
    await expect(overviewTab).toBeVisible();
    await expect(overviewTab).toHaveAttribute("data-state", "active");

    // Verify overview content is visible
    await expect(page.getByText("Otter Rich Mac")).toBeVisible();
    await expect(page.getByText("12 collectors captured in this snapshot")).toBeVisible();

    // Switch to Config tab
    const configTab = page.getByRole("tab", { name: /config/i }).first();
    await configTab.click();
    await expect(configTab).toHaveAttribute("data-state", "active");
    // Config collectors should be visible
    await expect(page.getByText("Claude Code Configuration")).toBeVisible();

    // Switch to Environment tab
    const envTab = page.getByRole("tab", { name: /environment/i }).first();
    await envTab.click();
    await expect(envTab).toHaveAttribute("data-state", "active");
    // Environment collectors should be visible
    await expect(page.getByText("Development Toolchain")).toBeVisible();
    await expect(page.getByText("Homebrew Packages")).toBeVisible();
  });
});
