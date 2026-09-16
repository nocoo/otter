#!/usr/bin/env bun
import assert from "node:assert/strict";
import { version } from "../package.json";

const ASSET_PATTERN = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g;
const ROOT_PATTERN = /<div\b[^>]*\bid="root"/;

/** Exercise the same deployed Worker + SPA paths locally and after release. */
export async function verifyWeb(baseUrl: string): Promise<void> {
  const get = async (path: string, navigation = false): Promise<Response> => {
    const response = await fetch(new URL(path, baseUrl), {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      headers: navigation ? { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } : {},
    });
    assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
    return response;
  };

  const live = (await (await get("/api/live")).json()) as { status: string; version: string };
  assert.equal(live.status, "ok", "API health check failed");
  assert.equal(live.version, version, "Deployed version differs from this checkout");

  const html = await (await get("/", true)).text();
  assert.match(html, ROOT_PATTERN, "SPA root is missing");
  const assets = [...html.matchAll(ASSET_PATTERN)].map((match) => match[1] as string);
  assert(
    assets.some((path) => path.endsWith(".js")),
    "No built JavaScript in the page",
  );
  assert(
    assets.some((path) => path.endsWith(".css")),
    "No built stylesheet in the page",
  );
  await Promise.all(
    assets.map(async (path) => {
      const response = await get(path);
      const expectedType = path.endsWith(".js") ? "javascript" : "text/css";
      assert(
        response.headers.get("content-type")?.includes(expectedType),
        `${path}: expected ${expectedType}, received ${response.headers.get("content-type")}`,
      );
      assert((await response.text()).length > 0, `${path}: empty asset`);
    }),
  );

  const deepLink = await (await get("/settings", true)).text();
  assert.equal(deepLink, html, "SPA fallback failed for /settings");
  console.log(
    `Verified Web v${version}: API, ${assets.length} assets and SPA routing (${baseUrl})`,
  );
}

if (import.meta.main) {
  await verifyWeb(process.argv[2] ?? "https://otter.nocoo.workers.dev");
}
