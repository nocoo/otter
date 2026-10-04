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
    is_active: 1,
    created_at: now - 86_400_000,
    last_used_at: now - 3_600_000,
  },
  {
    id: "wh-2",
    token: "tok-ccccdddd",
    label: "ci-pipeline",
    is_active: 0,
    created_at: now - 172_800_000,
    last_used_at: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("real local webhook CRUD preserves active state and timestamps", async ({ page, request }) => {
  const label = `basalt-real-${Date.now()}`;
  await page.goto("/settings");
  await page.getByRole("button", { name: "New Token" }).click();
  await page.getByLabel("Label", { exact: true }).fill(label);
  await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  const toggle = page.getByRole("switch", { name: `Toggle ${label}` });
  await expect(toggle).toBeChecked();
  await expect(page.getByText("Invalid Date", { exact: false })).toHaveCount(0);
  const response = await request.get("/api/webhooks");
  const body = (await response.json()) as {
    webhooks: Array<{ id: string; label: string; is_active: number; created_at: number }>;
  };
  const row = body.webhooks.find((item) => item.label === label);
  expect(row).toBeDefined();
  expect(row?.is_active).toBe(1);
  expect(row?.created_at).toBeGreaterThan(0);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: `Delete ${label}` }).click();
  await expect(page.getByText(label, { exact: true })).toHaveCount(0);
});

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
    await expect(
      page
        .locator("[data-basalt-surface-root]")
        .getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Manage your account and webhook tokens")).toBeVisible();

    // Account section — localhost stamps dev@localhost into the session.
    await expect(page.getByText("Account", { exact: true })).toBeVisible();
    await expect(page.getByText("Cloudflare Access")).toBeVisible();

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
    let webhooks: Array<(typeof mockWebhooks)[number]> = [];
    await page.route("**/api/webhooks", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ webhooks }),
        });
      } else if (req.method() === "POST") {
        const body = req.postDataJSON();
        const created = {
          id: "wh-new",
          token: "tok-new-12345",
          label: body.label,
          is_active: 1,
          created_at: Date.now(),
          last_used_at: null,
        };
        webhooks = [created];
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ webhook: created }),
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
    let row = { ...mockWebhooks[0] };
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks: [row] }),
      });
    });

    await page.route("**/api/webhooks/wh-1", async (route) => {
      const req = route.request();
      if (req.method() === "PATCH") {
        const body = req.postDataJSON();
        row = { ...row, is_active: body.isActive ? 1 : 0 };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ webhook: row }),
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
    let webhooks: Array<(typeof mockWebhooks)[number]> = [...mockWebhooks];
    await page.route("**/api/webhooks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ webhooks }),
      });
    });

    await page.route("**/api/webhooks/wh-1", async (route) => {
      if (route.request().method() === "DELETE") {
        webhooks = webhooks.filter((w) => w.id !== "wh-1");
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
