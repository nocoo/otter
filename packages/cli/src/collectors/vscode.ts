import { exec } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  CollectedFile,
  CollectedListItem,
  CollectorCategory,
  CollectorResult,
} from "@otter/core";
import { BaseCollector } from "./base.js";

const execAsync = promisify(exec);

interface EditorConfig {
  editor: "vscode" | "cursor";
  cli: string;
  extensionsDir: string;
  userDir: string;
}

function parseCliExtensions(output: string, editor: string): CollectedListItem[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const atIndex = line.lastIndexOf("@");
      if (atIndex === -1) {
        return {
          name: line,
          meta: { type: "vscode-extension", editor },
        };
      }

      return {
        name: line.slice(0, atIndex),
        version: line.slice(atIndex + 1),
        meta: { type: "vscode-extension", editor },
      };
    });
}

function parseExtensionDirName(name: string): { name: string; version?: string } | null {
  const match = name.match(/^(.*)-([0-9][A-Za-z0-9.+_-]*)$/);
  if (!match) {
    return name.length > 0 ? { name } : null;
  }

  return {
    name: match[1],
    version: match[2],
  };
}

export class VSCodeCollector extends BaseCollector {
  readonly id = "vscode";
  readonly label = "VS Code / Cursor Configuration";
  readonly category: CollectorCategory = "config";

  private readonly editors: EditorConfig[];

  constructor(homeDir: string) {
    super(homeDir);
    this.editors = [
      {
        editor: "vscode",
        cli: "code",
        extensionsDir: join(homeDir, ".vscode", "extensions"),
        userDir: join(homeDir, "Library", "Application Support", "Code", "User"),
      },
      {
        editor: "cursor",
        cli: "cursor",
        extensionsDir: join(homeDir, ".cursor", "extensions"),
        userDir: join(homeDir, "Library", "Application Support", "Cursor", "User"),
      },
    ];
  }

  _execCommand = async (cmd: string): Promise<string> => {
    const { stdout } = await execAsync(cmd);
    return stdout;
  };

  async collect(): Promise<CollectorResult> {
    return this.timed(async (result) => {
      for (const editor of this.editors) {
        const items = await this.collectExtensions(editor, result);
        result.lists.push(...items);

        const files = await this.collectEditorFiles(editor, result);
        result.files.push(...files);
      }
    });
  }

  private async collectExtensions(
    editor: EditorConfig,
    result: CollectorResult,
  ): Promise<CollectedListItem[]> {
    try {
      const output = await this._execCommand(`${editor.cli} --list-extensions --show-versions`);
      return parseCliExtensions(output, editor.editor);
    } catch {
      return this.collectExtensionsFromDir(editor, result);
    }
  }

  private async collectExtensionsFromDir(
    editor: EditorConfig,
    result: CollectorResult,
  ): Promise<CollectedListItem[]> {
    try {
      const entries = await readdir(editor.extensionsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => parseExtensionDirName(entry.name))
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => ({
          ...item,
          meta: { type: "vscode-extension", editor: editor.editor },
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push(`Failed to read ${editor.editor} extensions: ${(err as Error).message}`);
      }
      return [];
    }
  }

  private async collectEditorFiles(
    editor: EditorConfig,
    result: CollectorResult,
  ): Promise<CollectedFile[]> {
    const files: CollectedFile[] = [];

    const settings = await this.safeReadFile(join(editor.userDir, "settings.json"), result, {
      redact: true,
    });
    if (settings) files.push(settings);

    const keybindings = await this.safeReadFile(join(editor.userDir, "keybindings.json"), result);
    if (keybindings) files.push(keybindings);

    const snippets = await this.collectDir(join(editor.userDir, "snippets"), result, {
      maxFileSize: 128 * 1024,
      filter: (filePath) => filePath.endsWith(".json") || filePath.endsWith(".code-snippets"),
    });
    files.push(...snippets);

    return files;
  }
}
