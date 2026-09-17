import type { Snapshot } from "@otter/core";
import type { SnapshotStore } from "../storage/local.js";
import { RemoteStore } from "../storage/remote.js";

export async function backupState(
  snapshot: Snapshot,
  store: SnapshotStore,
): Promise<Record<string, unknown>> {
  const workspace = snapshot.workspace;
  if (!workspace) return { state: "unknown", reason: "Legacy capture has no coverage baseline" };
  const metas = (await store.list()).filter((m) => m.deviceId === workspace.deviceId);
  const latest = metas[0] ? await store.load(metas[0].id) : null;
  const baseline = latest?.workspace;
  const state = !workspace.coverage.complete
    ? "unknown"
    : !baseline?.coverage.complete
      ? "needed"
      : baseline.scopeFingerprint !== workspace.scopeFingerprint
        ? "scope-changed"
        : baseline.configurationFingerprint === workspace.configurationFingerprint
          ? "unchanged"
          : "needed";
  return {
    state,
    latestId: latest?.id,
    latestCompleteId: metas.find((m) => m.complete)?.id,
    observedAt: workspace.observedAt,
    compared: "agent configurations and registered sources; environment is compared on full scans",
  };
}

export async function backupTimeline(
  store: SnapshotStore,
  directory: string,
  apiUrl: string,
  token?: string,
): Promise<Record<string, unknown>> {
  const local = await store.list();
  if (!token)
    return {
      snapshots: local.map((m) => ({ ...m, location: "local", uploadState: "not-authenticated" })),
      remoteCheckedAt: null,
    };
  const remote = new RemoteStore(directory, apiUrl, token);
  let cloud: Record<string, unknown>[] = [],
    remoteError: string | undefined;
  try {
    cloud = await remote.list();
  } catch (error) {
    remoteError = (error as Error).message;
  }
  const rows = await Promise.all(
    local.map(async (meta) => {
      const record = await remote.read(meta.id);
      const matched = cloud.find((c) => c.id === meta.id);
      return {
        ...meta,
        location: matched ? "local-and-remote" : "local",
        uploadState:
          record?.state === "pending"
            ? "unconfirmed"
            : record?.state === "confirmed" && !matched && !remoteError
              ? "missing-remote"
              : (record?.state ?? (matched ? "unverified" : "not-uploaded")),
        receipt: record?.receipt,
        remote: matched,
      };
    }),
  );
  return {
    snapshots: [
      ...rows,
      ...cloud
        .filter((c) => !local.some((m) => m.id === c.id))
        .map((c) => ({ ...c, location: "remote", uploadState: "remote-only" })),
    ],
    remoteCheckedAt: remoteError ? null : new Date().toISOString(),
    ...(remoteError ? { remoteError } : {}),
  };
}
