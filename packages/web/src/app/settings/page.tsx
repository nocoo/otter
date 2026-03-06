"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  Webhook,
  Plus,
  Copy,
  Trash2,
  Check,
  User,
  Mail,
  Shield,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// ---------------------------------------------------------------------------
// Static placeholder data (Phase 1 — will be replaced by API calls)
// ---------------------------------------------------------------------------

interface WebhookToken {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const initialWebhooks: WebhookToken[] = [
  {
    id: "wh-001",
    token: "ott_k7x9m2p4q8r1s5t3v6w0y",
    label: "dev-macbook",
    isActive: true,
    createdAt: "2026-02-15",
    lastUsedAt: "2026-03-06 11:30",
  },
  {
    id: "wh-002",
    token: "ott_a1b2c3d4e5f6g7h8i9j0k",
    label: "ci-pipeline",
    isActive: false,
    createdAt: "2026-01-20",
    lastUsedAt: "2026-02-10 09:00",
  },
];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" strokeWidth={1.5} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
    </button>
  );
}

function WebhookRow({
  webhook,
  baseUrl,
  onToggle,
  onDelete,
}: {
  webhook: WebhookToken;
  baseUrl: string;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const fullUrl = `${baseUrl}/api/webhook/${webhook.token}`;

  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Webhook className="h-4 w-4 text-primary" strokeWidth={1.5} />
          <span className="font-medium text-sm">{webhook.label}</span>
          <Badge
            variant={webhook.isActive ? "default" : "secondary"}
            className="text-[10px] font-normal"
          >
            {webhook.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={webhook.isActive}
            onCheckedChange={() => onToggle(webhook.id)}
            aria-label={`Toggle ${webhook.label}`}
          />
          <button
            onClick={() => onDelete(webhook.id)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label={`Delete ${webhook.label}`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Webhook URL */}
      <div className="flex items-center gap-2 rounded-lg bg-background/50 px-3 py-2">
        <code className="flex-1 text-xs font-mono text-muted-foreground truncate">{fullUrl}</code>
        <CopyButton text={fullUrl} />
      </div>

      {/* Meta */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span>Created {webhook.createdAt}</span>
        {webhook.lastUsedAt && <span>Last used {webhook.lastUsedAt}</span>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [webhooks, setWebhooks] = useState(initialWebhooks);
  const [newLabel, setNewLabel] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://otter.example.com";

  const handleToggle = (id: string) => {
    setWebhooks((prev) =>
      prev.map((wh) =>
        wh.id === id ? { ...wh, isActive: !wh.isActive } : wh
      )
    );
  };

  const handleDelete = (id: string) => {
    setWebhooks((prev) => prev.filter((wh) => wh.id !== id));
  };

  const handleCreate = () => {
    if (!newLabel.trim()) return;
    const token = `ott_${Array.from({ length: 22 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")}`;
    const newWebhook: WebhookToken = {
      id: `wh-${Date.now()}`,
      token,
      label: newLabel.trim(),
      isActive: true,
      createdAt: new Date().toISOString().slice(0, 10),
      lastUsedAt: null,
    };
    setWebhooks((prev) => [newWebhook, ...prev]);
    setNewLabel("");
    setDialogOpen(false);
  };

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image;
  const userInitial = userName[0] ?? "?";

  return (
    <AppShell breadcrumbs={[{ label: "Settings" }]}>
      <div className="max-w-3xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your account and webhook tokens
          </p>
        </div>

        {/* Account Section */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <User className="h-4 w-4" strokeWidth={1.5} />
            Account
          </h2>
          <div className="rounded-xl bg-secondary p-5">
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14">
                {userImage && <AvatarImage src={userImage} alt={userName} />}
                <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                  {userInitial}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-medium text-foreground">{userName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Mail className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">{userEmail}</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <Shield className="h-3 w-3" strokeWidth={1.5} />
                Google OAuth
              </Badge>
            </div>
          </div>
        </section>

        <Separator />

        {/* Webhooks Section */}
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
                    <Button onClick={handleCreate} disabled={!newLabel.trim()}>
                      Create
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <p className="text-xs text-muted-foreground">
            Use webhook tokens to authenticate CLI uploads. Configure in your CLI
            with: <code className="text-[11px] bg-background/50 px-1.5 py-0.5 rounded">otter config set webhook.url &lt;url&gt;</code>
          </p>

          {webhooks.length === 0 ? (
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
                />
              ))}
            </div>
          )}
        </section>

        <Separator />

        {/* Danger Zone */}
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
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" disabled>
                Delete All
              </Button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
