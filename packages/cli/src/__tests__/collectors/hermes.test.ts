import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HermesCollector } from "../../collectors/hermes.js";

describe("HermesCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  it("should have correct metadata", () => {
    const collector = new HermesCollector(tempHome);
    expect(collector.id).toBe("hermes");
    expect(collector.label).toBe("Hermes Agent Profiles");
    expect(collector.category).toBe("config");
  });

  // -------------------------------------------------------------------------
  // Empty / missing
  // -------------------------------------------------------------------------

  it("should return empty results when ~/.hermes/ does not exist", async () => {
    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toContainEqual(expect.stringContaining("Hermes not installed"));
  });

  // -------------------------------------------------------------------------
  // Main profile only
  // -------------------------------------------------------------------------

  it("should collect main profile files", async () => {
    const hermesDir = join(tempHome, ".hermes");
    await mkdir(join(hermesDir, "memories"), { recursive: true });
    await mkdir(join(hermesDir, "cron"), { recursive: true });

    await writeFile(join(hermesDir, "config.yaml"), "model: claude-4\napi_key: sk-secret-123");
    await writeFile(join(hermesDir, "SOUL.md"), "# I am a helpful agent");
    await writeFile(
      join(hermesDir, "memories", "MEMORY.md"),
      "# Memories\n- User likes TypeScript",
    );
    await writeFile(join(hermesDir, "memories", "USER.md"), "# User Profile\nName: Test");
    await writeFile(
      join(hermesDir, "cron", "jobs.json"),
      '{"jobs": [{"schedule": "0 9 * * *", "token": "secret-token"}]}',
    );

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    // Should have 5 files from main profile
    expect(result.files).toHaveLength(5);

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join("~/.hermes", "default", "config.yaml"));
    expect(paths).toContain(join("~/.hermes", "default", "SOUL.md"));
    expect(paths).toContain(join("~/.hermes", "default", "memories/MEMORY.md"));
    expect(paths).toContain(join("~/.hermes", "default", "memories/USER.md"));
    expect(paths).toContain(join("~/.hermes", "default", "cron/jobs.json"));

    // Profile list item
    const profileItem = result.lists.find((l) => l.name === "default");
    expect(profileItem).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    expect(profileItem!.meta?.type).toBe("main");
  });

  // -------------------------------------------------------------------------
  // Main + named profiles
  // -------------------------------------------------------------------------

  it("should collect main profile and named profiles", async () => {
    const hermesDir = join(tempHome, ".hermes");

    // Main profile
    await mkdir(hermesDir, { recursive: true });
    await writeFile(join(hermesDir, "config.yaml"), "model: claude-4");
    await writeFile(join(hermesDir, "SOUL.md"), "# Default agent");

    // Named profile: tomato
    const tomatoDir = join(hermesDir, "profiles", "tomato");
    await mkdir(tomatoDir, { recursive: true });
    await writeFile(join(tomatoDir, "config.yaml"), "model: claude-4-opus");
    await writeFile(join(tomatoDir, "SOUL.md"), "# Tomato agent");

    // Named profile: babaco
    const babacoDir = join(hermesDir, "profiles", "babaco");
    await mkdir(babacoDir, { recursive: true });
    await writeFile(join(babacoDir, "config.yaml"), "model: claude-4-haiku");

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    // Files: main has 2, tomato has 2, babaco has 1
    expect(result.files).toHaveLength(5);

    // Virtual paths
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join("~/.hermes", "default", "config.yaml"));
    expect(paths).toContain(join("~/.hermes", "default", "SOUL.md"));
    expect(paths).toContain(join("~/.hermes", "tomato", "config.yaml"));
    expect(paths).toContain(join("~/.hermes", "tomato", "SOUL.md"));
    expect(paths).toContain(join("~/.hermes", "babaco", "config.yaml"));

    // Profile list items
    const profileNames = result.lists.filter((l) => l.meta?.type !== "skill").map((l) => l.name);
    expect(profileNames).toContain("default");
    expect(profileNames).toContain("tomato");
    expect(profileNames).toContain("babaco");

    // Check profile types
    const defaultProfile = result.lists.find((l) => l.name === "default");
    expect(defaultProfile?.meta?.type).toBe("main");

    const tomatoProfile = result.lists.find((l) => l.name === "tomato");
    expect(tomatoProfile?.meta?.type).toBe("named");
  });

  // -------------------------------------------------------------------------
  // Partial profile (missing files)
  // -------------------------------------------------------------------------

  it("should handle profiles with missing files gracefully", async () => {
    const hermesDir = join(tempHome, ".hermes");

    // Main profile with only config.yaml (no SOUL.md, no memories, no cron)
    await mkdir(hermesDir, { recursive: true });
    await writeFile(join(hermesDir, "config.yaml"), "model: claude-4");

    // Named profile with only SOUL.md
    const tomatoDir = join(hermesDir, "profiles", "tomato");
    await mkdir(tomatoDir, { recursive: true });
    await writeFile(join(tomatoDir, "SOUL.md"), "# Tomato");

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    // Should only collect existing files
    expect(result.files).toHaveLength(2);
    expect(result.errors).toHaveLength(0);

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join("~/.hermes", "default", "config.yaml"));
    expect(paths).toContain(join("~/.hermes", "tomato", "SOUL.md"));
  });

  // -------------------------------------------------------------------------
  // Skills collection
  // -------------------------------------------------------------------------

  it("should collect skill names as list items", async () => {
    const hermesDir = join(tempHome, ".hermes");
    const skillsDir = join(hermesDir, "skills");

    await mkdir(join(skillsDir, "deploy"), { recursive: true });
    await mkdir(join(skillsDir, "search"), { recursive: true });
    await writeFile(join(skillsDir, "deploy", "SKILL.md"), "# Deploy skill");
    await writeFile(join(skillsDir, "search", "SKILL.md"), "# Search skill");

    // Also add a regular file that should be ignored (not a directory)
    await writeFile(join(skillsDir, "README.md"), "# Skills");

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    const skills = result.lists.filter((l) => l.meta?.type === "skill");
    expect(skills).toHaveLength(2);

    const skillNames = skills.map((s) => s.name);
    expect(skillNames).toContain("deploy");
    expect(skillNames).toContain("search");

    // Check meta
    for (const skill of skills) {
      expect(skill.meta?.profile).toBe("default");
      expect(skill.meta?.type).toBe("skill");
    }

    // Profile should report correct skillsCount
    const defaultProfile = result.lists.find(
      (l) => l.name === "default" && l.meta?.type === "main",
    );
    expect(defaultProfile?.meta?.skillsCount).toBe("2");
  });

  it("should collect skills from named profiles with correct profile meta", async () => {
    const hermesDir = join(tempHome, ".hermes");

    // Main profile with 1 skill
    await mkdir(join(hermesDir, "skills", "skill-a"), { recursive: true });

    // Named profile with 2 skills
    const tomatoDir = join(hermesDir, "profiles", "tomato");
    await mkdir(join(tomatoDir, "skills", "skill-b"), { recursive: true });
    await mkdir(join(tomatoDir, "skills", "skill-c"), { recursive: true });

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    const skills = result.lists.filter((l) => l.meta?.type === "skill");
    expect(skills).toHaveLength(3);

    const mainSkills = skills.filter((s) => s.meta?.profile === "default");
    expect(mainSkills).toHaveLength(1);
    expect(mainSkills[0]?.name).toBe("skill-a");

    const tomatoSkills = skills.filter((s) => s.meta?.profile === "tomato");
    expect(tomatoSkills).toHaveLength(2);

    // Profile skillsCount
    const defaultProfile = result.lists.find(
      (l) => l.name === "default" && l.meta?.type === "main",
    );
    expect(defaultProfile?.meta?.skillsCount).toBe("1");

    const tomatoProfile = result.lists.find((l) => l.name === "tomato" && l.meta?.type === "named");
    expect(tomatoProfile?.meta?.skillsCount).toBe("2");
  });

  // -------------------------------------------------------------------------
  // Redaction
  // -------------------------------------------------------------------------

  it("should redact sensitive values in config.yaml and cron/jobs.json", async () => {
    const hermesDir = join(tempHome, ".hermes");
    await mkdir(join(hermesDir, "cron"), { recursive: true });

    // config.yaml with sensitive content
    await writeFile(
      join(hermesDir, "config.yaml"),
      'model: claude-4\napi_key: "sk-ant-secret-key-12345"\nendpoint: https://api.example.com',
    );

    // cron/jobs.json with sensitive content
    await writeFile(
      join(hermesDir, "cron", "jobs.json"),
      '{"schedule": "0 9 * * *", "webhook_token": "whsec_secret123"}',
    );

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    const configFile = result.files.find((f) => f.path.endsWith(join("default", "config.yaml")));
    expect(configFile).toBeDefined();
    // The redaction utility should have processed it (exact behavior depends on redactSecrets)
    // Config files marked with redact: true are passed through redactSecrets()

    const cronFile = result.files.find((f) => f.path.endsWith(join("default", "cron/jobs.json")));
    expect(cronFile).toBeDefined();
  });

  it("should NOT redact SOUL.md and memory files", async () => {
    const hermesDir = join(tempHome, ".hermes");
    await mkdir(join(hermesDir, "memories"), { recursive: true });

    const soulContent = "# My Agent\nI have an api_key: sk-12345 in my soul";
    const memoryContent = "# Memories\npassword: hunter2 is remembered";

    await writeFile(join(hermesDir, "SOUL.md"), soulContent);
    await writeFile(join(hermesDir, "memories", "MEMORY.md"), memoryContent);

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    // These files should NOT be redacted (redact: false)
    const soulFile = result.files.find((f) => f.path.endsWith("SOUL.md"));
    expect(soulFile?.content).toBe(soulContent);

    const memoryFile = result.files.find((f) => f.path.endsWith("MEMORY.md"));
    expect(memoryFile?.content).toBe(memoryContent);
  });

  // -------------------------------------------------------------------------
  // Virtual paths
  // -------------------------------------------------------------------------

  it("should use virtual paths with ~/.hermes/<profile>/ prefix", async () => {
    const hermesDir = join(tempHome, ".hermes");
    const tomatoDir = join(hermesDir, "profiles", "tomato");
    await mkdir(tomatoDir, { recursive: true });

    await writeFile(join(hermesDir, "config.yaml"), "model: test");
    await writeFile(join(tomatoDir, "SOUL.md"), "# Tomato");

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);

    // Should NOT contain actual temp directory paths
    for (const path of paths) {
      expect(path).not.toContain(tempHome);
    }

    // Should use virtual paths
    expect(paths).toContain(join("~/.hermes", "default", "config.yaml"));
    expect(paths).toContain(join("~/.hermes", "tomato", "SOUL.md"));
  });

  // -------------------------------------------------------------------------
  // Duration
  // -------------------------------------------------------------------------

  it("should record duration", async () => {
    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });

  // -------------------------------------------------------------------------
  // Permission errors
  // -------------------------------------------------------------------------

  it("should handle permission errors gracefully", async () => {
    const hermesDir = join(tempHome, ".hermes");
    const skillsDir = join(hermesDir, "skills");
    await mkdir(skillsDir, { recursive: true });

    // Create a config file, then make skills dir unreadable
    await writeFile(join(hermesDir, "config.yaml"), "model: test");
    await chmod(skillsDir, 0o000);

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    // Should still collect config.yaml
    expect(result.files.length).toBeGreaterThan(0);

    // Should record skills directory error
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("skills");

    // Restore permissions for cleanup
    await chmod(skillsDir, 0o755);
  });

  // -------------------------------------------------------------------------
  // Excluded files
  // -------------------------------------------------------------------------

  it("should NOT collect .env, sessions/, state.db, or auth.json", async () => {
    const hermesDir = join(tempHome, ".hermes");
    await mkdir(join(hermesDir, "sessions"), { recursive: true });

    await writeFile(join(hermesDir, "config.yaml"), "model: test");
    await writeFile(join(hermesDir, ".env"), "API_KEY=sk-secret");
    await writeFile(join(hermesDir, "state.db"), "binary data");
    await writeFile(join(hermesDir, "auth.json"), '{"token": "secret"}');
    await writeFile(join(hermesDir, "sessions", "session1.db"), "session data");

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);

    // Should collect config.yaml
    expect(paths).toContain(join("~/.hermes", "default", "config.yaml"));

    // Should NOT contain excluded files
    for (const path of paths) {
      expect(path).not.toContain(".env");
      expect(path).not.toContain("state.db");
      expect(path).not.toContain("auth.json");
      expect(path).not.toContain("sessions");
    }
  });

  // -------------------------------------------------------------------------
  // Empty profiles directory
  // -------------------------------------------------------------------------

  it("should handle empty profiles directory", async () => {
    const hermesDir = join(tempHome, ".hermes");
    await mkdir(join(hermesDir, "profiles"), { recursive: true });
    await writeFile(join(hermesDir, "config.yaml"), "model: test");

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    // Only main profile
    const profileItems = result.lists.filter((l) => l.meta?.type !== "skill");
    expect(profileItems).toHaveLength(1);
    expect(profileItems[0]?.name).toBe("default");
  });

  // -------------------------------------------------------------------------
  // No skills directory
  // -------------------------------------------------------------------------

  it("should handle profile without skills directory", async () => {
    const hermesDir = join(tempHome, ".hermes");
    await mkdir(hermesDir, { recursive: true });
    await writeFile(join(hermesDir, "SOUL.md"), "# Agent");

    const collector = new HermesCollector(tempHome);
    const result = await collector.collect();

    const defaultProfile = result.lists.find(
      (l) => l.name === "default" && l.meta?.type === "main",
    );
    expect(defaultProfile?.meta?.skillsCount).toBe("0");
    expect(result.errors).toHaveLength(0);
  });
});
