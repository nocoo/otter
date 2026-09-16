import { describe, expect, it } from "vitest";
import { DevToolchainCollector } from "../../collectors/dev-toolchain.js";

describe("DevToolchainCollector", () => {
  it("should have correct metadata", () => {
    const collector = new DevToolchainCollector("/fake/home");
    expect(collector.id).toBe("dev-toolchain");
    expect(collector.label).toBe("Development Toolchain");
    expect(collector.category).toBe("environment");
  });

  it("should collect toolchains and global packages", async () => {
    const collector = new DevToolchainCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      switch (cmd) {
        case "fnm list":
          return "* v24.13.0 default\nv22.11.0\n";
        case "volta list all":
          return "node 24.13.0\nnpm 10.9.2\n";
        case "npm list -g --depth=0 --json":
          return '{"dependencies":{"vercel":{"version":"50.0.0"}}}';
        case "bun pm ls -g":
          return "@nocoo/otter@1.0.3\n";
        case "rustup show":
          return "installed toolchains\n--------------------\nstable-aarch64-apple-darwin (default)\n";
        case "cargo install --list":
          return "cargo-llvm-cov v0.8.4:\n";
        case "pyenv versions --bare":
          return "3.12.2\n";
        case "rbenv versions --bare":
          return "3.3.1\n";
        case "go version":
          return "go version go1.24.0 darwin/arm64\n";
        default:
          throw new Error(`unexpected cmd: ${cmd}`);
      }
    };

    const result = await collector.collect();

    expect(result.lists).toContainEqual({
      name: "node/v24.13.0",
      version: "24.13.0",
      meta: { type: "node-version", manager: "fnm", default: "true" },
    });
    expect(result.lists).toContainEqual({
      name: "vercel",
      version: "50.0.0",
      meta: { type: "npm-global" },
    });
    expect(result.lists).toContainEqual({
      name: "go",
      version: "1.24.0",
      meta: { type: "go-version" },
    });
  });

  it("should ignore fnm system alias and parse active rust toolchain only", async () => {
    const collector = new DevToolchainCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      switch (cmd) {
        case "fnm list":
          return "* v24.13.0 default\n* system\n";
        case "volta list all":
          throw new Error("command not found");
        case "npm list -g --depth=0 --json":
          return '{"dependencies":{}}';
        case "bun pm ls -g":
          throw new Error(
            'No package.json was found for directory "/Users/test/.bun/install/global"\nRun "bun init" to initialize a project',
          );
        case "rustup show":
          return [
            "Default host: aarch64-apple-darwin",
            "rustup home: /Users/test/.rustup",
            "",
            "installed toolchains",
            "--------------------",
            "stable-aarch64-apple-darwin (active, default)",
            "",
            "active toolchain",
            "----------------",
            "name: stable-aarch64-apple-darwin",
            "installed targets:",
            "  aarch64-apple-darwin",
          ].join("\n");
        case "cargo install --list":
          return "cargo-llvm-cov v0.8.4:\n";
        case "pyenv versions --bare":
          throw new Error("command not found");
        case "rbenv versions --bare":
          throw new Error("command not found");
        case "go version":
          throw new Error("command not found");
        default:
          throw new Error(`unexpected cmd: ${cmd}`);
      }
    };

    const result = await collector.collect();

    expect(result.lists).toContainEqual({
      name: "node/v24.13.0",
      version: "24.13.0",
      meta: { type: "node-version", manager: "fnm", default: "true" },
    });
    expect(result.lists).not.toContainEqual(
      expect.objectContaining({ name: expect.stringContaining("system") }),
    );
    expect(result.lists).toContainEqual({
      name: "stable-aarch64-apple-darwin",
      meta: { type: "rust-toolchain", active: "true", default: "true" },
    });
    expect(result.lists).not.toContainEqual(
      expect.objectContaining({ name: "name: stable-aarch64-apple-darwin" }),
    );
    expect(result.errors).not.toContainEqual(expect.stringContaining("Failed to collect bun"));
  });

  it("classifies missing-tool errors via every error-message branch", async () => {
    const collector = new DevToolchainCollector("/fake/home");
    const errs: Record<string, Error> = {
      "fnm list": new Error("fnm: command not found"),
      "volta list all": new Error("spawn volta ENOENT not found"),
      "npm list -g --depth=0 --json": new Error("ENOENT: No such file or directory"),
      "bun pm ls -g": new Error('Run "bun init" to initialize a project'),
      "rustup show": new Error("totally unexpected rustup failure"),
      "cargo install --list": new Error("not found"),
      "pyenv versions --bare": new Error("not found"),
      "rbenv versions --bare": new Error("not found"),
      "go version": new Error("not found"),
    };
    collector._execCommand = async (cmd: string) => {
      const err = errs[cmd];
      if (err) throw err;
      throw new Error(`unexpected cmd: ${cmd}`);
    };

    const result = await collector.collect();

    expect(result.skipped).toContain("Skipped fnm: not installed");
    expect(result.skipped).toContain("Skipped volta: not installed");
    expect(result.skipped).toContain("Skipped npm: not installed");
    expect(result.errors).toContainEqual(
      expect.stringContaining("Failed to collect rustup: totally unexpected rustup failure"),
    );
    expect(result.errors).not.toContainEqual(expect.stringContaining("Failed to collect bun"));
  });

  it("covers parser edge cases (rustup empty/colon-terminated, volta missing tool, npm no deps, cargo skip patterns, go regex miss)", async () => {
    const collector = new DevToolchainCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      switch (cmd) {
        case "fnm list":
          return "v22.11.0\n";
        case "volta list all":
          return "npm 10.0.0\n";
        case "npm list -g --depth=0 --json":
          return "{}";
        case "bun pm ls -g":
          return "";
        case "rustup show":
          return [
            "installed toolchains",
            "--------------------",
            "stable-aarch64-apple-darwin",
            "nightly-aarch64-apple-darwin:",
          ].join("\n");
        case "cargo install --list":
          return [
            "header without v marker",
            "no-v-prefix vNotMatching",
            "valid-tool v1.2.3:",
            " v0.1.0:",
          ].join("\n");
        case "pyenv versions --bare":
          return "";
        case "rbenv versions --bare":
          return "";
        case "go version":
          return "garbage output without version pattern";
        default:
          throw new Error(`unexpected cmd: ${cmd}`);
      }
    };

    const result = await collector.collect();

    expect(result.lists).toContainEqual(
      expect.objectContaining({
        name: "stable-aarch64-apple-darwin",
        meta: { type: "rust-toolchain" },
      }),
    );
    expect(result.lists).not.toContainEqual(
      expect.objectContaining({ name: expect.stringContaining("nightly") }),
    );
    expect(result.lists).toContainEqual(
      expect.objectContaining({
        name: "npm",
        version: "10.0.0",
        meta: { type: "tool-version", manager: "volta" },
      }),
    );
    expect(result.lists).toContainEqual(
      expect.objectContaining({
        name: "valid-tool",
        version: "1.2.3",
        meta: { type: "cargo-global" },
      }),
    );
    expect(result.lists).not.toContainEqual(
      expect.objectContaining({ meta: { type: "go-version" } }),
    );
  });

  it("rustup with empty installed-toolchains section (startIndex resolves but no toolchains)", async () => {
    const collector = new DevToolchainCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd === "rustup show") return "no toolchains header here";
      throw new Error("not found");
    };
    const result = await collector.collect();
    expect(result.lists.filter((l) => l.meta?.type === "rust-toolchain")).toHaveLength(0);
  });

  it("npm without dependencies key + cargo entry without version capture", async () => {
    const collector = new DevToolchainCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      switch (cmd) {
        case "npm list -g --depth=0 --json":
          return '{"name":"root"}';
        case "cargo install --list":
          return "tool v:";
        default:
          throw new Error("not found");
      }
    };
    const result = await collector.collect();
    expect(result.lists.filter((l) => l.meta?.type === "npm-global")).toHaveLength(0);
  });

  it("npm dep without version field falls into the no-version branch", async () => {
    const collector = new DevToolchainCollector("/fake/home");
    collector._execCommand = async (cmd: string) => {
      if (cmd === "npm list -g --depth=0 --json") return '{"dependencies":{"orphan":{}}}';
      throw new Error("not found");
    };
    const result = await collector.collect();
    expect(result.lists).toContainEqual({ name: "orphan", meta: { type: "npm-global" } });
  });
});
