import { expect, test } from "@playwright/test";

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    // Mock APIs so pages don't error on load
    await page.route("**/api/snapshots*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: [], total: 0, nextBefore: null }),
      });
    });
    await page.route("**/api/webhooks*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [] }),
      });
    });
  });

  test("sidebar links navigate to correct pages", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);

    // Navigate to Snapshots
    await page.getByRole("link", { name: "Snapshots" }).click();
    await expect(page).toHaveURL(/\/snapshots$/);
    await expect(page.getByRole("heading", { name: "Snapshots" })).toBeVisible();

    // Navigate to Settings
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Navigate back to Dashboard
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("active sidebar link is highlighted", async ({ page }) => {
    await page.goto("/snapshots");

    // The Snapshots link should have the active class (bg-accent)
    const snapshotsLink = page.locator("aside").getByRole("link", { name: "Snapshots" });
    await expect(snapshotsLink).toHaveClass(/bg-accent/);

    // The Dashboard link should NOT have the active class
    const dashboardLink = page.locator("aside").getByRole("link", { name: "Dashboard" });
    await expect(dashboardLink).not.toHaveClass(/bg-accent/);
  });

  test("breadcrumbs show correct path segments", async ({ page }) => {
    // Dashboard shows "Home"
    await page.goto("/");
    await expect(page.locator("header nav").getByText("Home")).toBeVisible();

    // Snapshots page shows "Home > Snapshots"
    await page.goto("/snapshots");
    await expect(page.locator("header nav").getByText("Home")).toBeVisible();
    await expect(page.locator("header nav").getByText("Snapshots")).toBeVisible();

    // Settings page shows "Home > Settings"
    await page.goto("/settings");
    await expect(page.locator("header nav").getByText("Home")).toBeVisible();
    await expect(page.locator("header nav").getByText("Settings")).toBeVisible();
  });

  test("mobile viewport shows hamburger menu that opens sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Desktop sidebar should not be visible
    await expect(page.locator("aside")).not.toBeVisible();

    // Hamburger button should be visible
    const menuButton = page.getByRole("button", { name: "Open navigation" });
    await expect(menuButton).toBeVisible();

    // Click to open mobile sidebar
    await menuButton.click();

    // Sidebar overlay should appear with nav links
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.locator("aside").getByText("Dashboard")).toBeVisible();
    await expect(page.locator("aside").getByText("Snapshots")).toBeVisible();
    await expect(page.locator("aside").getByText("Settings")).toBeVisible();
  });

  test("theme toggle cycles between system, light, and dark", async ({ page }) => {
    await page.goto("/");

    const themeButton = page.getByRole("button", { name: "Toggle theme" });
    await expect(themeButton).toBeVisible();

    // Default is "system" — clicking once should go to "light"
    await themeButton.click();
    // In light mode, <html> should NOT have dark class
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Click again → dark
    await themeButton.click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Click again → system (cycles back)
    await themeButton.click();
    // localStorage should be "system" now
    const theme = await page.evaluate(() => localStorage.getItem("theme"));
    expect(theme).toBe("system");
  });
});
