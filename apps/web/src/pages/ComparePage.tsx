import { useSearchParams } from "react-router";
import { useApi } from "@/api";
import type { SnapshotData } from "@/components/snapshot/types";
import { compareRecovery } from "@/lib/recovery";

export function ComparePage() {
  const [params] = useSearchParams();
  const before = useApi<{ data: SnapshotData }>(
    params.get("before")
      ? `/api/snapshots/${encodeURIComponent(params.get("before") ?? "")}`
      : null,
  );
  const after = useApi<{ data: SnapshotData }>(
    params.get("after") ? `/api/snapshots/${encodeURIComponent(params.get("after") ?? "")}` : null,
  );
  const result =
    before.data && after.data ? compareRecovery(before.data.data, after.data.data) : null;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Compare snapshots</h1>
      <p className="text-sm text-muted-foreground">
        Comparing saved content, permissions, links and environment lists. Different machine or
        profile customizations do not imply a synchronization error.
      </p>
      {before.error || after.error ? (
        <p role="alert">Could not load both snapshots.</p>
      ) : !result ? (
        <p role="status">Choose two snapshots from the snapshot list.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {before.data?.data.createdAt} → {after.data?.data.createdAt}
          </p>
          {result.incomplete && (
            <p className="rounded-lg border border-border p-4">
              {result.scopeChanged ? "The capture scopes differ." : "The later scan is incomplete."}{" "}
              Missing entries are unknown; removals are not asserted.
            </p>
          )}
          <p className="font-medium">
            {result.files.length} file changes · {result.environment.length} environment changes
          </p>
          {result.files.map((change) => (
            <details key={change.path} className="rounded-xl bg-secondary p-4">
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{change.change}</span> ·{" "}
                <code className="break-all">{change.path}</code>
              </summary>
              <p className="text-xs text-muted-foreground my-3">
                Mode {change.before?.mode?.toString(8) ?? "–"} →{" "}
                {change.after?.mode?.toString(8) ?? "–"} · Link {change.before?.linkTarget ?? "–"} →{" "}
                {change.after?.linkTarget ?? "–"}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {[change.before, change.after].map((file, i) => (
                  <pre
                    key={i === 0 ? "before" : "after"}
                    className="text-xs rounded-lg bg-background p-3 overflow-auto max-h-80 whitespace-pre-wrap break-words"
                  >
                    {file?.encoding === "base64"
                      ? `Binary: ${file.sizeBytes} bytes · ${file.sha256}`
                      : (file?.content?.slice(0, 256000) ?? "Content not present")}
                  </pre>
                ))}
              </div>
            </details>
          ))}
          {result.environment.map((change) => (
            <details key={change.collector} className="rounded-xl bg-secondary p-4">
              <summary className="cursor-pointer text-sm">
                {change.collector} · environment changed
              </summary>
              <div className="grid gap-3 md:grid-cols-2 mt-3">
                <pre className="overflow-auto text-xs max-h-80">{change.before}</pre>
                <pre className="overflow-auto text-xs max-h-80">{change.after}</pre>
              </div>
            </details>
          ))}
        </>
      )}
    </div>
  );
}
