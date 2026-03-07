import { describe, it, expect } from "vitest";
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
});
