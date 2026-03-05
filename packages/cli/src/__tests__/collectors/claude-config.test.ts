import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeConfigCollector } from "../../collectors/claude-config.js";

describe("ClaudeConfigCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should have correct metadata", () => {
    const collector = new ClaudeConfigCollector(tempHome);
    expect(collector.id).toBe("claude-config");
    expect(collector.label).toBe("Claude Code Configuration");
    expect(collector.category).toBe("config");
  });

  it("should collect CLAUDE.md from home directory", async () => {
    await writeFile(join(tempHome, "CLAUDE.md"), "# My Claude Config");
    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toContainEqual(
      expect.objectContaining({
        path: join(tempHome, "CLAUDE.md"),
        content: "# My Claude Config",
      })
    );
    expect(result.errors).toHaveLength(0);
  });

  it("should collect .claude directory contents", async () => {
    const claudeDir = join(tempHome, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');
    await writeFile(join(claudeDir, "credentials.json"), '{"secret": "x"}');

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join(claudeDir, "settings.json"));
    // credentials should be excluded for security
    expect(paths).not.toContain(join(claudeDir, "credentials.json"));
  });

  it("should collect .claude/commands directory", async () => {
    const commandsDir = join(tempHome, ".claude", "commands");
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, "my-command.md"), "custom command");

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toContainEqual(
      expect.objectContaining({
        path: join(commandsDir, "my-command.md"),
        content: "custom command",
      })
    );
  });

  it("should return empty results when no claude config exists", async () => {
    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should record duration", async () => {
    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });

  it("should handle permission errors gracefully", async () => {
    const claudeDir = join(tempHome, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), "data");
    // Make directory unreadable
    const { chmod } = await import("node:fs/promises");
    await chmod(claudeDir, 0o000);

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    // Should not throw, but record errors
    expect(result.errors.length).toBeGreaterThan(0);

    // Restore permissions for cleanup
    await chmod(claudeDir, 0o755);
  });

  it("should calculate correct file sizes", async () => {
    const content = "hello world";
    await writeFile(join(tempHome, "CLAUDE.md"), content);

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const file = result.files.find((f) => f.path.endsWith("CLAUDE.md"));
    expect(file?.sizeBytes).toBe(Buffer.byteLength(content));
  });
});
