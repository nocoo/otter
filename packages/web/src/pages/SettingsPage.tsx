import { Check, Copy, Loader2, Mail, Plus, Shield, Trash2, User, Webhook } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { apiFetch, useApi } from "@/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/utils";

interface WebhookToken {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

interface WebhooksResponse {
  webhooks: WebhookToken[];
}

interface MeResponse {
  email: string;
  sub?: string;
}

function formatDateTimeShort(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex h-7 w-7 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}

interface WebhookRowProps {
  webhook: WebhookToken;
  baseUrl: string;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  isToggling: boolean;
  isDeleting: boolean;
}

function WebhookRow({
  webhook,
  baseUrl,
  onToggle,
  onDelete,
  isToggling,
  isDeleting,
}: WebhookRowProps) {
  const fullUrl = `${baseUrl}/api/webhook/${webhook.token}`;

  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Webhook className="h-4 w-4 text-primary" strokeWidth={1.5} />
          <span className="font-medium text-sm">{webhook.label}</span>
          <Badge
            variant={webhook.isActive ? "success" : "secondary"}
            className="text-2xs font-normal"
          >
            {webhook.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={webhook.isActive}
            onCheckedChange={() => onToggle(webhook.id)}
            disabled={isToggling}
            aria-label={`Toggle ${webhook.label}`}
          />
          <button
            type="button"
            onClick={() => onDelete(webhook.id)}
            disabled={isDeleting}
            className="flex h-7 w-7 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors disabled:opacity-50"
            aria-label={`Delete ${webhook.label}`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-background/50 px-3 py-2">
        <code className="flex-1 text-xs font-mono text-muted-foreground truncate">{fullUrl}</code>
        <CopyButton text={fullUrl} />
      </div>

      <div className="flex items-center gap-4 text-2xs text-muted-foreground">
        <span>Created {formatDate(webhook.createdAt)}</span>
        {webhook.lastUsedAt && <span>Last used {formatDateTimeShort(webhook.lastUsedAt)}</span>}
      </div>
    </div>
  );
}

function WebhooksSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cards are static, never reorder
        <div key={`webhook-skeleton-${i}`} className="rounded-xl bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-9 rounded-full" />
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
          </div>
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: settings page with multiple sections
export function SettingsPage() {
  const { data: me } = useSWR<MeResponse>("/api/me", (k: string) => apiFetch<MeResponse>(k));
  const { data, error, isLoading, mutate } = useApi<WebhooksResponse>("/api/webhooks");

  const [newLabel, setNewLabel] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://otter.hexly.ai";
  const webhooks = data?.webhooks ?? [];

  const handleToggle = async (id: string) => {
    const webhook = webhooks.find((wh) => wh.id === id);
    if (!webhook) return;
    setTogglingId(id);
    try {
      await apiFetch(`/api/webhooks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !webhook.isActive }),
      });
      await mutate();
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await apiFetch(`/api/webhooks/${id}`, { method: "DELETE" });
      await mutate();
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      await apiFetch("/api/webhooks", {
        method: "POST",
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      await mutate();
      setNewLabel("");
      setDialogOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const userEmail = me?.email ?? "";
  const userInitial = userEmail[0]?.toUpperCase() ?? "?";

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and webhook tokens</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
          <User className="h-4 w-4" strokeWidth={1.5} />
          Account
        </h2>
        <div className="rounded-xl bg-secondary p-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                {userInitial}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-medium text-foreground">{userEmail || "—"}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Mail className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">{userEmail}</p>
              </div>
            </div>
            <Badge variant="secondary" className="text-xs flex items-center gap-1">
              <Shield className="h-3 w-3" strokeWidth={1.5} />
              Cloudflare Access
            </Badge>
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Webhook className="h-4 w-4" strokeWidth={1.5} />
            Webhook Tokens
          </h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                New Token
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Webhook Token</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="webhook-label">Label</Label>
                  {/* biome-ignore lint/correctness/useUniqueElementIds: single dialog instance, no duplicate IDs */}
                  <Input
                    id="webhook-label"
                    placeholder="e.g. dev-macbook, ci-pipeline"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                  <p className="text-xs text-muted-foreground">
                    A friendly name to identify this token.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={!newLabel.trim() || creating}>
                    {creating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        Creating...
                      </>
                    ) : (
                      "Create"
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <p className="text-xs text-muted-foreground">
          Use webhook tokens to authenticate CLI uploads. Configure in your CLI with:{" "}
          <code className="text-xs bg-background/50 px-1.5 py-0.5 rounded">
            otter config set webhook.url &lt;url&gt;
          </code>
        </p>

        {isLoading ? (
          <WebhooksSkeleton />
        ) : error ? (
          <div className="rounded-xl bg-secondary p-8 text-center">
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Failed to load webhooks"}
            </p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => mutate()}>
              Retry
            </Button>
          </div>
        ) : webhooks.length === 0 ? (
          <div className="rounded-xl bg-secondary p-8 text-center">
            <Webhook className="h-8 w-8 text-muted-foreground/40 mx-auto" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-muted-foreground">No webhook tokens yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Create a token to start receiving backups from the CLI
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map((wh) => (
              <WebhookRow
                key={wh.id}
                webhook={wh}
                baseUrl={baseUrl}
                onToggle={handleToggle}
                onDelete={handleDelete}
                isToggling={togglingId === wh.id}
                isDeleting={deletingId === wh.id}
              />
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-destructive">Danger Zone</h2>
        <div className="rounded-xl border border-destructive/20 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Delete all snapshots</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently remove all stored backups. This cannot be undone.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled
            >
              Delete All
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
