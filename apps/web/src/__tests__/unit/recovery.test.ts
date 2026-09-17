import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollectedFile } from "@otter/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { SnapshotData } from "../../components/snapshot/types";
import {
  compareRecovery,
  coverageLabel,
  fileBytes,
  fileKey,
  materializedFiles,
  recoveryArchive,
} from "../../lib/recovery";

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, "Required fixture value is missing");
  return value;
}

const fixture = (): SnapshotData =>
  JSON.parse(readFileSync(resolve("scripts/fixtures/snapshot-v2.json"), "utf8"));
describe("browser recovery artifacts", () => {
  it("exports verified full archives and selected skill packages, retaining scripts, topology and independent personas", async () => {
    const snapshot = fixture();
    const archive = unzipSync(await recoveryArchive(snapshot));
    expect(
      strFromU8(required(archive["roots/claude%3Adefault/skills/local/scripts/run.sh"])),
    ).toContain("echo recovered");
    expect(strFromU8(required(archive["roots/hermes%3Acherry/SOUL.md"]))).toContain("cherry");
    expect(JSON.parse(strFromU8(required(archive["links.json"])))).toHaveLength(1);
    expect(JSON.parse(strFromU8(required(archive["snapshot.json"])))).toEqual(snapshot);
    expect(strFromU8(required(archive["RESTORE.md"]))).toContain("coverage issue");
    const partial = unzipSync(
      await recoveryArchive(snapshot, { rootId: "claude:default", relativePath: "skills/local" }),
    );
    expect(partial["snapshot.json"]).toBeUndefined();
    expect(Object.keys(partial)).not.toContain("roots/workflow/AGENTS.md");
    expect(
      Object.keys(
        unzipSync(await recoveryArchive(snapshot, { rootId: "claude:default", relativePath: "." })),
      ),
    ).toContain("roots/claude%3Adefault/CLAUDE.md");
  });
  it("refuses traversal, duplicate paths and tampered content; preserves explicitly encoded binary data", async () => {
    const snapshot = fixture(),
      files = required(snapshot.collectors[0]).files as CollectedFile[];
    const file = required(files[0]);
    file.content += "changed";
    await expect(recoveryArchive(snapshot)).rejects.toThrow("verification failed");
    file.relativePath = "../escape";
    await expect(recoveryArchive(snapshot)).rejects.toThrow("unsafe");
    const duplicate = fixture();
    required(duplicate.collectors[0]).files.push(required(duplicate.collectors[0]?.files[0]));
    await expect(recoveryArchive(duplicate)).rejects.toThrow("duplicate");
    const binary = fixture(),
      first = required(binary.collectors[0]).files[0] as CollectedFile;
    first.encoding = "base64";
    first.content = btoa(first.content);
    expect(fileBytes(first).length).toBe(first.sizeBytes);
    await expect(recoveryArchive(binary)).resolves.toBeTruthy();
  });
  it("supports v1 files and marks legacy skill lists; v2 comparisons include equal-size edits, modes, links and inventory versions", async () => {
    const older = fixture(),
      newer = fixture();
    expect(compareRecovery(older, newer).files).toHaveLength(0);
    const file = required(newer.collectors[0]).files[0] as CollectedFile;
    file.mode = 0o755;
    file.content = file.content.replace("Read", "Edit");
    required(newer.collectors[0]).files.pop();
    required(newer.collectors[1]?.lists[0]).version = "2.0";
    required(newer.collectors[0]).files.push({ path: "/new", content: "new", sizeBytes: 3 });
    const diff = compareRecovery(older, newer);
    expect(diff.files.map((f) => f.change).sort()).toEqual(["added", "changed", "removed"]);
    expect(diff.environment).toHaveLength(1);
    required(newer.workspace).coverage.complete = false;
    expect(compareRecovery(older, newer).files.map((f) => f.change)).not.toContain("removed");
    delete newer.workspace;
    newer.version = 1;
    for (const collector of newer.collectors)
      for (const item of collector.files) {
        const entry = item as CollectedFile;
        delete entry.rootId;
        delete entry.sha256;
        delete entry.relativePath;
      }
    expect(strFromU8(required(unzipSync(await recoveryArchive(newer))["RESTORE.md"]))).toContain(
      "skill names",
    );
    expect(
      fileKey(required(newer.collectors[0]).files[0] as CollectedFile, "agent", "/Users/fixture"),
    ).toContain("agent/~");
    expect(coverageLabel(true)).toContain("Complete");
    expect(coverageLabel(false)).toContain("Partial");
    expect(coverageLabel()).toContain("Legacy");
  });

  it("resolves only matching inline content references and refuses missing, inconsistent or cyclic references", async () => {
    const snapshot = fixture();
    const files = required(snapshot.collectors[0]).files as CollectedFile[];
    const source = required(files.find((file) => file.rootId === "workflow"));
    const reference: CollectedFile = {
      ...source,
      path: "/offline/alias.md",
      rootId: "alias",
      relativePath: "alias.md",
      content: "",
      contentRef: required(source.sha256),
    };
    files.push(reference);
    expect(materializedFiles(snapshot).find((file) => file.path === reference.path)?.content).toBe(
      source.content,
    );
    const zip = unzipSync(await recoveryArchive(snapshot, { rootId: "alias", relativePath: "." }));
    expect(strFromU8(required(zip["roots/alias/alias.md"]))).toBe(source.content);
    reference.sizeBytes++;
    expect(() => materializedFiles(snapshot)).toThrow("reference");
    reference.sizeBytes = source.sizeBytes;
    reference.encoding = "base64";
    expect(() => materializedFiles(snapshot)).toThrow("reference");
    reference.encoding = required(source.encoding);
    reference.sha256 = "0".repeat(64);
    expect(() => materializedFiles(snapshot)).toThrow("reference");
    reference.sha256 = required(source.sha256);
    reference.contentRef = "f".repeat(64);
    expect(() => materializedFiles(snapshot)).toThrow("reference");
    reference.contentRef = required(source.sha256);
    for (const file of files.filter((file) => file.sha256 === source.sha256))
      file.contentRef = required(source.sha256);
    await expect(recoveryArchive(snapshot)).rejects.toThrow("reference");
  });

  it("preserves empty directories and Unix modes in the ZIP, recording broken links without creating empty substitutes", async () => {
    const snapshot = fixture();
    const files = required(snapshot.collectors[0]).files as CollectedFile[];
    files.push(
      {
        path: "/offline/empty",
        rootId: "empty",
        relativePath: ".",
        kind: "directory",
        content: "",
        sizeBytes: 0,
        mode: 0o751,
      },
      {
        path: "/offline/link",
        rootId: "link",
        relativePath: ".",
        kind: "symlink",
        targetKind: "directory",
        linkTarget: "/offline/empty",
        content: "",
        sizeBytes: 0,
        mode: 0o750,
      },
      {
        path: "/offline/broken",
        rootId: "broken",
        relativePath: "entry",
        kind: "symlink",
        linkTarget: "/missing",
        content: "",
        sizeBytes: 0,
      },
      {
        path: "/offline/global.md",
        rootId: "global",
        relativePath: ".",
        content: "Independent file",
        sizeBytes: 16,
      },
    );
    const bytes = await recoveryArchive(snapshot);
    const zip = unzipSync(bytes);
    expect(zip["roots/empty/"]).toHaveLength(0);
    expect(zip["roots/link/"]).toHaveLength(0);
    expect(zip["roots/broken/entry"]).toBeUndefined();
    expect(strFromU8(required(zip["roots/global/global.md"]))).toBe("Independent file");
    expect(JSON.parse(strFromU8(required(zip["links.json"])))).toContainEqual(
      expect.objectContaining({ materialized: "unavailable" }),
    );
    // Read central-directory Unix attributes, which unzipSync intentionally does not expose.
    const modes = new Map<string, number>();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset + 46 <= bytes.length; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const length = view.getUint16(offset + 28, true);
      modes.set(
        strFromU8(bytes.subarray(offset + 46, offset + 46 + length)),
        view.getUint32(offset + 38, true) >>> 16,
      );
    }
    expect(modes.get("roots/empty/")).toBe(0o040751);
    expect(modes.get("roots/link/")).toBe(0o040750);
    expect(modes.get("roots/claude%3Adefault/skills/local/scripts/run.sh")).toBe(0o100755);
    required(files.find((file) => file.rootId === "empty")).relativePath = "../escape";
    await expect(recoveryArchive(snapshot)).rejects.toThrow("unsafe");
  });

  it("compares scope changes, link chains and environment removals without treating unavailable collectors as deletions", () => {
    const older = fixture(),
      newer = fixture();
    const file = required(required(newer.collectors[0]).files[0]) as CollectedFile;
    file.links = [{ path: file.path, target: "/new-source", resolvedPath: "/new-source" }];
    expect(compareRecovery(older, newer).files).toContainEqual(
      expect.objectContaining({ change: "changed" }),
    );
    newer.collectors.pop();
    expect(compareRecovery(older, newer).environment).toHaveLength(1);
    required(newer.workspace).scopeFingerprint = "different-scope";
    const uncertain = compareRecovery(older, newer);
    expect(uncertain.scopeChanged).toBe(true);
    expect(uncertain.environment).toHaveLength(0);
    expect(compareRecovery(newer, older).environment).toHaveLength(1);
    expect(fileKey({ path: "/a", content: "", sizeBytes: 0 }, "legacy", "")).toBe("legacy//a");
  });
});
