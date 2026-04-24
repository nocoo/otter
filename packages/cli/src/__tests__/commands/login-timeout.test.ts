import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nocoo/cli-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nocoo/cli-base")>();
  return {
    ...actual,
    performLogin: vi.fn(),
    openBrowser: vi.fn(),
  };
});

const { performLogin } = await import("@nocoo/cli-base");
const { executeLogin } = await import("../../commands/login.js");
const { ConfigManager } = await import("../../config/manager.js");

describe("executeLogin — error branch coverage", () => {
  let tempDir: string;
  let configManager: InstanceType<typeof ConfigManager>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-login-timeout-"));
    configManager = new ConfigManager(tempDir);
    vi.mocked(performLogin).mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("invokes onTimeout callback when performLogin reports a timeout error", async () => {
    vi.mocked(performLogin).mockResolvedValue({
      success: false,
      error: "Login timeout after 30000ms",
    });

    const events: string[] = [];
    const result = await executeLogin(
      configManager,
      {},
      {
        onTimeout: () => events.push("timeout"),
        onError: () => events.push("error"),
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
    expect(events).toEqual(["timeout"]);
  });

  it("returns success with token when performLogin succeeds and config has token", async () => {
    vi.mocked(performLogin).mockImplementation(async (opts) => {
      opts.onSaveToken?.("mocked-token");
      return { success: true };
    });

    const result = await executeLogin(configManager, {}, {});

    expect(result.success).toBe(true);
    expect(result.token).toBe("mocked-token");
    expect(result.host).toBe("https://otter.hexly.ai");
  });

  it("returns failure without invoking onError or onTimeout when error is missing", async () => {
    vi.mocked(performLogin).mockResolvedValue({ success: false });

    const events: string[] = [];
    const result = await executeLogin(
      configManager,
      {},
      {
        onTimeout: () => events.push("timeout"),
        onError: () => events.push("error"),
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeUndefined();
    expect(events).toEqual([]);
  });
});
