import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Snapshot } from "@otter/core";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

function fixture(id: string): Snapshot {
  const snapshot = JSON.parse(
    readFileSync(new URL("../../../../scripts/fixtures/snapshot-v2.json", import.meta.url), "utf8"),
  ) as Snapshot;
  snapshot.id = id;
  return snapshot;
}
const older = fixture("browser-v3-complete"),
  newer = fixture("browser-v3-partial");
older.createdAt = "2026-09-15T00:00:00.000Z";
newer.createdAt = "2026-09-16T00:00:00.000Z";
if (!older.workspace || !newer.workspace) throw new Error("Recovery fixture must use v2");
newer.workspace.coverage.complete = false;
newer.workspace.coverage.issues.push({
  rootId: "claude:default",
  path: "/Users/fixture/.claude/skills/unreadable",
  status: "error",
  reason: "Fixture drive was unavailable during capture",
});
const changed = newer.collectors
  .flatMap((c) => c.files)
  .find((f) => f.path.endsWith("scripts/run.sh"));
if (!changed) throw new Error("Fixture script missing");
newer.workspace.coverage.bytes -= changed.sizeBytes;
changed.content = "#!/bin/sh\necho modified\n";
changed.sizeBytes = Buffer.byteLength(changed.content);
changed.sha256 = createHash("sha256").update(changed.content).digest("hex");
newer.workspace.coverage.bytes += changed.sizeBytes;

test.beforeAll(async ({ request }) => {
  for (const snapshot of [older, newer]) {
    // biome-ignore lint/performance/noAwaitInLoops: deterministic history in the isolated local Worker
    const response = await request.post("/api/snapshots", { data: snapshot });
    expect(response.ok(), await response.text()).toBe(true);
  }
});

test("browses real cloud history by machine and Hermes profile, then downloads a standalone persona", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const card = page.locator("article").filter({ hasText: "Recovery Mac" });
  await expect(card.getByText("Partial capture")).toBeVisible();
  await expect(card.getByRole("link", { name: "Latest complete snapshot" })).toHaveAttribute(
    "href",
    `/snapshots/${older.id}`,
  );
  await card.getByRole("link", { name: "Browse machine" }).click();
  await page.getByRole("tab", { name: "Agents & profiles" }).click();
  const profile = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "hermes cherry" }) });
  await profile.getByRole("button", { name: "Browse profile" }).click();
  await expect(
    page.getByRole("table", { name: "Configuration resources" }).getByRole("row"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "SOUL.md", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("cherry", { exact: false }).last()).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download file", exact: true }).click();
  const persona = await download;
  const path = testInfo.outputPath("SOUL.md");
  await persona.saveAs(path);
  expect(readFileSync(path, "utf8")).toContain("cherry");
  await page.screenshot({ path: testInfo.outputPath("hermes-persona.png"), fullPage: true });
});

test("downloads complete local skills, global instructions and environment inventories without the source machine", async ({
  page,
}, testInfo) => {
  await page.goto(`/snapshots/${older.id}`);
  await page.getByRole("tab", { name: "Files & resources" }).click();
  await page.getByRole("textbox", { name: "Search resources" }).fill("local");
  await page.getByRole("button", { name: "local", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "skills/local/scripts/run.sh", exact: true }).click();
  await expect(dialog.getByText("echo recovered", { exact: false })).toBeVisible();
  const packageDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download package" }).click();
  const packagePath = testInfo.outputPath("local.zip");
  await (await packageDownload).saveAs(packagePath);
  const pack = unzipSync(new Uint8Array(readFileSync(packagePath)));
  expect(
    strFromU8(pack["roots/claude%3Adefault/skills/local/scripts/run.sh"] ?? new Uint8Array()),
  ).toContain("echo recovered");
  expect(pack["snapshot.json"]).toBeUndefined();
  await page.keyboard.press("Escape");
  const fullDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery ZIP", exact: true }).click();
  const fullPath = testInfo.outputPath("machine.zip");
  await (await fullDownload).saveAs(fullPath);
  const full = unzipSync(new Uint8Array(readFileSync(fullPath)));
  expect(full["roots/workflow/AGENTS.md"]).toBeDefined();
  expect(strFromU8(full["environment.json"] ?? new Uint8Array())).toContain("Cursor");
  expect(strFromU8(full["links.json"] ?? new Uint8Array())).toContain("CLAUDE.md");
});

test("searches historical files and compares versions in capture order, preserving incomplete-scan warnings", async ({
  page,
}, testInfo) => {
  await page.goto("/snapshots?device=fixture-stable-device");
  await page.getByRole("textbox", { name: "Search snapshots" }).fill("scripts/run.sh");
  await expect(page.getByRole("table", { name: "Snapshots list" }).getByRole("row")).toHaveCount(3);
  await page.getByRole("checkbox", { name: `Compare ${newer.id}`, exact: true }).check();
  await page.getByRole("checkbox", { name: `Compare ${older.id}`, exact: true }).check();
  await page.getByRole("link", { name: "Compare selected" }).click();
  await expect(page).toHaveURL(new RegExp(`before=${older.id}&after=${newer.id}`));
  await expect(page.getByText("The later scan is incomplete.", { exact: false })).toBeVisible();
  await page.locator("summary").filter({ hasText: "scripts/run.sh" }).click();
  await expect(page.getByText("echo modified", { exact: false })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("configuration-comparison.png"),
    fullPage: true,
  });
});
