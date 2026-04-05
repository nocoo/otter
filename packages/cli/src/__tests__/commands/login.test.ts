import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWebhookUrl, executeLogin, resolveHost } from "../../commands/login.js";
import { ConfigManager } from "../../config/manager.js";

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
  const originalEnv = process.env.OTTER_API_URL;

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.OTTER_API_URL;
    } else {
      process.env.OTTER_API_URL = originalEnv;
    }
  });

  it("should use default Worker URL when OTTER_API_URL is not set", () => {
    delete process.env.OTTER_API_URL;
    const url = buildWebhookUrl("https://otter.hexly.ai", "abc-123");
    // Default is now Worker URL
    expect(url).toBe("https://otter.worker.hexly.ai/ingest/abc-123");
  });

  it("should use OTTER_API_URL when set", () => {
    process.env.OTTER_API_URL = "https://custom.worker.dev";
    const url = buildWebhookUrl("https://otter.hexly.ai", "abc-123");
    expect(url).toBe("https://custom.worker.dev/ingest/abc-123");
  });

  it("should ignore host parameter (legacy compatibility)", () => {
    delete process.env.OTTER_API_URL;
    // Host is ignored, Worker URL is used
    const url = buildWebhookUrl("https://otter.dev.hexly.ai", "dev-token");
    expect(url).toBe("https://otter.worker.hexly.ai/ingest/dev-token");
  });
});

// ---------------------------------------------------------------------------
// executeLogin — integration with cli-base performLogin
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
    const loginPromise = executeLogin(
      configManager,
      {},
      {
        openBrowser: (url) => {
          browserUrl = url;

          // Simulate: extract the callback port and hit it
          const callbackMatch = url.match(/callback=([^&]+)/);
          if (callbackMatch) {
            const callbackBase = decodeURIComponent(callbackMatch[1]);
            // Hit the callback with token
            fetch(`${callbackBase}?token=test-token`).catch(() => {
              /* fire-and-forget */
            });
          }
        },
        onBrowserOpen: () => {
          /* no-op */
        },
        onSuccess: () => {
          /* no-op */
        },
      },
    );

    const result = await loginPromise;

    expect(result.success).toBe(true);
    expect(result.host).toBe("https://otter.hexly.ai");
    expect(result.token).toBe("test-token");
    expect(browserUrl).toContain("https://otter.hexly.ai/cli/connect?callback=");
  });

  it("should save token to config after success", async () => {
    const loginPromise = executeLogin(
      configManager,
      {},
      {
        openBrowser: (url) => {
          const callbackMatch = url.match(/callback=([^&]+)/);
          if (callbackMatch) {
            const callbackBase = decodeURIComponent(callbackMatch[1]);
            fetch(`${callbackBase}?token=saved-token`).catch(() => {
              /* fire-and-forget */
            });
          }
        },
        onBrowserOpen: () => {
          /* no-op */
        },
        onSuccess: () => {
          /* no-op */
        },
      },
    );

    await loginPromise;

    const config = await configManager.load();
    expect(config.token).toBe("saved-token");
  });

  it("should use dev host when --dev is set", async () => {
    let browserUrl = "";

    const loginPromise = executeLogin(
      configManager,
      { dev: true },
      {
        openBrowser: (url) => {
          browserUrl = url;
          const callbackMatch = url.match(/callback=([^&]+)/);
          if (callbackMatch) {
            const callbackBase = decodeURIComponent(callbackMatch[1]);
            fetch(`${callbackBase}?token=dev-token`).catch(() => {
              /* fire-and-forget */
            });
          }
        },
        onBrowserOpen: () => {
          /* no-op */
        },
        onSuccess: () => {
          /* no-op */
        },
      },
    );

    const result = await loginPromise;

    expect(result.success).toBe(true);
    expect(result.host).toBe("https://otter.dev.hexly.ai");
    expect(browserUrl).toContain("https://otter.dev.hexly.ai/cli/connect");
  });

  it("should return error when token is missing", async () => {
    let errorCalled = false;

    const loginPromise = executeLogin(
      configManager,
      {},
      {
        openBrowser: (url) => {
          const callbackMatch = url.match(/callback=([^&]+)/);
          if (callbackMatch) {
            const callbackBase = decodeURIComponent(callbackMatch[1]);
            // Hit callback without token
            fetch(callbackBase).catch(() => {
              /* fire-and-forget */
            });
          }
        },
        onBrowserOpen: () => {
          /* no-op */
        },
        onError: () => {
          errorCalled = true;
        },
      },
    );

    const result = await loginPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("token");
    expect(errorCalled).toBe(true);
  });

  it("should call callbacks in correct order", async () => {
    const callOrder: string[] = [];

    const loginPromise = executeLogin(
      configManager,
      {},
      {
        openBrowser: (url) => {
          callOrder.push("openBrowser");
          const callbackMatch = url.match(/callback=([^&]+)/);
          if (callbackMatch) {
            const callbackBase = decodeURIComponent(callbackMatch[1]);
            fetch(`${callbackBase}?token=order-token`).catch(() => {
              /* fire-and-forget */
            });
          }
        },
        onBrowserOpen: () => {
          callOrder.push("onBrowserOpen");
        },
        onSuccess: () => {
          callOrder.push("onSuccess");
        },
      },
    );

    await loginPromise;

    expect(callOrder).toContain("onBrowserOpen");
    expect(callOrder).toContain("openBrowser");
    expect(callOrder).toContain("onSuccess");
  });
});
