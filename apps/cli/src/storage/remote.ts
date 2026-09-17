import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RemoteReceipt, Snapshot, UploadResult } from "@otter/core";
import { uploadSnapshot } from "../uploader/webhook.js";
import { digest } from "../workspace/files.js";
import { writePrivate } from "../workspace/registry.js";
import type { SnapshotStore } from "./local.js";

export interface UploadRecord {
  snapshotId: string;
  apiUrl: string;
  /** Token fingerprint distinguishes accounts without persisting a credential. */
  credentialId: string;
  sha256: string;
  state: "pending" | "unconfirmed" | "confirmed";
  updatedAt: string;
  receipt?: RemoteReceipt;
}
export const snapshotHash = (snapshot: Snapshot): string => digest(JSON.stringify(snapshot));
export const credentialId = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export class RemoteStore {
  constructor(
    private readonly directory: string,
    readonly apiUrl: string,
    private readonly token: string,
  ) {}
  private path(id: string): string {
    return join(
      this.directory,
      "receipts",
      `${digest(`${this.apiUrl}\0${credentialId(this.token)}\0${id}`)}.json`,
    );
  }
  async read(id: string): Promise<UploadRecord | null> {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8")) as UploadRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  private async save(
    snapshot: Snapshot,
    state: UploadRecord["state"],
    receipt?: RemoteReceipt,
  ): Promise<void> {
    await mkdir(join(this.directory, "receipts"), { recursive: true, mode: 0o700 });
    await writePrivate(this.path(snapshot.id), {
      snapshotId: snapshot.id,
      apiUrl: this.apiUrl,
      credentialId: credentialId(this.token),
      sha256: snapshotHash(snapshot),
      state,
      updatedAt: new Date().toISOString(),
      ...(receipt ? { receipt } : {}),
    });
  }
  async upload(snapshot: Snapshot): Promise<UploadResult> {
    await this.save(snapshot, "pending");
    const result = await uploadSnapshot(snapshot, {
      url: `${this.apiUrl}/api/snapshots`,
      token: this.token,
    });
    await this.save(
      snapshot,
      result.success && result.receipt ? "confirmed" : "unconfirmed",
      result.receipt,
    );
    return result;
  }
  private request(path: string): Promise<Response> {
    return fetch(`${this.apiUrl}/api/snapshots${path}`, {
      // biome-ignore lint/style/useNamingConvention: HTTP header
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(30_000),
    });
  }
  async verify(snapshot: Snapshot): Promise<RemoteReceipt> {
    const response = await this.request(`/${encodeURIComponent(snapshot.id)}`);
    if (!response.ok) throw new Error(`Remote verification failed (${response.status})`);
    const body = (await response.json()) as { data: Snapshot; receipt?: RemoteReceipt };
    if (
      snapshotHash(body.data) !== snapshotHash(snapshot) ||
      body.receipt?.sha256 !== snapshotHash(snapshot) ||
      body.receipt.snapshotId !== snapshot.id ||
      !body.receipt.account ||
      !body.receipt.receivedAt
    )
      throw new Error("Remote content or receipt does not match the saved snapshot");
    await this.save(snapshot, "confirmed", body.receipt);
    return body.receipt;
  }
  async download(id: string, store: SnapshotStore): Promise<Snapshot> {
    const response = await this.request(`/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Remote download failed (${response.status})`);
    const body = (await response.json()) as { data: Snapshot; receipt?: RemoteReceipt };
    if (
      body.data.id !== id ||
      ![1, 2].includes(body.data.version) ||
      !Array.isArray(body.data.collectors)
    )
      throw new Error("Invalid remote snapshot");
    if (
      (body.data.version === 2 || body.receipt) &&
      (body.receipt?.sha256 !== snapshotHash(body.data) ||
        body.receipt.snapshotId !== id ||
        !body.receipt.account ||
        !body.receipt.receivedAt)
    )
      throw new Error("Remote content digest mismatch");
    await store.save(body.data);
    if (body.receipt) await this.save(body.data, "confirmed", body.receipt);
    return body.data;
  }
  async list(): Promise<Record<string, unknown>[]> {
    const snapshots: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      // biome-ignore lint/performance/noAwaitInLoops: each page depends on the previous cursor
      const response = await this.request(
        `/?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!response.ok) throw new Error(`Remote list failed (${response.status})`);
      const page = (await response.json()) as {
        snapshots: Record<string, unknown>[];
        nextCursor?: string | null;
      };
      if (!Array.isArray(page.snapshots)) throw new Error("Invalid remote snapshot list");
      snapshots.push(...page.snapshots);
      if (page.nextCursor && seen.has(page.nextCursor))
        throw new Error("Remote pagination did not advance");
      if (page.nextCursor) seen.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return snapshots;
  }
}
