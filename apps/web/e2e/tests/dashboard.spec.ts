import { expect, test } from "@playwright/test";

const device = {
  id: "latest-partial",
  deviceKey: "stable-device",
  deviceId: "stable-device",
  hostname: "Recovery Mac",
  platform: "darwin",
  arch: "arm64",
  complete: false,
  fileCount: 12,
  listCount: 8,
  snapshotAt: Date.now() - 3600000,
  uploadedAt: Date.now(),
  latestCompleteId: "complete-before",
  summary: { sourceCount: 2, agentCount: 9, resourceCount: 20, issues: 1 },
};

test("machine cards separate capture coverage from receipt time, with links to the last complete backup", async ({
  page,
}) => {
  await page.route("**/api/snapshots/devices", (route) =>
    route.fulfill({ json: { devices: [device] } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your machines" })).toBeVisible();
  const card = page.locator("article").filter({ hasText: "Recovery Mac" });
  await expect(card.getByText("Partial capture")).toBeVisible();
  await expect(card.getByText("2 sources")).toBeVisible();
  await expect(card.getByText("9 agent profiles")).toBeVisible();
  await expect(card.getByText(/Captured/)).toBeVisible();
  await expect(card.getByText(/Received/)).toBeVisible();
  await expect(card.getByRole("link", { name: "Latest complete snapshot" })).toHaveAttribute(
    "href",
    "/snapshots/complete-before",
  );
  await card.getByRole("link", { name: "Browse machine" }).click();
  await expect(page).toHaveURL(/\/devices\/stable-device$/);
});

test("machine search and first backup guidance are usable without a webhook", async ({ page }) => {
  await page.route("**/api/snapshots/devices", (route) =>
    route.fulfill({ json: { devices: [device] } }),
  );
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search machines" }).fill("absent");
  await expect(page.getByText("No matching machines yet")).toBeVisible();
  await expect(page.getByText("otter source add", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "Search machines" }).fill("recovery");
  await expect(page.getByRole("heading", { name: "Recovery Mac" })).toBeVisible();
  await page.getByRole("link", { name: "All snapshots", exact: false }).click();
  await expect(page).toHaveURL(/\/snapshots$/);
});

test("machine errors can be retried without losing the page", async ({ page }) => {
  let fail = true;
  await page.route("**/api/snapshots/devices", (route) =>
    route.fulfill(fail ? { status: 500, json: { error: "temporary" } } : { json: { devices: [] } }),
  );
  await page.goto("/");
  await expect(page.getByText("Unable to load machines.")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No matching machines yet")).toBeVisible();
});
