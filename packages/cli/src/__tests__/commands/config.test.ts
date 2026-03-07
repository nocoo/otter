import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeConfig } from "../../commands/config.js";
import { ConfigManager } from "../../config/manager.js";

describe("executeConfig", () => {
  let tempDir: string;
  let manager: ConfigManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-cmd-config-"));
    manager = new ConfigManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should set token", async () => {
    await executeConfig(manager, {
      action: "set",
      key: "token",
      value: "abc-123",
    });

    const config = await manager.load();
    expect(config.token).toBe("abc-123");
  });

  it("should get token", async () => {
    await manager.save({ token: "saved-token" });

    const result = await executeConfig(manager, {
      action: "get",
      key: "token",
    });

    expect(result).toBe("saved-token");
  });

  it("should return undefined for unset keys", async () => {
    const result = await executeConfig(manager, {
      action: "get",
      key: "token",
    });

    expect(result).toBeUndefined();
  });

  it("should show all config when action is show", async () => {
    await manager.save({ token: "show-token" });

    const result = await executeConfig(manager, { action: "show" });

    expect(result).toEqual({ token: "show-token" });
  });
});
