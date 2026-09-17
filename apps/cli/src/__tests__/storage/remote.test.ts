import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Snapshot } from "@otter/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkspaceCommand } from "../../commands/workspace.js";
import { backupTimeline } from "../../commands/workspace-state.js";
import { SnapshotStore } from "../../storage/local.js";
import { RemoteStore, snapshotHash } from "../../storage/remote.js";

let directory: string, snapshot: Snapshot, store: SnapshotStore, remote: RemoteStore;
const api = "https://fixture.invalid",
  token = "otk_local_fixture";
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "otter-receipt-"));
  snapshot = JSON.parse(await readFile(resolve("scripts/fixtures/snapshot-v2.json"), "utf8"));
  store = new SnapshotStore(join(directory, "snapshots"));
  remote = new RemoteStore(directory, api, token);
  await store.save(snapshot);
  await writeFile(join(directory, "config.json"), JSON.stringify({ token }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
const receipt = () => ({
  snapshotId: snapshot.id,
  sha256: snapshotHash(snapshot),
  account: "fixture@example.com",
  receivedAt: "2026-09-17T00:00:00.000Z",
});
const stubServer = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${token}`);
      if (options?.method === "POST") return reply({ receipt: receipt() }, 201);
      if (url.includes("?"))
        return reply({ snapshots: [{ id: snapshot.id }, { id: "remote-only" }], nextCursor: null });
      return reply({ data: snapshot, receipt: receipt() });
    }),
  );
async function call(args: string[]) {
  let output = "";
  const code = await runWorkspaceCommand(
    [...args, "--json", "--config-dir", directory, "--api-url", api],
    "3.0.0",
    {
      stdout: (s) => {
        output += s;
      },
      stderr: () => undefined,
    },
  );
  return { code, data: JSON.parse(output) };
}

describe("durable remote backup records", () => {
  it("persists verified receipts, merges local/cloud versions and exports a downloaded snapshot", async () => {
    stubServer();
    expect(await remote.read(snapshot.id)).toBeNull();
    expect((await remote.upload(snapshot)).receipt).toEqual(receipt());
    expect((await new RemoteStore(directory, api, token).read(snapshot.id))?.state).toBe(
      "confirmed",
    );
    expect(
      await new RemoteStore(directory, api, "another-account-token").read(snapshot.id),
    ).toBeNull();
    expect(await remote.verify(snapshot)).toEqual(receipt());
    const otherStore = new SnapshotStore(join(directory, "downloaded"));
    expect(await remote.download(snapshot.id, otherStore)).toEqual(snapshot);
    expect(await otherStore.load(snapshot.id)).toEqual(snapshot);
    const timeline = await backupTimeline(store, directory, api, token);
    expect(timeline["snapshots"]).toMatchObject([
      { location: "local-and-remote", uploadState: "confirmed" },
      { location: "remote", uploadState: "remote-only" },
    ]);
    expect((await call(["snapshot", "timeline"])).code).toBe(0);
    expect((await call(["snapshot", "verify", snapshot.id])).data).toEqual(receipt());
    expect((await call(["snapshot", "download", snapshot.id])).code).toBe(0);
    expect(
      (await call(["snapshot", "export", snapshot.id, "--destination", join(directory, "export")]))
        .code,
    ).toBe(0);
    expect((await call(["snapshot", "export", snapshot.id])).code).toBe(1);
    expect((await call(["backup", "--snapshot", snapshot.id])).data.receipt).toEqual(receipt());
  });
  it("records uncertain acceptance after network failures or a missing/incorrect receipt, retaining the exact local snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({})),
    );
    expect((await remote.upload(snapshot)).success).toBe(false);
    expect((await remote.read(snapshot.id))?.state).toBe("unconfirmed");
    expect(await store.load(snapshot.id)).toEqual(snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection lost");
      }),
    );
    expect((await remote.upload(snapshot)).success).toBe(false);
    const timeline = await backupTimeline(store, directory, api, token);
    expect(timeline["remoteError"]).toContain("connection lost");
    expect(timeline["snapshots"]).toMatchObject([
      { location: "local", uploadState: "unconfirmed" },
    ]);
    expect((await backupTimeline(store, directory, api))["snapshots"]).toMatchObject([
      { uploadState: "not-authenticated" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ data: snapshot, receipt: { ...receipt(), sha256: "wrong" } })),
    );
    await expect(remote.verify(snapshot)).rejects.toThrow("does not match");
    await expect(remote.download(snapshot.id, store)).rejects.toThrow("mismatch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({}, 503)),
    );
    await expect(remote.verify(snapshot)).rejects.toThrow("503");
    await expect(remote.download(snapshot.id, store)).rejects.toThrow("503");
    await expect(remote.list()).rejects.toThrow("503");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ data: { ...snapshot, id: "wrong-id" } })),
    );
    await expect(remote.download(snapshot.id, store)).rejects.toThrow("Invalid");
  });
  it("walks all remote pages, rejects looping pagination, and supports legacy downloads without verified receipts", async () => {
    const responses = [
      reply({ snapshots: [{ id: "1" }], nextCursor: "cursor1" }),
      reply({ snapshots: [{ id: "2" }], nextCursor: null }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift()),
    );
    expect(await remote.list()).toEqual([{ id: "1" }, { id: "2" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ snapshots: [], nextCursor: "repeat" })),
    );
    await expect(remote.list()).rejects.toThrow("did not advance");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ snapshots: "invalid" })),
    );
    await expect(remote.list()).rejects.toThrow("Invalid remote");
    const legacy = { ...snapshot, id: "legacy", version: 1 as const };
    delete legacy.workspace;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ data: legacy })),
    );
    expect((await remote.download("legacy", store)).version).toBe(1);
    await rm(join(directory, "config.json"));
    expect((await call(["snapshot", "verify", snapshot.id])).code).toBe(1);
    expect((await call(["snapshot", "download", snapshot.id])).code).toBe(1);
  });

  it("distinguishes unverified matches, interrupted uploads and remotely deleted versions", async () => {
    stubServer();
    expect((await backupTimeline(store, directory, api, token)).snapshots).toMatchObject([
      { uploadState: "unverified" },
      { uploadState: "remote-only" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ snapshots: [], nextCursor: null })),
    );
    expect((await backupTimeline(store, directory, api, token)).snapshots).toMatchObject([
      { uploadState: "not-uploaded" },
    ]);
    stubServer();
    await remote.upload(snapshot);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ snapshots: [], nextCursor: null })),
    );
    expect((await backupTimeline(store, directory, api, token)).snapshots).toMatchObject([
      { uploadState: "missing-remote" },
    ]);
    const receiptFile = join(
      directory,
      "receipts",
      String((await readdir(join(directory, "receipts")))[0]),
    );
    const record = JSON.parse(await readFile(receiptFile, "utf8"));
    record.state = "pending";
    await writeFile(receiptFile, JSON.stringify(record));
    expect((await backupTimeline(store, directory, api, token)).snapshots).toMatchObject([
      { uploadState: "unconfirmed" },
    ]);
    await writeFile(receiptFile, "corrupt");
    await expect(remote.read(snapshot.id)).rejects.toThrow();
    expect(await store.load(snapshot.id)).toEqual(snapshot);
  });

  it("requires a complete v2 receipt and detects cycles across multiple remote cursors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ data: snapshot })),
    );
    await expect(remote.download(snapshot.id, store)).rejects.toThrow("mismatch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ data: snapshot, receipt: { ...receipt(), account: "" } })),
    );
    await expect(remote.verify(snapshot)).rejects.toThrow("does not match");
    await expect(remote.download(snapshot.id, store)).rejects.toThrow("mismatch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ data: snapshot, receipt: { ...receipt(), snapshotId: "other-id" } }),
      ),
    );
    await expect(remote.download(snapshot.id, store)).rejects.toThrow("mismatch");
    const cursors = ["first", "second", "first"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply({ snapshots: [], nextCursor: cursors.shift() })),
    );
    await expect(remote.list()).rejects.toThrow("did not advance");
  });
});
