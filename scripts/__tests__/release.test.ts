import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  type ChangelogSections,
  type Commit,
  classifyCommits,
  compareSemver,
  formatChangelogSection,
  parseSemver,
  VERSION_TARGETS,
} from "../release";

describe("parseSemver", () => {
  it("parses valid semver", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("0.0.0")).toEqual([0, 0, 0]);
    expect(parseSemver("10.20.30")).toEqual([10, 20, 30]);
  });

  it("throws on invalid semver", () => {
    expect(() => parseSemver("1.2")).toThrow('Invalid semver: "1.2"');
    expect(() => parseSemver("v1.2.3")).toThrow('Invalid semver: "v1.2.3"');
    expect(() => parseSemver("1.2.3.4")).toThrow('Invalid semver: "1.2.3.4"');
    expect(() => parseSemver("")).toThrow('Invalid semver: ""');
  });
});

describe("compareSemver", () => {
  it("compares major versions", () => {
    expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("compares minor versions", () => {
    expect(compareSemver("1.2.0", "1.1.0")).toBeGreaterThan(0);
    expect(compareSemver("1.1.0", "1.2.0")).toBeLessThan(0);
  });

  it("compares patch versions", () => {
    expect(compareSemver("1.0.2", "1.0.1")).toBeGreaterThan(0);
    expect(compareSemver("1.0.1", "1.0.2")).toBeLessThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("bumpVersion", () => {
  it("bumps patch version", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.9", "patch")).toBe("1.2.10");
  });

  it("bumps minor version and resets patch", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.9.9", "minor")).toBe("1.10.0");
  });

  it("bumps major version and resets minor/patch", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
    expect(bumpVersion("9.9.9", "major")).toBe("10.0.0");
  });

  it("accepts explicit version greater than current", () => {
    expect(bumpVersion("1.0.0", "2.0.0")).toBe("2.0.0");
    expect(bumpVersion("1.0.0", "1.0.1")).toBe("1.0.1");
  });

  it("throws when explicit version is not greater", () => {
    expect(() => bumpVersion("2.0.0", "1.0.0")).toThrow("must be greater than current");
    expect(() => bumpVersion("1.0.0", "1.0.0")).toThrow("must be greater than current");
  });

  it("throws on invalid bump type", () => {
    expect(() => bumpVersion("1.0.0", "invalid")).toThrow('Invalid bump type: "invalid"');
  });
});

describe("classifyCommits", () => {
  it("classifies feat commits as added", () => {
    const commits: Commit[] = [{ hash: "abc", subject: "feat: add login" }];
    const sections = classifyCommits(commits);
    expect(sections.added).toContain("Add login");
    expect(sections.fixed).toHaveLength(0);
  });

  it("classifies fix commits as fixed", () => {
    const commits: Commit[] = [{ hash: "abc", subject: "fix: broken link" }];
    const sections = classifyCommits(commits);
    expect(sections.fixed).toContain("Broken link");
  });

  it("classifies feat! as breaking", () => {
    const commits: Commit[] = [{ hash: "abc", subject: "feat!: remove old API" }];
    const sections = classifyCommits(commits);
    expect(sections.breaking).toContain("Remove old API");
  });

  it("classifies commits with scope", () => {
    const commits: Commit[] = [{ hash: "abc", subject: "feat(auth): add OAuth" }];
    const sections = classifyCommits(commits);
    expect(sections.added).toContain("Add OAuth");
  });

  it("classifies remove/delete keywords as removed", () => {
    const commits: Commit[] = [{ hash: "abc", subject: "chore: remove unused code" }];
    const sections = classifyCommits(commits);
    expect(sections.removed).toContain("Remove unused code");
  });

  it("skips merge commits", () => {
    const commits: Commit[] = [
      { hash: "abc", subject: "Merge pull request #123" },
      { hash: "def", subject: "feat: real commit" },
    ];
    const sections = classifyCommits(commits);
    expect(sections.added).toHaveLength(1);
    expect(sections.added).toContain("Real commit");
  });

  it("handles non-conventional commits", () => {
    const commits: Commit[] = [{ hash: "abc", subject: "update dependencies" }];
    const sections = classifyCommits(commits);
    expect(sections.changed).toContain("Update dependencies");
  });

  it("deduplicates identical descriptions", () => {
    const commits: Commit[] = [
      { hash: "abc", subject: "fix: same issue" },
      { hash: "def", subject: "fix: same issue" },
    ];
    const sections = classifyCommits(commits);
    expect(sections.fixed).toHaveLength(1);
  });
});

describe("formatChangelogSection", () => {
  it("formats empty sections", () => {
    const sections: ChangelogSections = {
      breaking: [],
      added: [],
      changed: [],
      fixed: [],
      removed: [],
    };
    const result = formatChangelogSection("1.0.0", sections);
    expect(result).toMatch(/^## \[1\.0\.0\] - \d{4}-\d{2}-\d{2}$/);
  });

  it("formats all section types", () => {
    const sections: ChangelogSections = {
      breaking: ["Drop support for Node 16"],
      added: ["New feature"],
      changed: ["Updated docs"],
      fixed: ["Bug fix"],
      removed: ["Old API"],
    };
    const result = formatChangelogSection("2.0.0", sections);

    expect(result).toContain("## [2.0.0]");
    expect(result).toContain("### Breaking");
    expect(result).toContain("- Drop support for Node 16");
    expect(result).toContain("### Features");
    expect(result).toContain("- New feature");
    expect(result).toContain("### Changed");
    expect(result).toContain("- Updated docs");
    expect(result).toContain("### Fixes");
    expect(result).toContain("- Bug fix");
    expect(result).toContain("### Removed");
    expect(result).toContain("- Old API");
  });

  it("omits empty sections", () => {
    const sections: ChangelogSections = {
      breaking: [],
      added: ["Feature"],
      changed: [],
      fixed: [],
      removed: [],
    };
    const result = formatChangelogSection("1.1.0", sections);

    expect(result).toContain("### Features");
    expect(result).not.toContain("### Breaking");
    expect(result).not.toContain("### Changed");
    expect(result).not.toContain("### Fixes");
    expect(result).not.toContain("### Removed");
  });
});

describe("VERSION_TARGETS", () => {
  it("has 8 targets for monorepo", () => {
    expect(VERSION_TARGETS).toHaveLength(8);
  });

  it("includes all package.json files", () => {
    const jsonTargets = VERSION_TARGETS.filter((t) => t.pattern === "json-version");
    expect(jsonTargets).toHaveLength(6);
    expect(jsonTargets.map((t) => t.path)).toEqual(
      expect.arrayContaining([
        "package.json",
        "packages/cli/package.json",
        "packages/core/package.json",
        "packages/web/package.json",
        "packages/api/package.json",
        "packages/worker/package.json",
      ]),
    );
  });

  it("includes const-version targets", () => {
    const constTargets = VERSION_TARGETS.filter((t) => t.pattern === "const-version");
    expect(constTargets).toHaveLength(2);
    expect(constTargets.map((t) => t.path)).toEqual(
      expect.arrayContaining(["packages/cli/src/cli.ts", "packages/api/src/lib/version.ts"]),
    );
  });
});
