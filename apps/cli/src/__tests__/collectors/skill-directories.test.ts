import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillDirectories } from "../../collectors/skill-directories.js";

let fixture: string;
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), "otter-skill-enumeration-"));
});
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

async function skill(path: string) {
  await mkdir(join(fixture, path), { recursive: true });
  await writeFile(join(fixture, path, "SKILL.md"), "---\nname: fixture\ndescription: Test.\n---\n");
}

describe("skill directory discovery", () => {
  it("retains aliases but ignores hidden roots, dependencies, regular files and non-skill folders", async () => {
    await skill("skills/direct");
    await skill("skills/.hidden");
    await skill("skills/node_modules");
    await skill("skills/category/nested");
    await skill("upstream");
    await symlink(join(fixture, "upstream"), join(fixture, "skills/linked"));
    await writeFile(join(fixture, "skills/plain.txt"), "not a skill");
    await symlink(join(fixture, "skills/plain.txt"), join(fixture, "skills/file-alias"));
    const errors: string[] = [];
    expect(await skillDirectories(join(fixture, "skills"), errors)).toEqual(["direct", "linked"]);
    expect(errors).toEqual([]);
    expect(await skillDirectories(join(fixture, "skills"), errors, true)).toEqual([
      "category/nested",
      "direct",
      "linked",
    ]);
  });

  it("reports broken and cyclic aliases without losing readable packages", async () => {
    await skill("skills/category/nested");
    await symlink(join(fixture, "absent"), join(fixture, "skills/broken"));
    await symlink(join(fixture, "skills"), join(fixture, "skills/category/back"));
    const errors: string[] = [];
    expect(await skillDirectories(join(fixture, "skills"), errors, true)).toEqual([
      "category/nested",
    ]);
    expect(errors).toHaveLength(2);
    expect(errors.join("\n")).toMatch(/cycle/);
    expect(errors.join("\n")).toMatch(/broken/);
  });

  it("preserves legacy OpenCode directory listings and treats a directory named SKILL.md as invalid", async () => {
    await mkdir(join(fixture, "skills/incomplete/SKILL.md"), { recursive: true });
    const errors: string[] = [];
    expect(await skillDirectories(join(fixture, "skills"), errors)).toEqual([]);
    expect(await skillDirectories(join(fixture, "skills"), errors, false, false)).toEqual([
      "incomplete",
    ]);
    expect(errors).toEqual([]);
  });

  it("distinguishes an absent optional directory from an unreadable non-directory root", async () => {
    const errors: string[] = [];
    expect(await skillDirectories(join(fixture, "missing"), errors)).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(join(fixture, "file"), "not a directory");
    expect(await skillDirectories(join(fixture, "file"), errors)).toEqual([]);
    expect(errors[0]).toContain("Failed to read skills directory");
  });

  it("stops excessively deep nesting and records an explicit limit diagnostic", async () => {
    await skill(`skills/${Array.from({ length: 34 }, () => "nested").join("/")}`);
    const errors: string[] = [];
    expect(await skillDirectories(join(fixture, "skills"), errors, true)).toEqual([]);
    expect(errors.join()).toContain("limit exceeded");
  });
});
