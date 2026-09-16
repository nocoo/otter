import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeLogin } from "../../commands/login.js";
import { runWorkspaceCommand } from "../../commands/workspace.js";

// OAuth callback/CSRF behavior has its own real-server suite. Isolate browser opening here
// to verify the native transport boundary without sending a user to a real login page.
vi.mock("../../commands/login.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../commands/login.js")>()),
  executeLogin: vi.fn(),
}));
let config: string;
beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), "otter-native-login-"));
});
afterEach(async () => {
  vi.clearAllMocks();
  await rm(config, { recursive: true, force: true });
});

async function login(format: string, development = false) {
  let stdout = "";
  const code = await runWorkspaceCommand(
    ["login", "--format", format, "--config-dir", config, ...(development ? ["--dev"] : [])],
    "test",
    {
      stdout: (value) => {
        stdout += value;
      },
      stderr: (value) => {
        expect(value).toBe("");
      },
    },
  );
  return {
    code,
    stdout,
    values: stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}

describe("native login transport", () => {
  it.each(["json", "ndjson"])(
    "reports login progress and redacted completion in %s",
    async (format) => {
      vi.mocked(executeLogin).mockImplementation(async (_manager, options, callbacks) => {
        callbacks?.onBrowserOpen?.("https://example.test/callback?state=fixture");
        return {
          success: true,
          host: options.dev ? "https://otter.dev.hexly.ai" : "https://otter.hexly.ai",
          token: "otk_private_fixture",
        };
      });
      const result = await login(format, true);
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("otk_private_fixture");
      const final = result.values.at(-1);
      expect(format === "json" ? final : final.data).toMatchObject({
        authenticated: true,
        configPath: join(config, "config.dev.json"),
      });
      if (format === "ndjson") {
        expect(result.values.map((e) => e.type)).toEqual(["started", "progress", "result"]);
        expect(result.values[1].data.phase).toBe("awaitingBrowser");
      }
    },
  );

  it.each([undefined, "OAuth callback refused"])(
    "keeps login failures explicit: %s",
    async (error) => {
      vi.mocked(executeLogin).mockResolvedValue({ success: false, error });
      const result = await login("ndjson");
      expect(result.code).toBe(1);
      expect(result.values.map((e) => e.type)).toEqual(["started", "error"]);
      expect(result.values[1].data.message).toBe(error ?? "Login failed");
    },
  );

  it("redacts unexpected string errors at the protocol boundary", async () => {
    vi.mocked(executeLogin).mockRejectedValue("Rejected Bearer otk_fixture_secret");
    const result = await login("json");
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain("otk_fixture_secret");
    expect(result.values[0].error.message).toContain("[REDACTED]");
  });
});
