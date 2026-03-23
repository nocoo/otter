import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const now = Date.now();

const mockWebhooks = [
  {
    id: "wh-1",
    token: "tok-aaaabbbb",
    label: "dev-macbook",
    isActive: true,
    createdAt: now - 86_400_000, // 1 day ago
    lastUsedAt: now - 3_600_000, // 1 hour ago
  },
  {
    id: "wh-2",
    token: "tok-ccccdddd",
    label: "ci-pipeline",
    isActive: false,
    createdAt: now - 172_800_000, // 2 days ago
    lastUsedAt: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Settings", () => {
  test("renders account section with fallback user in E2E mode", async ({ page }) => {
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [] }),
      });
    });

    await page.goto("/settings");

    // Header
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Manage your account and webhook tokens")).toBeVisible();

    // Account section — session is null in E2E so fallback to "User"
    await expect(page.getByText("Account")).toBeVisible();
    await expect(page.locator("text=User").first()).toBeVisible();
    await expect(page.getByText("Google OAuth")).toBeVisible();

    // Danger Zone section
    await expect(page.getByText("Danger Zone")).toBeVisible();
    const deleteBtn = page.getByRole("button", { name: "Delete All" });
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();
  });

  test("webhook list renders with mocked data", async ({ page }) => {
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: mockWebhooks }),
      });
    });

    await page.goto("/settings");

    // Both webhook labels should be visible
    await expect(page.getByText("dev-macbook")).toBeVisible();
    await expect(page.getByText("ci-pipeline")).toBeVisible();

    // Active/Inactive badges
    await expect(page.getByText("Active").first()).toBeVisible();
    await expect(page.getByText("Inactive")).toBeVisible();

    // Webhook URLs should contain the tokens
    await expect(page.locator("code").filter({ hasText: "tok-aaaabbbb" }).first()).toBeVisible();
    await expect(page.locator("code").filter({ hasText: "tok-ccccdddd" }).first()).toBeVisible();
  });

  test("create webhook dialog opens and submits", async ({ page }) => {
    await page.route("**/api/webhooks", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ webhooks: [] }),
        });
      } else if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            webhook: {
              id: "wh-new",
              token: "tok-new-12345",
              label: body.label,
              isActive: true,
              createdAt: Date.now(),
              lastUsedAt: null,
            },
          }),
        });
      }
    });

    await page.goto("/settings");

    // Empty state initially
    await expect(page.getByText("No webhook tokens yet")).toBeVisible();

    // Click "New Token" button to open the dialog
    await page.getByRole("button", { name: /New Token/i }).click();

    // Dialog should appear
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Create Webhook Token")).toBeVisible();

    // Fill in the label
    await page.getByPlaceholder("e.g. dev-macbook, ci-pipeline").fill("my-new-webhook");

    // Click Create
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

    // Dialog should close and new webhook should appear
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText("my-new-webhook")).toBeVisible();
    await expect(page.locator("code").filter({ hasText: "tok-new-12345" }).first()).toBeVisible();
  });

  test("toggle webhook active/inactive", async ({ page }) => {
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [mockWebhooks[0]] }),
      });
    });

    await page.route("**/api/webhooks/wh-1", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            webhook: { ...mockWebhooks[0], isActive: body.isActive },
          }),
        });
      }
    });

    await page.goto("/settings");

    // Initially active
    await expect(page.getByText("Active").first()).toBeVisible();

    // Click the toggle switch
    const toggle = page.getByRole("switch", { name: /Toggle dev-macbook/i });
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Badge should change to "Inactive"
    await expect(page.getByText("Inactive")).toBeVisible();
  });

  test("delete webhook removes row from list", async ({ page }) => {
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [...mockWebhooks] }),
      });
    });

    await page.route("**/api/webhooks/wh-1", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.goto("/settings");

    // Both webhooks visible
    await expect(page.getByText("dev-macbook")).toBeVisible();
    await expect(page.getByText("ci-pipeline")).toBeVisible();

    // Click delete button for "dev-macbook"
    const deleteBtn = page.getByRole("button", { name: /Delete dev-macbook/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // dev-macbook should disappear, ci-pipeline should remain
    await expect(page.getByText("dev-macbook")).not.toBeVisible();
    await expect(page.getByText("ci-pipeline")).toBeVisible();
  });
});
