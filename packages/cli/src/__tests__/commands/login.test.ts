import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseCallbackParams,
  resolveHost,
  buildWebhookUrl,
  checkPortAvailable,
  findAvailablePort,
  executeLogin,
} from "../../commands/login.js";
import { ConfigManager } from "../../config/manager.js";

// ---------------------------------------------------------------------------
// parseCallbackParams
// ---------------------------------------------------------------------------

describe("parseCallbackParams", () => {
  it("should parse valid callback with token", () => {
    const result = parseCallbackParams("/callback?token=abc-123");
    expect(result).toEqual({ token: "abc-123" });
  });

  it("should return error when token is missing", () => {
    const result = parseCallbackParams("/callback");
    expect(result).toEqual({
      error: "Missing token in callback",
    });
  });

  it("should return error param if present", () => {
    const result = parseCallbackParams(
      "/callback?error=User%20cancelled"
    );
    expect(result).toEqual({ error: "User cancelled" });
  });

  it("should prioritize error over token", () => {
    const result = parseCallbackParams(
      "/callback?error=bad&token=abc"
    );
    expect(result).toEqual({ error: "bad" });
  });
});

// ---------------------------------------------------------------------------
// resolveHost
// ---------------------------------------------------------------------------

describe("resolveHost", () => {
  it("should return default host when --dev is not set", () => {
    const host = resolveHost({});
    expect(host).toBe("https://otter.hexly.ai");
  });

  it("should return dev host when --dev is set", () => {
    const host = resolveHost({ dev: true });
    expect(host).toBe("https://otter.dev.hexly.ai");
  });
});

// ---------------------------------------------------------------------------
// buildWebhookUrl
// ---------------------------------------------------------------------------

describe("buildWebhookUrl", () => {
  it("should build webhook URL from host and token", () => {
    const url = buildWebhookUrl("https://otter.hexly.ai", "abc-123");
    expect(url).toBe("https://otter.hexly.ai/api/webhook/abc-123");
  });

  it("should build dev webhook URL", () => {
    const url = buildWebhookUrl("https://otter.dev.hexly.ai", "dev-token");
    expect(url).toBe("https://otter.dev.hexly.ai/api/webhook/dev-token");
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
          // Hit the callback with token only
          fetch(
            `${callbackBase}/callback?token=test-token`
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
    expect(result.token).toBe("test-token");
    expect(browserUrl).toContain("https://otter.hexly.ai/cli/connect?callback=");
  });

  it("should save token to config after success", async () => {
    const loginPromise = executeLogin(configManager, {}, {
      openBrowser: (url) => {
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);
          fetch(
            `${callbackBase}/callback?token=saved-token`
          ).catch(() => {});
        }
      },
      onBrowserOpen: () => {},
      onPortReady: () => {},
      onSuccess: () => {},
    });

    await loginPromise;

    const config = await configManager.load();
    expect(config.token).toBe("saved-token");
  });

  it("should use dev host when --dev is set", async () => {
    const loginPromise = executeLogin(configManager, { dev: true }, {
      openBrowser: (url) => {
        const callbackMatch = url.match(/callback=([^&]+)/);
        if (callbackMatch) {
          const callbackBase = decodeURIComponent(callbackMatch[1]);
          fetch(
            `${callbackBase}/callback?token=dev-token`
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
            `${callbackBase}/callback?token=t`
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
            `${callbackBase}/callback?token=t`
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
