import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "../../config/manager.js";

describe("ConfigManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty config when no file exists", async () => {
    const manager = new ConfigManager(tempDir);
    const config = await manager.load();

    expect(config).toEqual({});
  });

  it("should save and load webhook URL", async () => {
    const manager = new ConfigManager(tempDir);
    await manager.save({ webhookUrl: "https://example.com/hook" });

    const loaded = await manager.load();
    expect(loaded.webhookUrl).toBe("https://example.com/hook");
  });

  it("should create config directory if it does not exist", async () => {
    const configDir = join(tempDir, "nested", "config");
    const manager = new ConfigManager(configDir);

    await manager.save({ webhookUrl: "https://test.com" });

    const loaded = await manager.load();
    expect(loaded.webhookUrl).toBe("https://test.com");
  });

  it("should write valid JSON to disk", async () => {
    const manager = new ConfigManager(tempDir);
    await manager.save({ webhookUrl: "https://example.com" });

    const raw = await readFile(join(tempDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.webhookUrl).toBe("https://example.com");
  });

  it("should merge partial updates", async () => {
    const manager = new ConfigManager(tempDir);
    await manager.save({ webhookUrl: "https://first.com" });
    await manager.save({ webhookUrl: "https://second.com" });

    const config = await manager.load();
    expect(config.webhookUrl).toBe("https://second.com");
  });

  it("should return config path", () => {
    const manager = new ConfigManager(tempDir);
    expect(manager.configPath).toBe(join(tempDir, "config.json"));
  });

  it("should handle corrupted config file gracefully", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tempDir, "config.json"), "not valid json{{{");

    const manager = new ConfigManager(tempDir);
    const config = await manager.load();

    // Should return empty config rather than crash
    expect(config).toEqual({});
  });
});
