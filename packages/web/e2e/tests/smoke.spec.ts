import { test, expect } from "@playwright/test";

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

test("dashboard snapshot detail renders rich collector metadata", async ({ page }) => {
  await page.route("**/api/snapshots/rich-meta", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        snapshot: {
          id: "rich-meta",
          hostname: "otter-mac",
          platform: "darwin",
          arch: "arm64",
          username: "nocoo",
          collectorCount: 2,
          fileCount: 1,
          listCount: 3,
          sizeBytes: 1024,
          snapshotAt: Date.now(),
          uploadedAt: Date.now(),
        },
        data: {
          version: 1,
          id: "rich-meta",
          createdAt: new Date().toISOString(),
          machine: {
            hostname: "otter-mac",
            platform: "darwin",
            arch: "arm64",
            username: "nocoo",
          },
          collectors: [
            {
              id: "homebrew",
              label: "Homebrew Packages",
              category: "environment",
              files: [],
              lists: [
                {
                  name: "bun",
                  version: "1.3.9",
                  meta: { type: "formula", pinned: "true" },
                },
              ],
              errors: [],
            },
            {
              id: "vscode",
              label: "VS Code / Cursor Configuration",
              category: "config",
              files: [
                {
                  path: "/tmp/settings.json",
                  content: '{"token":"[REDACTED]"}',
                  sizeBytes: 24,
                },
              ],
              lists: [
                {
                  name: "github.copilot",
                  version: "1.300.0",
                  meta: { type: "vscode-extension", editor: "vscode" },
                },
                {
                  name: "desktop-linux",
                  meta: { type: "docker-context", current: "true" },
                },
              ],
              errors: [],
            },
          ],
        },
      }),
    });
  });

  await page.goto("/snapshots/rich-meta");
  await expect(page.getByText("pinned: true")).toBeVisible();
  await expect(page.getByText("editor: vscode")).toBeVisible();
  await expect(page.getByText("current: true")).toBeVisible();
  await page.getByPlaceholder("Search collectors, files, items, or metadata...").fill("copilot");
  await expect(page.getByText("VS Code / Cursor Configuration")).toBeVisible();
  await expect(page.getByText("Homebrew Packages")).not.toBeVisible();
  await page.getByRole("button", { name: "Environment" }).click();
  await expect(page.getByText("No collectors match the current filters.")).toBeVisible();
});
