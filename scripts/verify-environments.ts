import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { startLocalRuntime, validateOwned } from "./environments/runtime";
import { startLocalServer } from "./environments/server";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } =
  require("@playwright/test") as typeof import("../apps/web/node_modules/@playwright/test");
const browser = await chromium.launch();
const servers: Array<Awaited<ReturnType<typeof startLocalServer>>> = [];
const select = async (
  server: (typeof servers)[number],
  mode: string,
  instance = server.descriptor().instanceId,
) => {
  const response = await fetch(`${server.url}/__local/environment/select`, {
    method: "POST",
    headers: {
      origin: server.url,
      "content-type": "application/json",
      "x-otter-local-csrf": server.descriptor().csrfToken,
    },
    body: JSON.stringify({ mode, instanceId: instance }),
  });
  return response;
};
try {
  const manual = await startLocalServer({ built: true, port: 0 });
  servers.push(manual);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const external: string[] = [];
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith("https://fonts.googleapis.com/")) {
      await route.fulfill({ status: 200, contentType: "text/css", body: "" });
    } else if (new URL(route.request().url()).origin !== manual.url) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  await page.goto(manual.url);
  await page.getByRole("heading", { name: "Your machines" }).waitFor();
  await page.getByRole("heading", { name: "Studio Mac" }).waitFor();
  assert.equal(
    await page.getByRole("radio", { name: "Demo", exact: true }).getAttribute("aria-checked"),
    "true",
  );
  const actions = page.locator("header > div").last();
  assert.equal(
    await actions
      .locator(":scope > *")
      .first()
      .evaluate((node) => node.tagName),
    "FIELDSET",
  );
  await page.screenshot({ path: "/tmp/otter-environments-demo.png", fullPage: true });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  assert.equal(await page.locator("html").getAttribute("data-mode"), "dark");
  await page.waitForTimeout(350);
  await page.screenshot({ path: "/tmp/otter-environments-demo-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const segment = page.getByRole("radio", { name: "Demo", exact: true });
  const rect = await segment.boundingBox();
  assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 390);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "/tmp/otter-environments-mobile-dark.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  const oldDemo = manual.descriptor().instanceId;
  await page.getByRole("radio", { name: "E2E", exact: true }).click();
  await page.getByText("No matching machines yet").waitFor();
  assert.equal(manual.descriptor().mode, "e2e");
  assert.equal((await fetch(`${manual.url}/__local/instances/${oldDemo}/api/me`)).status, 409);
  const firstE2e = manual.runtime;
  assert.ok(firstE2e);
  assert.equal((await fetch(`${firstE2e.url}/api/snapshots`)).status, 401);
  assert.equal(
    (await fetch(`${firstE2e.url}/api/me`, { headers: { authorization: "Bearer bad" } })).status,
    403,
  );
  await page.goto(`${manual.url}/settings`);
  await page.getByRole("button", { name: "New Token" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Unsaved local draft");
  await page.keyboard.press("Escape");
  const instance = manual.descriptor().instanceId;
  await page.getByRole("radio", { name: "Demo", exact: true }).click();
  const cancel = page.getByRole("alertdialog").getByRole("button", { name: "Cancel" });
  await cancel.waitFor();
  await page.waitForTimeout(200);
  assert.equal(await cancel.evaluate((node) => document.activeElement === node), true);
  await page.screenshot({ path: "/tmp/otter-environments-confirm.png", fullPage: true });
  await cancel.click();
  assert.equal(manual.descriptor().instanceId, instance);
  await page.getByRole("radio", { name: "Demo", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard and switch" }).click();
  await page.getByRole("heading", { name: "Studio Mac" }).waitFor();
  assert.equal(existsSync(firstE2e.state.path), false);
  await page.getByRole("radio", { name: "E2E", exact: true }).click();
  await page.getByText("No matching machines yet").waitFor();
  assert.notEqual(manual.runtime?.instanceId, firstE2e.instanceId);
  await page.getByRole("radio", { name: "Prod", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent === "Prod",
  );
  await page.getByRole("heading", { name: "Your machines" }).waitFor();
  assert.equal(manual.descriptor().mode, "prod");
  const response = await fetch(
    `${manual.url}/__local/instances/${manual.descriptor().instanceId}/api/me`,
  );
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Production sign-in required/);
  await page.getByRole("radio", { name: "Demo", exact: true }).click();
  await page.getByRole("heading", { name: "Studio Mac" }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("otter:environment-mode")), "demo");
  assert.deepEqual(external, []);
  await context.close();
  await manual.close();

  const automated = await startLocalServer({ mode: "e2e", automated: true, built: true, port: 0 });
  servers.push(automated);
  assert.equal((await select(automated, "prod")).status, 409);
  const automatedPage = await browser.newPage();
  await automatedPage.goto(automated.url);
  await automatedPage.getByRole("heading", { name: "Your machines" }).waitFor();
  assert.equal(
    await automatedPage.getByRole("radio", { name: "Demo", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await automatedPage.getByRole("radio", { name: "Prod", exact: true }).isDisabled(),
    true,
  );
  await automatedPage.close();
  const autoState = automated.runtime?.state.path;
  await automated.close();
  assert.equal(existsSync(autoState ?? ""), false);

  const hosted = await startLocalServer({
    mode: "e2e",
    automated: true,
    hosted: true,
    built: true,
    port: 0,
  });
  servers.push(hosted);
  const hostedPage = await browser.newPage();
  await hostedPage.addInitScript(() => {
    localStorage.setItem("otter:environment-mode", "prod");
  });
  await hostedPage.goto(hosted.url);
  await hostedPage.getByRole("heading", { name: "Your machines" }).waitFor();
  assert.equal(await hostedPage.getByRole("group", { name: "Environment" }).count(), 0);
  assert.equal((await select(hosted, "prod")).status, 403);
  await hostedPage.close();
  await hosted.close();

  const [a, b] = await Promise.all([
    startLocalRuntime("e2e", { automated: true }),
    startLocalRuntime("e2e", { automated: true }),
  ]);
  try {
    assert.notEqual(a.state.path, b.state.path);
    assert.notEqual(a.email, b.email);
    const created = await a.request("/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Isolated token" }),
    });
    assert.equal(created.status, 200);
    assert.deepEqual(
      ((await (await b.request("/api/webhooks")).json()) as { webhooks: unknown[] }).webhooks,
      [],
    );
    await assert.rejects(validateOwned({ path: "/tmp", owner: a.state.owner }));
    const ownerPath = join(a.state.path, "owner.json");
    const owner = await readFile(ownerPath, "utf8");
    await writeFile(ownerPath, owner.replace(a.state.owner.id, "foreign-owner"));
    await assert.rejects(a.stop(), /ownership mismatch/);
    assert.equal(existsSync(a.state.path), true);
    await writeFile(ownerPath, owner);
    await a.stop();
  } finally {
    await Promise.all([a.stop(), b.stop()]);
  }
  console.log(
    "Passed: local toolbar, manual lifecycle, stale requests, draft cancellation, Prod auth-required state, automated lock, hosted invisibility, concurrent isolation, guarded cleanup.",
  );
} finally {
  await browser.close();
  await Promise.all(servers.map((server) => server.close()));
}
