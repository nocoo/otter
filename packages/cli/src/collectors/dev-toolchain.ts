import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CollectedListItem, CollectorCategory, CollectorResult } from "@otter/core";
import { BaseCollector } from "./base.js";

const execAsync = promisify(exec);

function lines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseFnmVersion(line: string): string | null {
  const versionMatch = line.match(/v(\d+\.\d+\.\d+)/);
  return versionMatch?.[1] ?? null;
}

function parseInstalledRustToolchains(output: string): string[] {
  const allLines = output.split("\n");
  const startIndex = allLines.findIndex((line) => line.trim() === "installed toolchains");
  if (startIndex === -1) return [];

  const toolchains: string[] = [];
  for (const rawLine of allLines.slice(startIndex + 1)) {
    const line = rawLine.trim();
    if (!line) {
      if (toolchains.length > 0) break;
      continue;
    }
    if (/^-+$/.test(line)) continue;
    if (line.endsWith(":")) break;
    toolchains.push(line);
  }

  return toolchains;
}

export class DevToolchainCollector extends BaseCollector {
  readonly id = "dev-toolchain";
  readonly label = "Development Toolchain";
  readonly category: CollectorCategory = "environment";

  _execCommand = async (cmd: string): Promise<string> => {
    const { stdout } = await execAsync(cmd, { shell: "/bin/bash" });
    return stdout;
  };

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      result.lists.push(...(await this.collectFnm(result)));
      result.lists.push(...(await this.collectVolta(result)));
      result.lists.push(...(await this.collectNpmGlobals(result)));
      result.lists.push(...(await this.collectBunGlobals(result)));
      result.lists.push(...(await this.collectRustup(result)));
      result.lists.push(...(await this.collectCargoGlobals(result)));
      result.lists.push(...(await this.collectPyenv(result)));
      result.lists.push(...(await this.collectRbenv(result)));
      result.lists.push(...(await this.collectGo(result)));
    });
  }

  private async collectFnm(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("fnm list");
      return lines(output).flatMap((line) => {
        const version = parseFnmVersion(line);
        if (!version) return [];

        return [
          {
            name: `node/v${version}`,
            version,
            meta: {
              type: "node-version",
              manager: "fnm",
              ...(line.includes("default") ? { default: "true" } : {}),
            },
          },
        ];
      });
    } catch (err) {
      this.pushMissingToolError(result, "fnm", err);
      return [];
    }
  }

  private async collectVolta(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("volta list all");
      return lines(output)
        .filter((line) => /^(node|npm|yarn|pnpm)\s+/.test(line))
        .flatMap((line) => {
          const parts = line.split(/\s+/);
          const tool = parts[0];
          const version = parts[1];
          if (!tool) return [];
          return [
            {
              name: tool,
              ...(version ? { version } : {}),
              meta: { type: "tool-version", manager: "volta" },
            },
          ];
        });
    } catch (err) {
      this.pushMissingToolError(result, "volta", err);
      return [];
    }
  }

  private async collectNpmGlobals(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("npm list -g --depth=0 --json");
      const parsed = JSON.parse(output) as {
        dependencies?: Record<string, { version?: string }>;
      };
      return Object.entries(parsed.dependencies ?? {})
        .map(([name, meta]) => ({
          name,
          ...(meta.version ? { version: meta.version } : {}),
          meta: { type: "npm-global" },
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      this.pushMissingToolError(result, "npm", err);
      return [];
    }
  }

  private async collectBunGlobals(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("bun pm ls -g");
      return lines(output)
        .map((line) => line.replace(/^[├└─\s]+/, "").trim())
        .filter((line) => line.includes("@"))
        .map((line) => {
          const atIndex = line.lastIndexOf("@");
          return {
            name: line.slice(0, atIndex),
            version: line.slice(atIndex + 1),
            meta: { type: "bun-global" },
          };
        });
    } catch (err) {
      if (this.shouldIgnoreBunGlobalError(err)) {
        return [];
      }
      this.pushMissingToolError(result, "bun", err);
      return [];
    }
  }

  private async collectRustup(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("rustup show");
      return parseInstalledRustToolchains(output).map((line) => {
        const isDefault = line.includes("default");
        const isActive = line.includes("active");
        const name = line.replace(/\s*\((?:active(?:,\s*)?)?default\)/, "").trim();
        return {
          name,
          meta: {
            type: "rust-toolchain",
            ...(isActive ? { active: "true" } : {}),
            ...(isDefault ? { default: "true" } : {}),
          },
        };
      });
    } catch (err) {
      this.pushMissingToolError(result, "rustup", err);
      return [];
    }
  }

  private async collectCargoGlobals(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("cargo install --list");
      const items: CollectedListItem[] = [];
      for (const line of lines(output)) {
        if (!line.includes(" v")) continue;
        const match = line.match(/^([^\s]+) v([^:]+):?$/);
        if (!match) continue;
        const matchedName = match[1];
        const matchedVersion = match[2];
        if (!matchedName) continue;
        items.push({
          name: matchedName,
          ...(matchedVersion ? { version: matchedVersion } : {}),
          meta: { type: "cargo-global" },
        });
      }
      return items;
    } catch (err) {
      this.pushMissingToolError(result, "cargo", err);
      return [];
    }
  }

  private async collectPyenv(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("pyenv versions --bare");
      return lines(output).map((version) => ({
        name: `python/${version}`,
        version,
        meta: { type: "python-version" },
      }));
    } catch (err) {
      this.pushMissingToolError(result, "pyenv", err);
      return [];
    }
  }

  private async collectRbenv(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("rbenv versions --bare");
      return lines(output).map((version) => ({
        name: `ruby/${version}`,
        version,
        meta: { type: "ruby-version" },
      }));
    } catch (err) {
      this.pushMissingToolError(result, "rbenv", err);
      return [];
    }
  }

  private async collectGo(result: CollectorResult): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand("go version");
      const match = output.match(/go version go([^\s]+)/);
      if (!match?.[1]) return [];
      return [
        {
          name: "go",
          version: match[1],
          meta: { type: "go-version" },
        },
      ];
    } catch (err) {
      this.pushMissingToolError(result, "go", err);
      return [];
    }
  }

  private pushMissingToolError(result: CollectorResult, tool: string, err: unknown): void {
    const message = (err as Error).message;
    if (
      message.includes("not found") ||
      message.includes("command not found") ||
      message.includes("No such file")
    ) {
      result.skipped.push(`Skipped ${tool}: not installed`);
    } else {
      result.errors.push(`Failed to collect ${tool}: ${message}`);
    }
  }

  private shouldIgnoreBunGlobalError(err: unknown): boolean {
    const message = (err as Error).message;
    return (
      message.includes("No package.json was found for directory") ||
      message.includes('Run "bun init" to initialize a project')
    );
  }
}
