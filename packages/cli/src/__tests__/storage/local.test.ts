import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotStore } from "../../storage/local.js";
import type { Snapshot } from "@otter/core";

/** Build a minimal valid Snapshot for testing */
function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    createdAt: "2026-03-06T12:30:00.000Z",
    machine: {
      hostname: "test-mac",
      platform: "darwin",
      osVersion: "15.0.0",
      arch: "arm64",
      username: "tester",
      homeDir: "/Users/tester",
      nodeVersion: "22.0.0",
    },
    collectors: [
      {
        id: "shell-config",
        label: "Shell Config",
        category: "config",
        files: [
          { path: "/Users/tester/.zshrc", content: "# zsh", sizeBytes: 5 },
        ],
        lists: [
          { name: "zsh" },
          { name: "bash" },
        ],
        errors: [],
        skipped: [],
        durationMs: 42,
      },
      {
        id: "homebrew",
        label: "Homebrew",
        category: "environment",
        files: [],
        lists: [
          { name: "git", version: "2.44" },
          { name: "node", version: "22.0" },
        ],
        errors: [],
        skipped: [],
        durationMs: 100,
      },
    ],
    ...overrides,
  };
}

describe("SnapshotStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "otter-snapshot-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // save()
  // -------------------------------------------------------------------------

  it("should save a snapshot and return the correct filename", async () => {
    const store = new SnapshotStore(tempDir);
    const snapshot = makeSnapshot();

    const filename = await store.save(snapshot);

    expect(filename).toBe("2026-03-06T12-30-00_abcdef12.json");
  });

  it("should write valid JSON to disk", async () => {
    const store = new SnapshotStore(tempDir);
    const snapshot = makeSnapshot();

    const filename = await store.save(snapshot);

    const raw = await readFile(join(tempDir, filename), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.id).toBe(snapshot.id);
    expect(parsed.version).toBe(1);
    expect(parsed.collectors).toHaveLength(2);
  });

  it("should write pretty-printed JSON with trailing newline", async () => {
    const store = new SnapshotStore(tempDir);
    const snapshot = makeSnapshot();

    const filename = await store.save(snapshot);

    const raw = await readFile(join(tempDir, filename), "utf-8");
    expect(raw).toMatch(/^\{\n/); // starts with pretty-printed opening
    expect(raw).toMatch(/\n$/); // ends with trailing newline
  });

  it("should create the storage directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "nested", "deep", "snapshots");
    const store = new SnapshotStore(nestedDir);
    const snapshot = makeSnapshot();

    const filename = await store.save(snapshot);

    const entries = await readdir(nestedDir);
    expect(entries).toContain(filename);
  });

  it("should handle timestamps without milliseconds", async () => {
    const store = new SnapshotStore(tempDir);
    const snapshot = makeSnapshot({ createdAt: "2026-01-15T08:05:30Z" });

    const filename = await store.save(snapshot);

    // No .000Z to strip — just colons replaced
    expect(filename).toBe("2026-01-15T08-05-30Z_abcdef12.json");
  });

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  it("should return empty array when directory does not exist", async () => {
    const store = new SnapshotStore(join(tempDir, "nonexistent"));

    const metas = await store.list();

    expect(metas).toEqual([]);
  });

  it("should return empty array when directory is empty", async () => {
    const store = new SnapshotStore(tempDir);

    const metas = await store.list();

    expect(metas).toEqual([]);
  });

  it("should list a single saved snapshot with correct metadata", async () => {
    const store = new SnapshotStore(tempDir);
    const snapshot = makeSnapshot();
    await store.save(snapshot);

    const metas = await store.list();

    expect(metas).toHaveLength(1);
    const meta = metas[0];
    expect(meta.id).toBe("abcdef12-3456-7890-abcd-ef1234567890");
    expect(meta.shortId).toBe("abcdef12");
    expect(meta.createdAt).toBe("2026-03-06T12:30:00.000Z");
    expect(meta.filename).toBe("2026-03-06T12-30-00_abcdef12.json");
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(meta.collectorCount).toBe(2);
    expect(meta.fileCount).toBe(1); // only shell-config has 1 file
    expect(meta.listCount).toBe(4); // 2 from shell-config + 2 from homebrew
  });

  it("should sort multiple snapshots newest first", async () => {
    const store = new SnapshotStore(tempDir);

    const older = makeSnapshot({
      id: "11111111-0000-0000-0000-000000000000",
      createdAt: "2026-03-01T10:00:00.000Z",
    });
    const newer = makeSnapshot({
      id: "22222222-0000-0000-0000-000000000000",
      createdAt: "2026-03-06T15:00:00.000Z",
    });

    // Save in reverse chronological order to verify sorting
    await store.save(newer);
    await store.save(older);

    const metas = await store.list();

    expect(metas).toHaveLength(2);
    expect(metas[0].shortId).toBe("22222222"); // newer first
    expect(metas[1].shortId).toBe("11111111"); // older second
  });

  it("should ignore non-JSON files in the directory", async () => {
    const store = new SnapshotStore(tempDir);
    await store.save(makeSnapshot());

    // Write a non-JSON file into the directory
    await writeFile(join(tempDir, "notes.txt"), "some notes");

    const metas = await store.list();

    expect(metas).toHaveLength(1);
  });

  it("should skip corrupted JSON files gracefully", async () => {
    const store = new SnapshotStore(tempDir);
    await store.save(makeSnapshot());

    // Write a corrupt JSON file
    await writeFile(join(tempDir, "corrupt_bad00000.json"), "not valid json{{{");

    const metas = await store.list();

    // Should only return the valid snapshot
    expect(metas).toHaveLength(1);
    expect(metas[0].shortId).toBe("abcdef12");
  });

  // -------------------------------------------------------------------------
  // load()
  // -------------------------------------------------------------------------

  it("should load a snapshot by short ID", async () => {
    const store = new SnapshotStore(tempDir);
    await store.save(makeSnapshot());

    const loaded = await store.load("abcdef12");

    expect(loaded).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
    expect(loaded!.id).toBe("abcdef12-3456-7890-abcd-ef1234567890");
    // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
    expect(loaded!.collectors).toHaveLength(2);
  });

  it("should load a snapshot by full ID", async () => {
    const store = new SnapshotStore(tempDir);
    await store.save(makeSnapshot());

    const loaded = await store.load("abcdef12-3456-7890-abcd-ef1234567890");

    expect(loaded).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
    expect(loaded!.id).toBe("abcdef12-3456-7890-abcd-ef1234567890");
  });

  it("should return null for a non-existent short ID", async () => {
    const store = new SnapshotStore(tempDir);
    await store.save(makeSnapshot());

    const loaded = await store.load("ffffffff");

    expect(loaded).toBeNull();
  });

  it("should return null when directory does not exist", async () => {
    const store = new SnapshotStore(join(tempDir, "nonexistent"));

    const loaded = await store.load("abcdef12");

    expect(loaded).toBeNull();
  });

  it("should load the correct snapshot from multiple", async () => {
    const store = new SnapshotStore(tempDir);

    const snap1 = makeSnapshot({
      id: "aaaa1111-0000-0000-0000-000000000000",
      createdAt: "2026-03-01T10:00:00.000Z",
    });
    const snap2 = makeSnapshot({
      id: "bbbb2222-0000-0000-0000-000000000000",
      createdAt: "2026-03-06T15:00:00.000Z",
    });

    await store.save(snap1);
    await store.save(snap2);

    const loaded = await store.load("bbbb2222");

    expect(loaded).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
    expect(loaded!.id).toBe("bbbb2222-0000-0000-0000-000000000000");
    // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
    expect(loaded!.createdAt).toBe("2026-03-06T15:00:00.000Z");
  });
});
