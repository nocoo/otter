import { mkdtemp, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileCapture } from "../../workspace/files.js";
import { addSource, editRegistry, readRegistry, syncWorkspace } from "../../workspace/registry.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "otter-capture-race-"));
  vi.mocked(open).mockImplementation(actual.open);
  vi.mocked(rename).mockImplementation(actual.rename);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function afterRead(path: string, change: () => Promise<void>) {
  const physical = await realpath(path);
  let changed = false;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    if (String(args[0]) === physical) {
      const read = handle.read.bind(handle);
      handle.read = (async (...values: Parameters<typeof handle.read>) => {
        const result = await read(...values);
        if (!changed) {
          changed = true;
          await change();
        }
        return result;
      }) as typeof handle.read;
    }
    return handle;
  });
}
const plan = (path: string) => ({
  root: {
    id: "fixture",
    path,
    label: "fixture",
    role: "source" as const,
    agentIds: [],
    status: "complete" as const,
  },
});

it.each(["missing", "retargeted", "topology"])(
  "reports an unstable capture when a link becomes %s during the read",
  async (change) => {
    const target = join(root, "target"),
      entry = join(root, "entry"),
      other = join(root, "other");
    await writeFile(target, "Original bytes\n");
    await writeFile(other, "Other bytes\n");
    await actual.symlink(target, entry);
    await afterRead(target, async () => {
      await rm(entry);
      if (change === "retargeted") await actual.symlink(other, entry);
      if (change === "topology") {
        await actual.symlink(target, join(root, "hop"));
        await actual.symlink(join(root, "hop"), entry);
      }
    });
    const capture = new FileCapture();
    await capture.capture(plan(entry));
    expect(capture.files).toHaveLength(0);
    expect(capture.issues).toContainEqual(
      expect.objectContaining({
        status: "unstable",
        reason: "Link changed during capture; scan again",
      }),
    );
  },
);

it("detects an atomic replacement of the source file after reading its previous inode", async () => {
  const target = join(root, "file");
  await writeFile(target, "Original bytes\n");
  await afterRead(target, async () => {
    await writeFile(join(root, "replacement"), "Replacement bytes\n");
    await actual.rename(join(root, "replacement"), target);
  });
  const capture = new FileCapture();
  await capture.capture(plan(target));
  expect(capture.files).toHaveLength(0);
  expect(capture.issues).toContainEqual(expect.objectContaining({ status: "unstable" }));
});

it("marks directory coverage incomplete if a new file arrives after enumeration", async () => {
  const target = join(root, "file");
  await writeFile(target, "Stable file\n");
  await afterRead(target, async () => {
    await writeFile(join(root, "late"), "Not in the enumeration\n");
    await actual.utimes(root, new Date(), new Date(Date.now() + 2000));
  });
  const capture = new FileCapture();
  await capture.capture(plan(root));
  expect(capture.files.some((file) => file.content === "Stable file\n")).toBe(true);
  expect(capture.issues).toContainEqual(
    expect.objectContaining({
      status: "unstable",
      reason: "Directory changed during capture; scan again",
    }),
  );
});

it("commits the Mac delta baseline with the registry even when the compatibility marker write fails", async () => {
  const directory = join(root, "config"),
    preferences = join(root, "mac.json");
  await writeFile(
    preferences,
    JSON.stringify({ sources: [join(root, "first")], projects: [], bindings: [] }),
  );
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (String(to).endsWith("workspace.macos-last.json")) throw new Error("marker unavailable");
    return actual.rename(from, to);
  });
  await expect(syncWorkspace(directory, preferences)).rejects.toThrow("marker unavailable");
  const first = await readRegistry(directory);
  expect(first.sources).toHaveLength(1);
  await editRegistry(directory, (registry) => {
    registry.sources = [];
    addSource(registry, join(root, "cli-added"));
  });
  vi.mocked(rename).mockImplementation(actual.rename);
  const retried = await syncWorkspace(directory, preferences);
  expect(retried.sources.map((source) => source.path)).toEqual([join(root, "cli-added")]);
  expect(
    JSON.parse(await readFile(join(directory, "workspace.macos-last.json"), "utf8")).sources,
  ).toEqual([join(root, "first")]);
});
