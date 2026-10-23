import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  LayerCard,
} from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { CodeBlock } from "@nocoo/basalt/components/code";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
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
    <div className="space-y-basalt-layout-lg">
      <PageHeader
        title="Compare snapshots"
        description="Comparing saved content, permissions, links and environment lists. Different machine or profile customizations do not imply a synchronization error."
      />
      {before.error || after.error ? (
        <LayerCard role="alert">
          <LayerCard.Empty title="Could not load both snapshots." />
        </LayerCard>
      ) : !result ? (
        <LayerCard role="status">
          <LayerCard.Empty title="Choose two snapshots from the snapshot list." />
        </LayerCard>
      ) : (
        <>
          <LayerCard className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-basalt-muted-foreground">
              {before.data?.data.createdAt} → {after.data?.data.createdAt}
            </p>
            <Badge variant="secondary">
              {result.files.length} file changes · {result.environment.length} environment changes
            </Badge>
          </LayerCard>
          {result.incomplete && (
            <Banner
              variant="alert"
              description={
                <>
                  {result.scopeChanged
                    ? "The capture scopes differ."
                    : "The later scan is incomplete."}{" "}
                  Missing entries are unknown; removals are not asserted.
                </>
              }
            />
          )}
          <SectionRule title="File changes">
            <div className="space-y-3">
              {result.files.map((change) => (
                <LayerCard key={change.path}>
                  <Collapsible>
                    <LayerCard.Header>
                      <CollapsibleTrigger className="w-full text-left">
                        <span className="text-sm font-medium">
                          {change.change} · <code className="break-all text-xs">{change.path}</code>
                        </span>
                      </CollapsibleTrigger>
                    </LayerCard.Header>
                    <CollapsibleContent unstyled>
                      <LayerCard.Body>
                        <p className="text-xs text-basalt-muted-foreground">
                          Mode {change.before?.mode?.toString(8) ?? "–"} →{" "}
                          {change.after?.mode?.toString(8) ?? "–"} · Link{" "}
                          {change.before?.linkTarget ?? "–"} → {change.after?.linkTarget ?? "–"}
                        </p>
                      </LayerCard.Body>
                      <LayerCard.Well className="grid gap-4 md:grid-cols-2">
                        {[
                          { file: change.before, label: "Before" },
                          { file: change.after, label: "After" },
                        ].map(({ file, label }) => (
                          <div key={label} className="min-w-0">
                            <p className="mb-2 text-xs font-medium">{label}</p>
                            <CodeBlock className="max-h-80 whitespace-pre-wrap break-words">
                              {file?.encoding === "base64"
                                ? `Binary: ${file.sizeBytes} bytes · ${file.sha256}`
                                : (file?.content?.slice(0, 256000) ?? "Content not present")}
                            </CodeBlock>
                          </div>
                        ))}
                      </LayerCard.Well>
                    </CollapsibleContent>
                  </Collapsible>
                </LayerCard>
              ))}
            </div>
          </SectionRule>
          <SectionRule title="Environment changes">
            <div className="space-y-3">
              {result.environment.map((change) => (
                <LayerCard key={change.collector}>
                  <Collapsible>
                    <LayerCard.Header>
                      <CollapsibleTrigger className="w-full text-left">
                        {change.collector} · environment changed
                      </CollapsibleTrigger>
                    </LayerCard.Header>
                    <CollapsibleContent unstyled>
                      <LayerCard.Well className="grid gap-4 md:grid-cols-2">
                        <CodeBlock className="max-h-80">{change.before}</CodeBlock>
                        <CodeBlock className="max-h-80">{change.after}</CodeBlock>
                      </LayerCard.Well>
                    </CollapsibleContent>
                  </Collapsible>
                </LayerCard>
              ))}
            </div>
          </SectionRule>
        </>
      )}
    </div>
  );
}
