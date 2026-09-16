import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      }),
    );
    expect(result.errors).toHaveLength(0);
  });

  it("should collect targeted config files from .claude/", async () => {
    const claudeDir = join(tempHome, ".claude");
    await mkdir(join(claudeDir, "plugins"), { recursive: true });

    await writeFile(join(claudeDir, "settings.json"), '{"enabledPlugins": []}');
    await writeFile(join(claudeDir, "stats-cache.json"), '{"totalSessions": 10}');
    await writeFile(join(claudeDir, "CLAUDE.md"), "# Claude level config");
    await writeFile(join(claudeDir, "history.jsonl"), '{"display":"hello"}');
    await writeFile(join(claudeDir, "plugins", "installed_plugins.json"), "[]");
    await writeFile(join(claudeDir, "plugins", "blocklist.json"), "[]");

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join(claudeDir, "settings.json"));
    expect(paths).toContain(join(claudeDir, "stats-cache.json"));
    expect(paths).toContain(join(claudeDir, "CLAUDE.md"));
    expect(paths).toContain(join(claudeDir, "history.jsonl"));
    expect(paths).toContain(join(claudeDir, "plugins", "installed_plugins.json"));
    expect(paths).toContain(join(claudeDir, "plugins", "blocklist.json"));
  });

  it("should NOT collect debug, telemetry, transcripts, or session content", async () => {
    const claudeDir = join(tempHome, ".claude");
    await mkdir(join(claudeDir, "debug"), { recursive: true });
    await mkdir(join(claudeDir, "telemetry"), { recursive: true });
    await mkdir(join(claudeDir, "transcripts"), { recursive: true });
    await mkdir(join(claudeDir, "projects", "abc123"), { recursive: true });

    await writeFile(join(claudeDir, "debug", "debug.log"), "debug content");
    await writeFile(join(claudeDir, "telemetry", "events.json"), "{}");
    await writeFile(join(claudeDir, "transcripts", "transcript.jsonl"), "{}");
    await writeFile(join(claudeDir, "projects", "abc123", "session-001.jsonl"), '{"type":"user"}');

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);
    expect(paths).not.toContain(join(claudeDir, "debug", "debug.log"));
    expect(paths).not.toContain(join(claudeDir, "telemetry", "events.json"));
    expect(paths).not.toContain(join(claudeDir, "transcripts", "transcript.jsonl"));
    expect(paths).not.toContain(join(claudeDir, "projects", "abc123", "session-001.jsonl"));
  });

  it("should collect session summaries from sessions-index.json", async () => {
    const claudeDir = join(tempHome, ".claude");
    const projectDir = join(claudeDir, "projects", "abc123");
    await mkdir(projectDir, { recursive: true });

    const sessionsIndex = {
      version: 1,
      entries: [
        {
          sessionId: "s1",
          firstPrompt: "Help me with X",
          messageCount: 42,
          created: "2026-01-01T00:00:00Z",
          modified: "2026-01-02T00:00:00Z",
          gitBranch: "main",
          projectPath: "/Users/test/myproject",
        },
        {
          sessionId: "s2",
          firstPrompt: "Fix the bug",
          messageCount: 10,
          created: "2026-02-01T00:00:00Z",
          modified: "2026-02-01T12:00:00Z",
        },
      ],
      originalPath: "/Users/test/myproject",
    };
    await writeFile(join(projectDir, "sessions-index.json"), JSON.stringify(sessionsIndex));

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const summaryFile = result.files.find((f) => f.path.endsWith("__sessions-summary.json"));
    expect(summaryFile).toBeDefined();

    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    const summaries = JSON.parse(summaryFile!.content);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].projectPath).toBe("/Users/test/myproject");
    expect(summaries[0].sessions).toHaveLength(2);
    expect(summaries[0].sessions[0].firstPrompt).toBe("Help me with X");
    expect(summaries[0].sessions[0].messageCount).toBe(42);
    expect(summaries[0].sessions[1].sessionId).toBe("s2");
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
    const projectsDir = join(claudeDir, "projects");
    await mkdir(projectsDir, { recursive: true });
    // Make directory unreadable
    const { chmod } = await import("node:fs/promises");
    await chmod(projectsDir, 0o000);

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    // Should not throw, but record errors
    expect(result.errors.length).toBeGreaterThan(0);

    // Restore permissions for cleanup
    await chmod(projectsDir, 0o755);
  });

  it("should calculate correct file sizes", async () => {
    const content = "hello world";
    await writeFile(join(tempHome, "CLAUDE.md"), content);

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const file = result.files.find((f) => f.path.endsWith("CLAUDE.md"));
    expect(file?.sizeBytes).toBe(Buffer.byteLength(content));
  });

  it("should handle multiple projects in session summaries", async () => {
    const claudeDir = join(tempHome, ".claude");

    // Create two project dirs with sessions
    for (const [hash, origPath] of [
      ["proj1", "/Users/test/project-a"],
      ["proj2", "/Users/test/project-b"],
    ] as const) {
      const dir = join(claudeDir, "projects", hash);
      // biome-ignore lint/performance/noAwaitInLoops: small fixed-size test setup loop
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "sessions-index.json"),
        JSON.stringify({
          entries: [{ sessionId: `${hash}-s1`, firstPrompt: `Work on ${hash}` }],
          originalPath: origPath,
        }),
      );
    }

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const summaryFile = result.files.find((f) => f.path.endsWith("__sessions-summary.json"));
    expect(summaryFile).toBeDefined();

    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    const summaries = JSON.parse(summaryFile!.content);
    expect(summaries).toHaveLength(2);
  });

  it("should skip projects with empty entries", async () => {
    const claudeDir = join(tempHome, ".claude");
    const dir = join(claudeDir, "projects", "empty-proj");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "sessions-index.json"), JSON.stringify({ entries: [] }));

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    // No summary file should be created for empty projects
    const summaryFile = result.files.find((f) => f.path.endsWith("__sessions-summary.json"));
    expect(summaryFile).toBeUndefined();
  });

  it("should exclude history.jsonl and session summaries in slim mode", async () => {
    const claudeDir = join(tempHome, ".claude");
    const projectDir = join(claudeDir, "projects", "abc123");
    await mkdir(join(claudeDir, "plugins"), { recursive: true });
    await mkdir(projectDir, { recursive: true });

    // Create all files
    await writeFile(join(claudeDir, "settings.json"), '{"env":{}}');
    await writeFile(join(claudeDir, "CLAUDE.md"), "# Config");
    await writeFile(join(claudeDir, "history.jsonl"), '{"display":"test prompt"}');
    await writeFile(
      join(projectDir, "sessions-index.json"),
      JSON.stringify({
        entries: [{ sessionId: "s1", firstPrompt: "hello" }],
        originalPath: "/test",
      }),
    );

    const collector = new ClaudeConfigCollector(tempHome, { slim: true });
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);

    // Config files should still be collected
    expect(paths).toContain(join(claudeDir, "settings.json"));
    expect(paths).toContain(join(claudeDir, "CLAUDE.md"));

    // Behavior data should be excluded
    expect(paths).not.toContain(join(claudeDir, "history.jsonl"));
    expect(paths.some((p) => p.endsWith("__sessions-summary.json"))).toBe(false);
  });

  it("should include history.jsonl and session summaries without slim mode", async () => {
    const claudeDir = join(tempHome, ".claude");
    const projectDir = join(claudeDir, "projects", "abc123");
    await mkdir(projectDir, { recursive: true });

    await writeFile(join(claudeDir, "history.jsonl"), '{"display":"test prompt"}');
    await writeFile(
      join(projectDir, "sessions-index.json"),
      JSON.stringify({
        entries: [{ sessionId: "s1", firstPrompt: "hello" }],
        originalPath: "/test",
      }),
    );

    const collector = new ClaudeConfigCollector(tempHome); // no slim
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join(claudeDir, "history.jsonl"));
    expect(paths.some((p) => p.endsWith("__sessions-summary.json"))).toBe(true);
  });

  it("should skip non-directory entries under projects/ and fall back to entry name when originalPath is missing", async () => {
    const claudeDir = join(tempHome, ".claude");
    const projectsDir = join(claudeDir, "projects");
    const projectDir = join(projectsDir, "no-orig-path");
    await mkdir(projectDir, { recursive: true });
    // Stray file directly under projects/ — should be skipped (not a directory)
    await writeFile(join(projectsDir, "stray.txt"), "ignore");
    await writeFile(
      join(projectDir, "sessions-index.json"),
      JSON.stringify({
        entries: [{ sessionId: "s1", firstPrompt: "p", isSidechain: true }, { sessionId: "s2" }],
        // no originalPath — must fall back to entry.name
      }),
    );

    const collector = new ClaudeConfigCollector(tempHome);
    const result = await collector.collect();

    const summaryFile = result.files.find((f) => f.path.endsWith("__sessions-summary.json"));
    expect(summaryFile).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    const summaries = JSON.parse(summaryFile!.content);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].projectPath).toBe("no-orig-path");
    expect(summaries[0].sessions[0].isSidechain).toBe(true);
    expect(summaries[0].sessions[1].isSidechain).toBeUndefined();
  });
});
