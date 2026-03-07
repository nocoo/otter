import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseCallbackParams,
  resolveHost,
  checkPortAvailable,
  findAvailablePort,
  executeLogin,
} from "../../commands/login.js";
import { ConfigManager } from "../../config/manager.js";

// ---------------------------------------------------------------------------
// parseCallbackParams
// ---------------------------------------------------------------------------

describe("parseCallbackParams", () => {
  it("should parse valid callback with token and webhookUrl", () => {
    const result = parseCallbackParams(
      "/callback?token=abc-123&webhookUrl=https%3A%2F%2Fotter.hexly.ai%2Fapi%2Fwebhook%2Fabc-123"
    );
    expect(result).toEqual({
      token: "abc-123",
      webhookUrl: "https://otter.hexly.ai/api/webhook/abc-123",
    });
  });

  it("should return error when token is missing", () => {
    const result = parseCallbackParams(
      "/callback?webhookUrl=https%3A%2F%2Fexample.com"
    );
    expect(result).toEqual({
      error: "Missing token or webhookUrl in callback",
    });
  });

  it("should return error when webhookUrl is missing", () => {
    const result = parseCallbackParams("/callback?token=abc-123");
    expect(result).toEqual({
      error: "Missing token or webhookUrl in callback",
    });
  });

  it("should return error when both params are missing", () => {
    const result = parseCallbackParams("/callback");
    expect(result).toEqual({
      error: "Missing token or webhookUrl in callback",
    });
  });

  it("should return error param if present", () => {
    const result = parseCallbackParams(
      "/callback?error=User%20cancelled"
    );
    expect(result).toEqual({ error: "User cancelled" });
  });

  it("should prioritize error over token/webhookUrl", () => {
    const result = parseCallbackParams(
      "/callback?error=bad&token=abc&webhookUrl=http://x"
    );
    expect(result).toEqual({ error: "bad" });
  });
});

// ---------------------------------------------------------------------------
// resolveHost
// ---------------------------------------------------------------------------

describe("resolveHost", () => {
  it("should return default host when no config or options", () => {
    const host = resolveHost({}, {});
    expect(host).toBe("https://otter.hexly.ai");
  });

  it("should return dev host when --dev is set", () => {
    const host = resolveHost({}, { dev: true });
    expect(host).toBe("https://otter.dev.hexly.ai");
  });

  it("should return config host when set", () => {
    const host = resolveHost({ host: "https://custom.example.com" }, {});
    expect(host).toBe("https://custom.example.com");
  });

  it("should prefer --dev over config host", () => {
    const host = resolveHost(
      { host: "https://custom.example.com" },
      { dev: true }
    );
    expect(host).toBe("https://otter.dev.hexly.ai");
  });
});

// ---------------------------------------------------------------------------
// checkPortAvailable
// ---------------------------------------------------------------------------

describe("checkPortAvailable", () => {
  it("should return true for a port that is not in use", async () => {
    // Port 0 is never listening — pick a high ephemeral port
    const available = await checkPortAvailable(19999);
    expect(available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findAvailablePort
// ---------------------------------------------------------------------------

describe("findAvailablePort", () => {
  it("should find a port in the ephemeral range", async () => {
    const port = await findAvailablePort();
    expect(port).toBeGreaterThanOrEqual(49152);
    expect(port).toBeLessThanOrEqual(65535);
  });
});

// ---------------------------------------------------------------------------
// executeLogin — full integration
// ---------------------------------------------------------------------------

describe("executeLogin", () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-login-"));
    configManager = new ConfigManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should open browser with correct connect URL", async () => {
    let browserUrl = "";

    // Start login, then immediately simulate a callback
    const loginPromise = executeLogin(configManager, {}, {
      openBrowser: (url) => {
        browserUrl = url;

        // Simulate: extract the callback port and hit it
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);
          // Hit the callback with token + webhookUrl
          fetch(
            `${callbackBase}/callback?token=test-token&webhookUrl=${encodeURIComponent("https://otter.hexly.ai/api/webhook/test-token")}`
          ).catch(() => {});
        }
      },
      onBrowserOpen: () => {},
      onPortReady: () => {},
      onSuccess: () => {},
    });

    const result = await loginPromise;

    expect(result.success).toBe(true);
    expect(result.host).toBe("https://otter.hexly.ai");
    expect(result.webhookUrl).toBe(
      "https://otter.hexly.ai/api/webhook/test-token"
    );
    expect(browserUrl).toContain("https://otter.hexly.ai/cli/connect?callback=");
  });

  it("should save webhookUrl and host to config after success", async () => {
    const loginPromise = executeLogin(configManager, {}, {
      openBrowser: (url) => {
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);
          fetch(
            `${callbackBase}/callback?token=saved-token&webhookUrl=${encodeURIComponent("https://otter.hexly.ai/api/webhook/saved-token")}`
          ).catch(() => {});
        }
      },
      onBrowserOpen: () => {},
      onPortReady: () => {},
      onSuccess: () => {},
    });

    await loginPromise;

    const config = await configManager.load();
    expect(config.webhookUrl).toBe(
      "https://otter.hexly.ai/api/webhook/saved-token"
    );
    expect(config.host).toBe("https://otter.hexly.ai");
  });

  it("should use dev host when --dev is set", async () => {
    const loginPromise = executeLogin(configManager, { dev: true }, {
      openBrowser: (url) => {
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);
          fetch(
            `${callbackBase}/callback?token=dev-token&webhookUrl=${encodeURIComponent("https://otter.dev.hexly.ai/api/webhook/dev-token")}`
          ).catch(() => {});
        }
      },
      onBrowserOpen: () => {},
      onPortReady: () => {},
      onSuccess: () => {},
    });

    const result = await loginPromise;

    expect(result.success).toBe(true);
    expect(result.host).toBe("https://otter.dev.hexly.ai");
  });

  it("should return error when callback has error param", async () => {
    const loginPromise = executeLogin(configManager, {}, {
      openBrowser: (url) => {
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);
          fetch(
            `${callbackBase}/callback?error=${encodeURIComponent("User cancelled")}`
          ).catch(() => {});
        }
      },
      onBrowserOpen: () => {},
      onPortReady: () => {},
      onError: () => {},
    });

    const result = await loginPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("User cancelled");
  });

  it("should call onPortReady with a valid port", async () => {
    let reportedPort = 0;

    const loginPromise = executeLogin(configManager, {}, {
      openBrowser: (url) => {
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);
          fetch(
            `${callbackBase}/callback?token=t&webhookUrl=${encodeURIComponent("https://x.com/api/webhook/t")}`
          ).catch(() => {});
        }
      },
      onBrowserOpen: () => {},
      onPortReady: (port) => {
        reportedPort = port;
      },
      onSuccess: () => {},
    });

    await loginPromise;

    expect(reportedPort).toBeGreaterThanOrEqual(49152);
    expect(reportedPort).toBeLessThanOrEqual(65535);
  });

  it("should return 404 for non-callback paths", async () => {
    let responseStatus = 0;

    const loginPromise = executeLogin(configManager, {}, {
      openBrowser: async (url) => {
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);

          // Hit a wrong path first
          try {
            const res = await fetch(`${callbackBase}/wrong-path`);
            responseStatus = res.status;
          } catch {
            // ignore
          }

          // Then hit the correct path to let the test finish
          fetch(
            `${callbackBase}/callback?token=t&webhookUrl=${encodeURIComponent("https://x.com/api/webhook/t")}`
          ).catch(() => {});
        }
      },
      onBrowserOpen: () => {},
      onPortReady: () => {},
      onSuccess: () => {},
    });

    await loginPromise;

    expect(responseStatus).toBe(404);
  });
});
