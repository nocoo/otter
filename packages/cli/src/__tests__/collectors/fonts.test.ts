import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FontsCollector } from "../../collectors/fonts.js";

describe("FontsCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-fonts-test-"));
    await mkdir(join(tempHome, "Library", "Fonts"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should collect installed fonts", async () => {
    await writeFile(join(tempHome, "Library", "Fonts", "JetBrainsMono.ttf"), "fake");
    await writeFile(join(tempHome, "Library", "Fonts", "CPMono.otf"), "fake");

    const collector = new FontsCollector(tempHome);
    const result = await collector.collect();

    expect(result.lists).toEqual([
      { name: "CPMono", meta: { type: "font", format: "otf" } },
      { name: "JetBrainsMono", meta: { type: "font", format: "ttf" } },
    ]);
  });
});
