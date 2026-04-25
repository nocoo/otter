/**
 * L2 CLI binary E2E — spawn the built CLI (dist/bin.js) end-to-end and
 * verify it boots, reads/writes config, and round-trips a token through a
 * real /api/webhooks → otter config set → otter config get pipe.
 *
 * Scope kept lightweight on purpose: we do NOT exercise `otter backup`
 * because that scans the host machine and isn't reproducible in CI. The
 * goal is to catch regressions in the published binary's startup path,
 * not to re-test scan logic (covered in L1).
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseUrl = (() => {
  const u = process.env.OTTER_L2_BASE_URL;
  if (!u) throw new Error("OTTER_L2_BASE_URL not set — globalSetup didn't run");
  return u;
})();

const REPO_ROOT = resolve(__dirname, "../..");
const CLI_BIN = resolve(REPO_ROOT, "cli/dist/bin.js");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let homeDir: string;
let createdWebhookId: string | null = null;

function runCli(args: string[]): RunResult {
  const r = spawnSync("node", [CLI_BIN, ...args], {
    env: {
      ...process.env,
      HOME: homeDir,
      OTTER_API_URL: baseUrl,
      // Disable auto-update fetch noise in tests.
      NO_COLOR: "1",
    },
    encoding: "utf8",
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

beforeAll(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "otter-l2-cli-"));
});

afterAll(async () => {
  if (createdWebhookId) {
    await fetch(`${baseUrl}/api/webhooks/${createdWebhookId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }
  if (homeDir) await rm(homeDir, { recursive: true, force: true });
});

describe("L2 CLI binary", () => {
  it("--help exits 0 and lists subcommands", () => {
    const r = runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/scan|backup|login|config/i);
  });

  it("config show on a fresh HOME prints empty/default config without crashing", () => {
    const r = runCli(["config", "show"]);
    expect(r.exitCode).toBe(0);
    // The boxed Configuration banner always renders.
    expect(r.stdout + r.stderr).toMatch(/Config(uration)?/i);
  });

  it("config set then config get round-trips a value through ~/.config/otter", () => {
    const setRes = runCli(["config", "set", "token", "otk_e2e_dummy"]);
    expect(setRes.exitCode).toBe(0);

    const getRes = runCli(["config", "get", "token"]);
    expect(getRes.exitCode).toBe(0);
    expect(getRes.stdout.trim()).toBe("otk_e2e_dummy");
  });

  it("can store a real /api/webhooks token and read it back via the binary", async () => {
    const res = await fetch(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: `l2-cli-${Date.now()}` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { webhook: { id: string; token: string } };
    createdWebhookId = body.webhook.id;
    const realToken = body.webhook.token;

    const setRes = runCli(["config", "set", "token", realToken]);
    expect(setRes.exitCode).toBe(0);

    const getRes = runCli(["config", "get", "token"]);
    expect(getRes.exitCode).toBe(0);
    expect(getRes.stdout.trim()).toBe(realToken);
  });
});
