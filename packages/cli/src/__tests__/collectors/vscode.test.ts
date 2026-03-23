import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VSCodeCollector } from "../../collectors/vscode.js";

describe("VSCodeCollector", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "otter-vscode-test-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should have correct metadata", () => {
    const collector = new VSCodeCollector(tempHome);
    expect(collector.id).toBe("vscode");
    expect(collector.label).toBe("VS Code / Cursor Configuration");
    expect(collector.category).toBe("config");
  });

  it("should collect extensions from CLI when available", async () => {
    const collector = new VSCodeCollector(tempHome);
    collector._execCommand = async (cmd: string) => {
      if (cmd.startsWith("code ")) return "github.copilot@1.2.3\nms-python.python@2026.1.0\n";
      if (cmd.startsWith("cursor ")) return "cursor.tabnine@0.1.0\n";
      return "";
    };

    const result = await collector.collect();

    expect(result.lists).toContainEqual({
      name: "github.copilot",
      version: "1.2.3",
      meta: { type: "vscode-extension", editor: "vscode" },
    });
    expect(result.lists).toContainEqual({
      name: "cursor.tabnine",
      version: "0.1.0",
      meta: { type: "vscode-extension", editor: "cursor" },
    });
  });

  it("should fall back to extension directories", async () => {
    await mkdir(join(tempHome, ".vscode", "extensions", "github.copilot-1.2.3"), {
      recursive: true,
    });

    const collector = new VSCodeCollector(tempHome);
    collector._execCommand = async () => {
      throw new Error("cli missing");
    };

    const result = await collector.collect();

    expect(result.lists).toContainEqual({
      name: "github.copilot",
      version: "1.2.3",
      meta: { type: "vscode-extension", editor: "vscode" },
    });
  });

  it("should collect settings, keybindings, and snippets", async () => {
    const userDir = join(tempHome, "Library", "Application Support", "Code", "User");
    await mkdir(join(userDir, "snippets"), { recursive: true });
    await writeFile(join(userDir, "settings.json"), '{"apiKey":"secret"}');
    await writeFile(join(userDir, "keybindings.json"), "[]");
    await writeFile(join(userDir, "snippets", "ts.json"), '{"Print":{}}');

    const collector = new VSCodeCollector(tempHome);
    collector._execCommand = async () => "";

    const result = await collector.collect();

    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        join(userDir, "settings.json"),
        join(userDir, "keybindings.json"),
        join(userDir, "snippets", "ts.json"),
      ]),
    );
    const settings = result.files.find((file) => file.path.endsWith("settings.json"));
    expect(settings?.content).toContain("[REDACTED]");
  });
});
