import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShellConfigCollector } from "../../collectors/shell-config.js";

describe("ShellConfigCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should have correct metadata", () => {
    const collector = new ShellConfigCollector(tempHome);
    expect(collector.id).toBe("shell-config");
    expect(collector.label).toBe("Shell Configuration");
    expect(collector.category).toBe("environment");
  });

  it("should collect .zshrc", async () => {
    await writeFile(join(tempHome, ".zshrc"), 'export PATH="/usr/local/bin:$PATH"');

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toContainEqual(
      expect.objectContaining({
        path: join(tempHome, ".zshrc"),
      })
    );
  });

  it("should collect .zprofile", async () => {
    await writeFile(join(tempHome, ".zprofile"), "eval $(/opt/homebrew/bin/brew shellenv)");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toContainEqual(
      expect.objectContaining({
        path: join(tempHome, ".zprofile"),
      })
    );
  });

  it("should collect .bashrc and .bash_profile", async () => {
    await writeFile(join(tempHome, ".bashrc"), "alias ll='ls -la'");
    await writeFile(join(tempHome, ".bash_profile"), "source ~/.bashrc");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join(tempHome, ".bashrc"));
    expect(paths).toContain(join(tempHome, ".bash_profile"));
  });

  it("should collect .gitconfig", async () => {
    await writeFile(join(tempHome, ".gitconfig"), "[user]\n  name = Test");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toContainEqual(
      expect.objectContaining({
        path: join(tempHome, ".gitconfig"),
      })
    );
  });

  it("should collect .ssh/config (but not keys)", async () => {
    const sshDir = join(tempHome, ".ssh");
    await mkdir(sshDir, { recursive: true });
    await writeFile(join(sshDir, "config"), "Host github.com\n  User git");
    await writeFile(join(sshDir, "id_rsa"), "PRIVATE KEY");
    await writeFile(join(sshDir, "id_rsa.pub"), "PUBLIC KEY");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join(sshDir, "config"));
    // Must NOT collect private/public keys
    expect(paths).not.toContain(join(sshDir, "id_rsa"));
    expect(paths).not.toContain(join(sshDir, "id_rsa.pub"));
  });

  it("should return empty when no shell configs exist", async () => {
    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should collect multiple dotfiles", async () => {
    await writeFile(join(tempHome, ".zshrc"), "zsh");
    await writeFile(join(tempHome, ".vimrc"), "set number");
    await writeFile(join(tempHome, ".npmrc"), "registry=https://registry.npmjs.org");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.files.length).toBeGreaterThanOrEqual(3);
  });
});
