import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { assertTestCredentials, isMode, isolatedEnv, ROOT } from "../environments/runtime";

describe("local-only E2E startup policy", () => {
  it.each([
    "CF_API_TOKEN",
    "CF_D1_API_TOKEN",
    "CF_D1_DATABASE_ID",
    "CLOUDFLARE_API_TOKEN",
    "CF_ACCESS_CLIENT_SECRET",
    "OTTER_DEV_API_TOKEN",
  ])("rejects %s before starting resources", (name) => {
    expect(() => assertTestCredentials({ [name]: "fixture-only" })).toThrow(
      "refuses production credentials",
    );
  });
  it("allows a credential-free environment and filters child process credentials", () => {
    expect(() => assertTestCredentials({ PATH: "/usr/bin" })).not.toThrow();
    const env = isolatedEnv();
    expect(env.CF_API_TOKEN).toBeUndefined();
    expect(env.OTTER_DEV_API_TOKEN).toBeUndefined();
    expect(env.OTTER_AUTOMATED_E2E).toBe("true");
    expect(isMode("demo")).toBe(true);
    expect(isMode("e2e")).toBe(true);
    expect(isMode("prod")).toBe(true);
    expect(isMode("https://production.invalid")).toBe(false);
  });
  it("keeps both browser runners on the dedicated locked local entrypoint", async () => {
    const configs = await Promise.all(
      ["playwright.config.ts", "apps/web/e2e/playwright.config.ts"].map((path) =>
        readFile(`${ROOT}/${path}`, "utf8"),
      ),
    );
    for (const config of configs) {
      expect(config).toContain("scripts/run-e2e-spa.ts");
      expect(config).toContain("reuseExistingServer: false");
      expect(config).toContain("gracefulShutdown");
      expect(config).not.toContain("bun run --cwd apps/web dev");
    }
    const vite = await readFile(`${ROOT}/apps/web/vite.config.ts`, "utf8");
    expect(vite).not.toContain("proxy:");
    expect(vite).not.toContain("otter.worker.hexly.ai");
  });
});
