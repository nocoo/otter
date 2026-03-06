import { test, expect } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("text=Sign in with Google")).toBeVisible();
  await expect(page.locator("text=Dev Environment Backup")).toBeVisible();
});

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/");
  // Should redirect to login page when not authenticated
  await expect(page).toHaveURL(/\/login/);
});
