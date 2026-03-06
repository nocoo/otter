import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeConfigCollector } from "../../collectors/opencode-config.js";

describe("OpenCodeConfigCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should have correct metadata", () => {
    const collector = new OpenCodeConfigCollector(tempHome);
    expect(collector.id).toBe("opencode-config");
    expect(collector.label).toBe("OpenCode Configuration");
    expect(collector.category).toBe("config");
  });

  it("should collect .config/opencode config files", async () => {
    const configDir = join(tempHome, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "config.json"), '{"theme": "dark"}');

    const collector = new OpenCodeConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toContainEqual(
      expect.objectContaining({
        path: join(configDir, "config.json"),
        content: '{"theme": "dark"}',
      })
    );
  });

  it("should collect opencode skills directory", async () => {
    const skillsDir = join(tempHome, ".config", "opencode", "skills");
    await mkdir(join(skillsDir, "my-skill"), { recursive: true });
    await writeFile(
      join(skillsDir, "my-skill", "SKILL.md"),
      "# My Skill\nDoes stuff"
    );

    const collector = new OpenCodeConfigCollector(tempHome);
    const result = await collector.collect();

    // Skills should be collected as list items (name only), not full files
    expect(result.lists).toContainEqual(
      expect.objectContaining({
        name: "my-skill",
      })
    );
  });

  it("should list multiple skills", async () => {
    const skillsDir = join(tempHome, ".config", "opencode", "skills");
    await mkdir(join(skillsDir, "skill-a"), { recursive: true });
    await mkdir(join(skillsDir, "skill-b"), { recursive: true });
    await writeFile(join(skillsDir, "skill-a", "SKILL.md"), "a");
    await writeFile(join(skillsDir, "skill-b", "SKILL.md"), "b");

    const collector = new OpenCodeConfigCollector(tempHome);
    const result = await collector.collect();

    const names = result.lists.map((l) => l.name);
    expect(names).toContain("skill-a");
    expect(names).toContain("skill-b");
  });

  it("should collect .agents/skills as skill list items", async () => {
    const agentsSkillsDir = join(tempHome, ".agents", "skills");
    await mkdir(join(agentsSkillsDir, "memory-skill"), { recursive: true });
    await writeFile(
      join(agentsSkillsDir, "memory-skill", "SKILL.md"),
      "# Memory"
    );

    const collector = new OpenCodeConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.lists).toContainEqual(
      expect.objectContaining({
        name: "memory-skill",
        meta: expect.objectContaining({ source: ".agents/skills" }),
      })
    );
  });

  it("should return empty results when no opencode config exists", async () => {
    const collector = new OpenCodeConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should exclude skill content but include skill SKILL.md path in meta", async () => {
    const skillsDir = join(tempHome, ".config", "opencode", "skills");
    await mkdir(join(skillsDir, "big-skill"), { recursive: true });
    await writeFile(
      join(skillsDir, "big-skill", "SKILL.md"),
      "very long content..."
    );
    await writeFile(
      join(skillsDir, "big-skill", "helper.ts"),
      "export function x() {}"
    );

    const collector = new OpenCodeConfigCollector(tempHome);
    const result = await collector.collect();

    // Skill files should NOT be in the files array
    const skillFiles = result.files.filter((f) =>
      f.path.includes("skills/big-skill")
    );
    expect(skillFiles).toHaveLength(0);

    // But skill should be in the lists array
    expect(result.lists).toContainEqual(
      expect.objectContaining({ name: "big-skill" })
    );
  });
});
