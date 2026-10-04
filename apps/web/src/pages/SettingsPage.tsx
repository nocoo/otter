import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  LayerCard,
  Switch,
} from "@nocoo/basalt";
import { Code } from "@nocoo/basalt/components/code";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { Check, Copy, Plus, Shield, Trash2, Webhook } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { apiFetch, useApi } from "@/api";
import { ingestBase, setEnvironmentDraft } from "@/lib/environment";
import { formatDate, formatDateTime } from "@/lib/utils";
import { type WebhookResponse, webhookView } from "@/lib/webhooks";

interface WebhookToken {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Copy strokeWidth={1.5} aria-hidden="true" />
      )}
    </Button>
  );
}

export function SettingsPage() {
  const { data: me } = useApi<{ email: string }>("/api/me");
  const { data, error, isLoading, mutate } = useApi<{ webhooks: WebhookResponse[] }>(
    "/api/webhooks",
  );
  const [newLabel, setNewLabel] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const labelId = useId();
  useEffect(() => {
    setEnvironmentDraft(newLabel.length > 0);
    return () => setEnvironmentDraft(false);
  }, [newLabel]);
  const webhooks = (data?.webhooks ?? []).map(webhookView);
  const toggle = async (webhook: WebhookToken) => {
    setTogglingId(webhook.id);
    setActionError("");
    try {
      await apiFetch(`/api/webhooks/${webhook.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !webhook.isActive }),
      });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not update token");
    } finally {
      setTogglingId(null);
    }
  };
  const remove = async (id: string) => {
    setDeletingId(id);
    setActionError("");
    try {
      await apiFetch(`/api/webhooks/${id}`, { method: "DELETE" });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not delete token");
    } finally {
      setDeletingId(null);
    }
  };
  const create = async () => {
    if (!newLabel.trim() || creating) return;
    setCreating(true);
    setActionError("");
    try {
      await apiFetch("/api/webhooks", {
        method: "POST",
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      await mutate();
      setNewLabel("");
      setDialogOpen(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not create token");
    } finally {
      setCreating(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your account and webhook tokens" />
      <SectionRule title="Account">
        <LayerCard>
          <LayerCard.Body className="flex flex-wrap items-center gap-3">
            <Avatar>
              <AvatarFallback>{me?.email?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
            </Avatar>
            <p className="min-w-0 flex-1 break-all text-sm font-medium">{me?.email || "—"}</p>
            <Badge variant="secondary">
              <Shield className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              Cloudflare Access
            </Badge>
          </LayerCard.Body>
        </LayerCard>
      </SectionRule>
      <SectionRule
        title="Webhook Tokens"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus strokeWidth={1.5} aria-hidden="true" />
                New Token
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Webhook Token</DialogTitle>
                <DialogDescription>A friendly name to identify this token.</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor={labelId}>Label</Label>
                  <Input
                    id={labelId}
                    placeholder="e.g. dev-macbook, ci-pipeline"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </div>
                {actionError && (
                  <p role="alert" className="text-sm text-basalt-destructive">
                    {actionError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={creating} disabled={!newLabel.trim()}>
                    {creating ? "Creating..." : "Create"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      >
        <p className="mb-4 text-sm text-basalt-muted-foreground">
          Use webhook tokens to authenticate CLI uploads. Configure in your CLI with:{" "}
          <Code>otter config set webhook.url &lt;url&gt;</Code>
        </p>
        {actionError && !dialogOpen && (
          <p role="alert" className="mb-3 text-sm text-basalt-destructive">
            {actionError}
          </p>
        )}
        {isLoading ? (
          <LayerCard.Loading label="Loading webhook tokens…" />
        ) : error ? (
          <LayerCard role="alert">
            <LayerCard.Empty
              title="Failed to load webhooks"
              description={error instanceof Error ? error.message : "Request failed"}
              action={
                <Button variant="outline" onClick={() => void mutate()}>
                  Retry
                </Button>
              }
            />
          </LayerCard>
        ) : webhooks.length === 0 ? (
          <LayerCard>
            <LayerCard.Empty
              icon={<Webhook strokeWidth={1.5} />}
              title="No webhook tokens yet"
              description="Create a token to start receiving backups from the CLI"
            />
          </LayerCard>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {webhooks.map((webhook) => {
              const url = new URL(`${ingestBase()}/ingest/${webhook.token}`, window.location.origin)
                .href;
              return (
                <LayerCard key={webhook.id}>
                  <LayerCard.Header className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate text-sm font-medium">{webhook.label}</h3>
                      <Badge variant={webhook.isActive ? "success" : "secondary"}>
                        {webhook.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={webhook.isActive}
                        onCheckedChange={() => void toggle(webhook)}
                        disabled={togglingId === webhook.id}
                        aria-label={`Toggle ${webhook.label}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deletingId === webhook.id}
                        onClick={() => void remove(webhook.id)}
                        aria-label={`Delete ${webhook.label}`}
                      >
                        <Trash2 strokeWidth={1.5} aria-hidden="true" />
                      </Button>
                    </div>
                  </LayerCard.Header>
                  <LayerCard.Well className="flex min-w-0 items-center gap-2">
                    <code className="min-w-0 flex-1 break-all text-xs">{url}</code>
                    <CopyButton text={url} />
                  </LayerCard.Well>
                  <LayerCard.Footer className="flex flex-wrap gap-3 text-xs text-basalt-muted-foreground">
                    <span>Created {formatDate(webhook.createdAt)}</span>
                    {webhook.lastUsedAt && (
                      <span>Last used {formatDateTime(webhook.lastUsedAt)}</span>
                    )}
                  </LayerCard.Footer>
                </LayerCard>
              );
            })}
          </div>
        )}
      </SectionRule>
      <SectionRule title="Danger Zone">
        <LayerCard>
          <LayerCard.Body className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Delete all snapshots</h3>
              <p className="mt-1 text-xs text-basalt-muted-foreground">
                Permanently remove all stored backups. This cannot be undone.
              </p>
            </div>
            <Button variant="destructive" size="sm" disabled>
              Delete All
            </Button>
          </LayerCard.Body>
        </LayerCard>
      </SectionRule>
    </div>
  );
}
