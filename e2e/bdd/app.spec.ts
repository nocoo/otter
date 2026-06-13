import { expect, test } from "@playwright/test";

test.describe("App — BDD Smoke", () => {
  test("Given the app is running, When I visit the home page, Then I see the page title", async ({ page }) => {
    // Given: the dev server is running (started by playwright webServer)

    // When: I visit the home page
    await page.goto("/");

    // Then: the page loads with a non-empty title
    await expect(page).toHaveTitle(/.+/, { timeout: 15_000 });
  });
});
