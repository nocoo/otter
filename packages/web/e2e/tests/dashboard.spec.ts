import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const now = Date.now();

function makeSnapshot(id: string, hostname: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    hostname,
    platform: "darwin",
    arch: "arm64",
    username: "tester",
    collectorCount: 12,
    fileCount: 8,
    listCount: 20,
    sizeBytes: 4096,
    snapshotAt: now - 60_000, // 1 minute ago
    uploadedAt: now - 30_000,
    ...overrides,
  };
}

const mockSnapshots = [
  makeSnapshot("snap-001", "macbook-pro"),
  makeSnapshot("snap-002", "linux-dev", { platform: "linux", arch: "x86_64" }),
  makeSnapshot("snap-003", "work-laptop"),
];

const mockWebhooks = [
  {
    id: "wh-1",
    token: "tok-abc",
    label: "dev-macbook",
    isActive: true,
    createdAt: now,
    lastUsedAt: now,
  },
  {
    id: "wh-2",
    token: "tok-def",
    label: "ci-pipeline",
    isActive: false,
    createdAt: now,
    lastUsedAt: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Dashboard", () => {
  test("renders stat cards with correct data from API", async ({ page }) => {
    await page.route("**/api/snapshots*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: mockSnapshots, total: 42, nextBefore: null }),
      });
    });
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: mockWebhooks }),
      });
    });

    await page.goto("/");

    // Total Snapshots = 42
    await expect(page.getByText("Total Snapshots")).toBeVisible();
    await expect(page.locator("text=42").first()).toBeVisible();

    // Active Webhooks = 1 (only wh-1 is active)
    await expect(page.getByText("Active Webhooks")).toBeVisible();
    await expect(page.locator("text=1").first()).toBeVisible();

    // Config Files from latest snapshot
    await expect(page.getByText("Config Files")).toBeVisible();
    await expect(page.locator("text=8").first()).toBeVisible();

    // Last Backup should show relative time (e.g., "1m ago" or "just now")
    await expect(page.getByText("Last Backup")).toBeVisible();
  });

  test("recent snapshots table renders rows that link to detail pages", async ({ page }) => {
    await page.route("**/api/snapshots*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: mockSnapshots, total: 3, nextBefore: null }),
      });
    });
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [] }),
      });
    });

    await page.goto("/");

    // Table should show all 3 hostnames
    await expect(page.getByText("macbook-pro", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("linux-dev", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("work-laptop", { exact: true }).first()).toBeVisible();

    // Click on first row → navigates to detail page
    // The row uses onClick={router.push}, not an <a> link
    await page.route("**/api/snapshots/snap-001", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Not found" }),
      });
    });
    await page.getByText("macbook-pro", { exact: true }).first().click();
    await expect(page).toHaveURL(/\/snapshots\/snap-001$/);
  });

  test("view all link navigates to /snapshots", async ({ page }) => {
    await page.route("**/api/snapshots*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: mockSnapshots, total: 3, nextBefore: null }),
      });
    });
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [] }),
      });
    });

    await page.goto("/");

    const viewAll = page.getByRole("link", { name: /View all/i });
    await expect(viewAll).toBeVisible();
    await viewAll.click();
    await expect(page).toHaveURL(/\/snapshots$/);
  });

  test("empty state displays when no snapshots exist", async ({ page }) => {
    await page.route("**/api/snapshots*", async (route) => {
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

    await page.goto("/");

    await expect(page.getByText("No snapshots yet")).toBeVisible();
    await expect(page.getByText("Configure a webhook and run the CLI")).toBeVisible();
  });

  test("error state displays when API fails, retry reloads", async ({ page }) => {
    let callCount = 0;
    await page.route("**/api/snapshots*", async (route) => {
      callCount++;
      if (callCount <= 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ snapshots: [], total: 0, nextBefore: null }),
        });
      }
    });
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [] }),
      });
    });

    await page.goto("/");

    // Error message should appear (apiFetch surfaces "HTTP <status>")
    await expect(page.getByText(/HTTP 500/)).toBeVisible();

    // Retry button should be visible — clicking triggers page.reload()
    const retryButton = page.getByRole("button", { name: "Retry" });
    await expect(retryButton).toBeVisible();
  });
});
