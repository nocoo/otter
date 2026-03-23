import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ShellConfigCollector,
  classifySshFile,
} from "../../collectors/shell-config.js";

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

  it("should collect .ssh/config but not key content, and report key presence", async () => {
    const sshDir = join(tempHome, ".ssh");
    await mkdir(sshDir, { recursive: true });
    await writeFile(join(sshDir, "config"), "Host github.com\n  User git");
    await writeFile(join(sshDir, "id_rsa"), "PRIVATE KEY");
    await writeFile(join(sshDir, "id_rsa.pub"), "PUBLIC KEY");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(join(sshDir, "config"));
    // Must NOT collect private/public keys as files
    expect(paths).not.toContain(join(sshDir, "id_rsa"));
    expect(paths).not.toContain(join(sshDir, "id_rsa.pub"));

    // Must report keys as list items with presence metadata
    const keyItems = result.lists.filter((l) => l.meta?.source === ".ssh");
    expect(keyItems).toHaveLength(2);
    expect(keyItems).toContainEqual(
      expect.objectContaining({
        name: "id_rsa",
        meta: expect.objectContaining({ type: "private-key" }),
      })
    );
    expect(keyItems).toContainEqual(
      expect.objectContaining({
        name: "id_rsa.pub",
        meta: expect.objectContaining({ type: "public-key" }),
      })
    );
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

  it("should detect multiple SSH key pairs", async () => {
    const sshDir = join(tempHome, ".ssh");
    await mkdir(sshDir, { recursive: true });
    await writeFile(join(sshDir, "id_rsa"), "key1");
    await writeFile(join(sshDir, "id_rsa.pub"), "key1.pub");
    await writeFile(join(sshDir, "id_ed25519"), "key2");
    await writeFile(join(sshDir, "id_ed25519.pub"), "key2.pub");
    await writeFile(join(sshDir, "id-work"), "key3");
    await writeFile(join(sshDir, "id-work.pub"), "key3.pub");
    await writeFile(join(sshDir, "config"), "Host *");
    await writeFile(join(sshDir, "known_hosts"), "github.com ssh-rsa AAA");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    const keyItems = result.lists.filter((l) => l.meta?.source === ".ssh");
    // id_rsa (private), id_rsa.pub (public), id_ed25519 (private),
    // id_ed25519.pub (public), id-work.pub (public)
    // Note: id-work does NOT match id_ prefix pattern, so not detected as private key
    const privateKeys = keyItems.filter(
      (l) => l.meta?.type === "private-key"
    );
    const publicKeys = keyItems.filter((l) => l.meta?.type === "public-key");
    expect(privateKeys.length).toBe(2); // id_rsa, id_ed25519
    expect(publicKeys.length).toBe(3); // id_rsa.pub, id_ed25519.pub, id-work.pub
  });

  it("should include modifiedAt in SSH key metadata", async () => {
    const sshDir = join(tempHome, ".ssh");
    await mkdir(sshDir, { recursive: true });
    await writeFile(join(sshDir, "id_rsa"), "key");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    const key = result.lists.find((l) => l.name === "id_rsa");
    expect(key).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    expect(key!.meta?.modifiedAt).toBeDefined();
    // Should be a valid ISO date
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    expect(new Date(key!.meta!.modifiedAt!).getTime()).not.toBeNaN();
  });

  it("should not report non-key SSH files as keys", async () => {
    const sshDir = join(tempHome, ".ssh");
    await mkdir(sshDir, { recursive: true });
    await writeFile(join(sshDir, "config"), "Host *");
    await writeFile(join(sshDir, "known_hosts"), "github.com");
    await writeFile(join(sshDir, "known_hosts.old"), "old");
    await writeFile(join(sshDir, "authorized_keys"), "auth");
    await writeFile(join(sshDir, "environment"), "env");
    await writeFile(join(sshDir, "agent"), "socket");

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    const keyItems = result.lists.filter((l) => l.meta?.source === ".ssh");
    expect(keyItems).toHaveLength(0);
  });

  it("should return empty lists when .ssh does not exist", async () => {
    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    expect(result.lists).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should record error when SSH directory read fails with non-ENOENT", async () => {
    const sshDir = join(tempHome, ".ssh");
    await mkdir(sshDir, { recursive: true });
    await writeFile(join(sshDir, "id_rsa"), "key");
    // Remove read permissions from directory
    await chmod(sshDir, 0o000);

    const collector = new ShellConfigCollector(tempHome);
    const result = await collector.collect();

    const sshKeys = result.lists.filter((l) => l.meta?.source === ".ssh");
    expect(sshKeys).toHaveLength(0);
    expect(
      result.errors.some((e) => e.includes("SSH directory"))
    ).toBe(true);

    // Restore permissions for cleanup
    await chmod(sshDir, 0o755);
  });
});

describe("classifySshFile", () => {
  it("should classify id_rsa as private-key", () => {
    expect(classifySshFile("id_rsa")).toBe("private-key");
  });

  it("should classify id_ed25519 as private-key", () => {
    expect(classifySshFile("id_ed25519")).toBe("private-key");
  });

  it("should classify id_ecdsa as private-key", () => {
    expect(classifySshFile("id_ecdsa")).toBe("private-key");
  });

  it("should classify identity as private-key", () => {
    expect(classifySshFile("identity")).toBe("private-key");
  });

  it("should classify *.pub files as public-key", () => {
    expect(classifySshFile("id_rsa.pub")).toBe("public-key");
    expect(classifySshFile("id_ed25519.pub")).toBe("public-key");
    expect(classifySshFile("custom-key.pub")).toBe("public-key");
  });

  it("should return null for non-key files", () => {
    expect(classifySshFile("config")).toBeNull();
    expect(classifySshFile("known_hosts")).toBeNull();
    expect(classifySshFile("authorized_keys")).toBeNull();
    expect(classifySshFile("agent")).toBeNull();
    expect(classifySshFile("environment")).toBeNull();
  });
});
