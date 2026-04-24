import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerCollector } from "../../collectors/docker.js";

describe("DockerCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-docker-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should have correct metadata", () => {
    const collector = new DockerCollector(tempHome);
    expect(collector.id).toBe("docker");
    expect(collector.label).toBe("Docker Configuration");
    expect(collector.category).toBe("environment");
  });

  it("should collect docker config with redaction", async () => {
    await mkdir(join(tempHome, ".docker"), { recursive: true });
    await writeFile(
      join(tempHome, ".docker", "config.json"),
      '{"auths":{"ghcr.io":{"auth":"secret-token"}}}',
    );

    const collector = new DockerCollector(tempHome);
    collector._execCommand = async () => "";
    const result = await collector.collect();

    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toContain("[REDACTED]");
  });

  it("records error when docker context ls fails", async () => {
    const collector = new DockerCollector(tempHome);
    collector._execCommand = async () => {
      throw new Error("docker not installed");
    };
    const result = await collector.collect();
    expect(result.errors.some((e) => e.includes("docker not installed"))).toBe(true);
  });

  it("skips lines with no Name and tolerates malformed JSON", async () => {
    const collector = new DockerCollector(tempHome);
    collector._execCommand = async () =>
      ['{"Current":true}', "not-json", '{"Name":"ok"}', "  "].join("\n");
    const result = await collector.collect();
    expect(result.lists.map((l) => l.name)).toEqual(["ok"]);
    expect(result.lists[0].meta).toEqual({ type: "docker-context" });
  });

  it("should parse docker contexts", async () => {
    const collector = new DockerCollector(tempHome);
    collector._execCommand = async () =>
      '{"Current":true,"DockerEndpoint":"unix:///tmp/docker.sock","Name":"desktop-linux"}\n';

    const result = await collector.collect();

    expect(result.lists).toEqual([
      {
        name: "desktop-linux",
        meta: {
          type: "docker-context",
          current: "true",
          endpoint: "unix:///tmp/docker.sock",
        },
      },
    ]);
  });
});
