import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CloudCLICollector } from "../../collectors/cloud-cli.js";

describe("CloudCLICollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-cloud-cli-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should collect cloud config files and aws profiles", async () => {
    await mkdir(join(tempHome, ".azure"), { recursive: true });
    await mkdir(join(tempHome, ".aws"), { recursive: true });
    await mkdir(join(tempHome, ".config", "gcloud", "configurations"), {
      recursive: true,
    });
    await mkdir(join(tempHome, ".config", "railway"), { recursive: true });

    await writeFile(join(tempHome, ".azure", "config"), "token=secret");
    await writeFile(join(tempHome, ".azure", "azureProfile.json"), '{"subscriptionId":"abc"}');
    await writeFile(join(tempHome, ".azure", "clouds.config"), "AzureCloud");
    await writeFile(
      join(tempHome, ".aws", "config"),
      "[default]\nregion=us-east-1\n[profile work]\nregion=us-west-2\n",
    );
    await writeFile(join(tempHome, ".config", "gcloud", "properties"), "account=test@example.com");
    await writeFile(
      join(tempHome, ".config", "gcloud", "configurations", "config_default"),
      "project=test",
    );
    await writeFile(join(tempHome, ".config", "railway", "config.json"), '{"token":"secret"}');

    const collector = new CloudCLICollector(tempHome);
    const result = await collector.collect();

    expect(result.files.length).toBeGreaterThanOrEqual(6);
    expect(result.lists).toContainEqual({
      name: "default",
      meta: { type: "aws-profile" },
    });
    expect(result.lists).toContainEqual({
      name: "work",
      meta: { type: "aws-profile" },
    });
    expect(result.files.some((file) => file.content.includes("[REDACTED]"))).toBe(true);
  });

  it("ignores aws sections that are neither 'default' nor 'profile <name>'", async () => {
    await mkdir(join(tempHome, ".aws"), { recursive: true });
    await writeFile(
      join(tempHome, ".aws", "config"),
      "[default]\nregion=us-east-1\n[other]\nfoo=bar\n[profile work]\nregion=us-west-2\n",
    );

    const collector = new CloudCLICollector(tempHome);
    const result = await collector.collect();

    const profiles = result.lists.filter((l) => l.meta?.type === "aws-profile").map((l) => l.name);
    expect(profiles).toEqual(["default", "work"]);
    expect(profiles).not.toContain("other");
  });
});
