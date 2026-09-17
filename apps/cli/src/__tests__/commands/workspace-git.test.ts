import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git, observeGit, sanitizeRemote } from "../../workspace/git.js";

let root: string, repo: string, config: string;
async function commit(path: string, content: string) {
  await writeFile(join(path, "rules.md"), content);
  await git(path, ["add", "."]);
  await git(path, ["commit", "-m", content]);
}
async function author(path: string) {
  await git(path, ["config", "user.name", "Otter Fixture"]);
  await git(path, ["config", "user.email", "fixture@example.com"]);
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "otter-git-"));
  repo = join(root, "repo");
  config = join(root, "config");
  await mkdir(repo);
  await mkdir(config);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("source repository observations", () => {
  it("distinguishes folders, unborn branches, staged/unstaged/untracked changes, renames and detached HEAD", async () => {
    expect((await observeGit(repo, config, "source")).repository).toBe(false);
    await git(repo, ["init", "-b", "main"]);
    await author(repo);
    expect(await observeGit(repo, config, "source")).toMatchObject({
      repository: true,
      unborn: true,
      branch: "main",
      ahead: 0,
      behind: 0,
    });
    await commit(repo, "initial");
    await writeFile(join(repo, "rules.md"), "staged");
    await git(repo, ["add", "rules.md"]);
    await writeFile(join(repo, "rules.md"), "unstaged");
    await writeFile(join(repo, "? untracked\nname.md"), "untracked");
    expect(await observeGit(repo, config, "source")).toMatchObject({
      staged: 1,
      unstaged: 1,
      untracked: 1,
    });
    await git(repo, ["reset", "--hard", "HEAD"]);
    await git(repo, ["mv", "rules.md", "renamed.md"]);
    expect((await observeGit(repo, config, "source")).staged).toBe(1);
    await git(repo, ["reset", "--hard", "HEAD"]);
    await git(repo, ["checkout", "--detach"]);
    expect((await observeGit(repo, config, "source")).detached).toBe(true);
  });

  it("separates cached tracking refs from explicit remote checks, including diverged branches and failed fetches", async () => {
    const remote = join(root, "origin.git"),
      peer = join(root, "peer");
    await mkdir(remote);
    await git(remote, ["init", "--bare", "--initial-branch=main"]);
    await git(repo, ["init", "-b", "main"]);
    await author(repo);
    await commit(repo, "base");
    await git(repo, ["remote", "add", "origin", remote]);
    await git(repo, ["push", "-u", "origin", "main"]);
    expect((await observeGit(repo, config, "source")).remoteCheckedAt).toBeUndefined();
    await git(root, ["clone", remote, peer]);
    await author(peer);
    await commit(peer, "peer change");
    await git(peer, ["push"]);
    await commit(repo, "local change");
    const fetched = await observeGit(repo, config, "source", true);
    expect(fetched).toMatchObject({ ahead: 1, behind: 1, upstream: "origin/main" });
    expect(fetched.remoteCheckedAt).toBeTruthy();
    expect(fetched.repoKey).toMatch(/^[a-f0-9]{64}$/);
    await git(repo, ["remote", "set-url", "origin", join(root, "missing")]);
    const failed = await observeGit(repo, config, "source", true);
    expect(failed.remoteCheckedAt).toBe(fetched.remoteCheckedAt);
    expect(failed.fetchError).toContain("Fetch failed");
    expect((await observeGit(repo, config, "source")).fetchError).toBe(failed.fetchError);
  });

  it("reports unresolved conflicts without changing the working tree", async () => {
    await git(repo, ["init", "-b", "main"]);
    await author(repo);
    await commit(repo, "base");
    await git(repo, ["checkout", "-b", "side"]);
    await commit(repo, "side");
    await git(repo, ["checkout", "main"]);
    await commit(repo, "main");
    await expect(git(repo, ["merge", "side"])).rejects.toThrow();
    expect((await observeGit(repo, config, "source")).conflicts).toBe(1);
    expect(sanitizeRemote("https://user:pass@example.com/repo.git?token=private#fragment")).toBe(
      "https://example.com/repo.git",
    );
    expect(sanitizeRemote("git@example.com:owner/repo.git")).toBe("example.com:owner/repo.git");
    expect(sanitizeRemote("/local/repository")).toBe("/local/repository");
  });
});
