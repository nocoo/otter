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
    collectorCount: 10,
    fileCount: 5,
    listCount: 15,
    sizeBytes: 2048,
    snapshotAt: now - 60_000,
    uploadedAt: now - 30_000,
    ...overrides,
  };
}

// Page 1: 20 snapshots, with nextBefore pointing to page 2
const page1Snapshots = Array.from({ length: 20 }, (_, i) =>
  makeSnapshot(`snap-${String(i + 1).padStart(3, "0")}`, `host-${i + 1}`, {
    uploadedAt: now - i * 60_000,
  }),
);

// Page 2: 5 snapshots (last page)
const page2Snapshots = Array.from({ length: 5 }, (_, i) =>
  makeSnapshot(`snap-${String(i + 21).padStart(3, "0")}`, `host-${i + 21}`, {
    uploadedAt: now - (i + 20) * 60_000,
  }),
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Snapshots List", () => {
  test("renders table with mocked snapshot data", async ({ page }) => {
    await page.route("**/api/snapshots*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: page1Snapshots.slice(0, 5), total: 5, nextBefore: null }),
      });
    });

    await page.goto("/snapshots");

    // Table header columns should be visible
    await expect(page.getByRole("columnheader", { name: "Host" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Platform" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Collectors" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Files" })).toBeVisible();

    // Hostnames should appear in the table
    await expect(page.getByText("host-1")).toBeVisible();
    await expect(page.getByText("host-5")).toBeVisible();

    // Pagination text
    await expect(page.getByText("Showing 1-5 of 5 snapshots")).toBeVisible();
  });

  test("pagination controls navigate between pages", async ({ page }) => {
    let requestedBefore: string | null = null;

    await page.route("**/api/snapshots*", async (route) => {
      const url = new URL(route.request().url());
      requestedBefore = url.searchParams.get("before");

      if (!requestedBefore) {
        // Page 1
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            snapshots: page1Snapshots,
            total: 25,
            nextBefore: page1Snapshots[19]!.uploadedAt,
          }),
        });
      } else {
        // Page 2
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            snapshots: page2Snapshots,
            total: 25,
            nextBefore: null,
          }),
        });
      }
    });

    await page.goto("/snapshots");

    // Page 1 info
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await expect(page.getByText("host-1")).toBeVisible();

    // Click Next
    const nextButton = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-chevron-right") });
    await nextButton.click();

    // Page 2 info
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.getByText("host-21")).toBeVisible();

    // Click Prev to go back
    const prevButton = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-chevron-left") });
    await prevButton.click();

    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });

  test("table columns render hostname, platform badge, and counts", async ({ page }) => {
    const snapshots = [
      makeSnapshot("snap-abc", "dev-macbook", {
        platform: "darwin",
        arch: "arm64",
        collectorCount: 12,
        fileCount: 8,
        listCount: 20,
        sizeBytes: 16384,
      }),
      makeSnapshot("snap-def", "ci-linux", {
        platform: "linux",
        arch: "x86_64",
        collectorCount: 6,
        fileCount: 3,
        listCount: 10,
        sizeBytes: 4096,
      }),
    ];

    await page.route("**/api/snapshots*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots, total: 2, nextBefore: null }),
      });
    });

    await page.goto("/snapshots");

    // Hostnames
    await expect(page.getByText("dev-macbook")).toBeVisible();
    await expect(page.getByText("ci-linux")).toBeVisible();

    // Platform badges
    await expect(page.getByText("darwin/arm64")).toBeVisible();
    await expect(page.getByText("linux/x86_64")).toBeVisible();

    // Snapshot ID short codes should be visible
    await expect(page.getByText("snap-abc")).toBeVisible();
    await expect(page.getByText("snap-def")).toBeVisible();
  });

  test("empty state when no snapshots exist", async ({ page }) => {
    await page.route("**/api/snapshots*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: [], total: 0, nextBefore: null }),
      });
    });

    await page.goto("/snapshots");

    await expect(page.getByText("No snapshots yet")).toBeVisible();
    await expect(page.getByText("Configure a webhook and run the CLI")).toBeVisible();
  });

  test("clicking a snapshot row navigates to detail page", async ({ page }) => {
    const snapshots = [makeSnapshot("snap-nav-test", "clickable-host")];

    await page.route("**/api/snapshots*", async (route) => {
      // Don't match the detail route
      if (route.request().url().includes("/api/snapshots/snap-nav-test")) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Not found" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots, total: 1, nextBefore: null }),
      });
    });

    await page.goto("/snapshots");

    // Click the snapshot link (the short ID code)
    await page.getByRole("link", { name: /snap-nav/ }).click();
    await expect(page).toHaveURL(/\/snapshots\/snap-nav-test$/);
  });
});
