import { test, expect } from "@playwright/test";

test.describe("App — BDD Smoke", () => {
  test("Given the app is running, When I visit the home page, Then I see the page title", async ({
    page,
  }) => {
    // Given: app is running (webServer handles this)

    // When: visit home page
    await page.goto("/");

    // Then: page loads with Otter title
    await expect(page).toHaveTitle(/otter/i, { timeout: 15_000 });
  });
});
