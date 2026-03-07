import { join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { BaseCollector } from "./base.js";
import type {
  CollectorCategory,
  CollectorResult,
  CollectedListItem,
} from "@otter/core";

const execAsync = promisify(exec);

function parseDockerContexts(output: string): CollectedListItem[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as {
          Name?: string;
          Current?: boolean;
          DockerEndpoint?: string;
        };
        if (!parsed.Name) return [];
        return [
          {
            name: parsed.Name,
            meta: {
              type: "docker-context",
              ...(parsed.Current ? { current: "true" } : {}),
              ...(parsed.DockerEndpoint
                ? { endpoint: parsed.DockerEndpoint }
                : {}),
            },
          },
        ];
      } catch {
        return [];
      }
    });
}

export class DockerCollector extends BaseCollector {
  readonly id = "docker";
  readonly label = "Docker Configuration";
  readonly category: CollectorCategory = "environment";

  _execCommand = async (cmd: string): Promise<string> => {
    const { stdout } = await execAsync(cmd);
    return stdout;
  };

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      const config = await this.safeReadFile(
        join(this.homeDir, ".docker", "config.json"),
        result,
        { redact: true }
      );
      if (config) result.files.push(config);

      try {
        const output = await this._execCommand("docker context ls --format json");
        result.lists.push(...parseDockerContexts(output));
      } catch (err) {
        result.errors.push(
          `Failed to run 'docker context ls --format json': ${(err as Error).message}`
        );
      }
    });
  }
}
