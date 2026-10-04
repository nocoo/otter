import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { buildRichSnapshotFixture } from "../apps/web/e2e/support/rich-snapshot";
import { startLocalServer } from "./environments/server";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } =
  require("@playwright/test") as typeof import("../apps/web/node_modules/@playwright/test");
const output = resolve("test-results/basalt-acceptance");
await mkdir(output, { recursive: true });
const server = await startLocalServer({
  mode: "e2e",
  automated: true,
  built: true,
  port: 0,
  catalog: "demo",
});
const browser = await chromium.launch();
const errors: string[] = [];
const captures: string[] = [];
try {
  const legacy = buildRichSnapshotFixture("basalt-legacy");
  legacy.createdAt = "2026-09-17T00:00:00.000Z";
  const seeded = await fetch(`${server.url}/api/snapshots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(legacy),
  });
  assert.equal(seeded.status, 201);
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === server.url) await route.continue();
    else if (route.request().resourceType() === "image")
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" fill="#808080"/></svg>',
      });
    else await route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const capture = async (name: string) => {
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Horizontal overflow: ${name}`);
    const path = join(output, `${name}.png`);
    await page.screenshot({ path, fullPage: true });
    captures.push(path);
  };
  const routes = [
    ["machines", "/", "Your machines"],
    ["device", "/devices/demo-studio", "Studio Mac"],
    ["snapshots", "/snapshots", "Snapshots"],
    ["detail", "/snapshots/demo-studio-complete", "Snapshot demo-stu"],
    [
      "compare",
      "/compare?before=demo-studio-complete&after=demo-studio-partial",
      "Compare snapshots",
    ],
    ["settings", "/settings", "Settings"],
    [
      "cli",
      "/cli/connect?callback=http%3A%2F%2F127.0.0.1%3A65535%2Fcallback&state=fixture",
      "Connect CLI",
    ],
    ["not-found", "/not-a-page", "404"],
  ];
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      // biome-ignore lint/performance/noAwaitInLoops: the same browser page must switch viewports sequentially
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.addInitScript((mode) => {
        localStorage.setItem("theme", mode);
      }, theme);
      for (const [name, path, heading] of routes) {
        // biome-ignore lint/performance/noAwaitInLoops: isolated route/theme capture must remain ordered
        await page.goto(`${server.url}${path}`);
        await page
          .locator("[data-basalt-island]")
          .getByRole("heading", { name: heading, exact: true })
          .waitFor();
        await capture(`${name}-${theme}-${width}`);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.url}/snapshots/demo-studio-complete`);
  for (const name of [
    "Agents & profiles",
    "Files & resources",
    "Software & environment",
    "Coverage report",
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: verify each real-storage panel before capturing it
    await page.getByRole("tab", { name, exact: true }).click();
    await capture(`workspace-${name.replaceAll(" ", "-")}`);
  }
  await page.getByRole("tab", { name: "Files & resources", exact: true }).click();
  await page.getByRole("button", { name: "local", exact: true }).click();
  const resource = page.getByRole("dialog");
  assert.ok(
    (await resource.boundingBox())?.width &&
      ((await resource.boundingBox())?.width as number) >= 700,
  );
  await page.getByRole("button", { name: "Close resource viewer" }).waitFor();
  await capture("resource-viewer");
  await page.getByRole("button", { name: "Close resource viewer" }).click();
  await page.goto(`${server.url}/snapshots/basalt-legacy`);
  for (const name of [/Overview/, /Config.*5/, /Environment.*8/]) {
    // biome-ignore lint/performance/noAwaitInLoops: verify all legacy panels with unchanged collector data
    await page.getByRole("tab", { name }).click();
    await capture(`legacy-${name.source.replaceAll(".*", "-")}`);
  }
  await page.getByRole("tab", { name: /Config.*5/ }).click();
  await page.getByRole("button", { name: "View file" }).first().click();
  const viewer = page.getByRole("dialog");
  assert.ok(
    (await viewer.boundingBox())?.width && ((await viewer.boundingBox())?.width as number) >= 700,
  );
  await page.getByRole("button", { name: "Close file viewer" }).waitFor();
  await capture("file-viewer");
  await page.getByRole("button", { name: "Close file viewer" }).click();
  await page.goto(server.url);
  const logo = await page.locator("aside img[alt=Otter]").boundingBox();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.waitForTimeout(350);
  const collapsedLogo = await page.locator("aside img[alt=Otter]").boundingBox();
  assert.equal(logo?.x, collapsedLogo?.x);
  await page.getByRole("button", { name: /Sign out/ }).waitFor();
  assert.equal(
    await page.locator("aside").getByRole("link", { name: "Snapshots" }).getAttribute("href"),
    "/snapshots",
  );
  await capture("collapsed-sidebar");
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  await page.getByRole("dialog").getByRole("link", { name: "Snapshots" }).waitFor();
  await capture("mobile-navigation");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Open navigation",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(
      { basalt: "2.2.0", fixture: 1, locale: "en-US", routes, captures, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(
    `Passed: ${captures.length} Basalt captures; all routes, both themes, responsive layout, viewers and navigation. Evidence: ${output}`,
  );
} finally {
  await browser.close();
  await server.close();
}
