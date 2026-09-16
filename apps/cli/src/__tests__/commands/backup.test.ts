import { afterEach, describe, expect, it } from "vitest";
import { resolveBackupTargets } from "../../commands/backup.js";

describe("resolveBackupTargets", () => {
  const originalEnv = process.env.OTTER_API_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OTTER_API_URL;
    } else {
      process.env.OTTER_API_URL = originalEnv;
    }
  });

  it("uses the default Worker URL and forwards the token", () => {
    delete process.env.OTTER_API_URL;
    const t = resolveBackupTargets({ token: "otk_abc123" });
    expect(t.snapshotUrl).toBe("https://otter.worker.hexly.ai/api/snapshots");
    expect(t.iconsUrl).toBe("https://otter.worker.hexly.ai/api/icons");
    expect(t.token).toBe("otk_abc123");
  });

  it("honors OTTER_API_URL override for both endpoints", () => {
    process.env.OTTER_API_URL = "https://custom.example.com";
    const t = resolveBackupTargets({ token: "otk_env" });
    expect(t.snapshotUrl).toBe("https://custom.example.com/api/snapshots");
    expect(t.iconsUrl).toBe("https://custom.example.com/api/icons");
    expect(t.token).toBe("otk_env");
  });
});
