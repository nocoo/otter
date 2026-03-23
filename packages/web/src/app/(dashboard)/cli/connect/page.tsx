"use client";

import { Check, ExternalLink, Loader2, ShieldAlert, Terminal, Webhook } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebhookToken {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that the callback URL is a safe localhost origin.
 * Only allows http://localhost:{port} or http://127.0.0.1:{port}.
 */
function isValidCallback(callback: string): boolean {
  try {
    const url = new URL(callback);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const isHttp = url.protocol === "http:";
    return isLocalhost && isHttp;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CliConnectPage() {
  const searchParams = useSearchParams();
  const callback = searchParams.get("callback");

  const [webhooks, setWebhooks] = useState<WebhookToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://otter.hexly.ai";

  // Validate callback
  const callbackValid = callback ? isValidCallback(callback) : false;

  // Fetch webhooks
  const fetchWebhooks = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to load webhooks (${res.status})`);
      }
      const data = await res.json();
      setWebhooks(data.webhooks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (callbackValid) {
      void fetchWebhooks();
    } else {
      setLoading(false);
    }
  }, [callbackValid, fetchWebhooks]);

  // Handle connect: redirect to CLI's local server with token only
  const handleConnect = (webhook: WebhookToken) => {
    if (!callback) return;
    setConnectingId(webhook.id);

    const redirectUrl = `${callback}/callback?token=${encodeURIComponent(webhook.token)}`;
    window.location.href = redirectUrl;
  };

  // No callback param
  if (!callback) {
    return (
      <div className="max-w-2xl space-y-6">
        <Header />
        <ErrorCard
          icon={<Terminal className="h-8 w-8 text-muted-foreground/40" />}
          title="No callback URL"
          description="This page should be opened from the CLI. Run:"
          code="otter login"
        />
      </div>
    );
  }

  // Invalid callback
  if (!callbackValid) {
    return (
      <div className="max-w-2xl space-y-6">
        <Header />
        <ErrorCard
          icon={<ShieldAlert className="h-8 w-8 text-destructive/60" />}
          title="Invalid callback URL"
          description="For security, only localhost callbacks are allowed. The callback URL must start with http://localhost or http://127.0.0.1."
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Header />

      <div className="rounded-xl bg-secondary p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>
            Connecting to{" "}
            <code className="bg-background/50 px-1.5 py-0.5 rounded text-[11px]">{callback}</code>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl bg-secondary p-8 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground/40 mx-auto animate-spin" />
          <p className="mt-3 text-sm text-muted-foreground">Loading webhooks...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl bg-secondary p-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setLoading(true);
              void fetchWebhooks();
            }}
          >
            Retry
          </Button>
        </div>
      ) : webhooks.length === 0 ? (
        <div className="rounded-xl bg-secondary p-8 text-center space-y-3">
          <Webhook className="h-8 w-8 text-muted-foreground/40 mx-auto" strokeWidth={1.5} />
          <div>
            <p className="text-sm text-muted-foreground">No webhook tokens yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Create a webhook token in Settings first, then come back here.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <a href="/settings">
              Go to Settings
              <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
            </a>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Select a webhook token to connect your CLI:
          </p>
          {webhooks
            .filter((wh) => wh.isActive)
            .map((wh) => (
              <WebhookConnectRow
                key={wh.id}
                webhook={wh}
                baseUrl={baseUrl}
                onConnect={handleConnect}
                isConnecting={connectingId === wh.id}
              />
            ))}
          {webhooks.filter((wh) => wh.isActive).length === 0 && (
            <div className="rounded-xl bg-secondary p-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">All your webhook tokens are inactive.</p>
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <a href="/settings">
                  Manage in Settings
                  <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                </a>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Connect CLI</h1>
      <p className="text-sm text-muted-foreground">Link your Otter CLI to this dashboard</p>
    </div>
  );
}

function ErrorCard({
  icon,
  title,
  description,
  code,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  code?: string;
}) {
  return (
    <div className="rounded-xl bg-secondary p-8 text-center space-y-3">
      {icon}
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {code && (
        <code className="block text-sm bg-background/50 px-4 py-2 rounded-lg text-foreground">
          {code}
        </code>
      )}
    </div>
  );
}

function WebhookConnectRow({
  webhook,
  baseUrl,
  onConnect,
  isConnecting,
}: {
  webhook: WebhookToken;
  baseUrl: string;
  onConnect: (webhook: WebhookToken) => void;
  isConnecting: boolean;
}) {
  const fullUrl = `${baseUrl}/api/webhook/${webhook.token}`;
  const maskedToken = `${webhook.token.slice(0, 8)}...${webhook.token.slice(-4)}`;

  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Webhook className="h-4 w-4 text-primary" strokeWidth={1.5} />
          <span className="font-medium text-sm">{webhook.label}</span>
          <Badge variant="default" className="text-[10px] font-normal">
            Active
          </Badge>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => onConnect(webhook)}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              Connect
            </>
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-background/50 px-3 py-2">
        <code className="flex-1 text-xs font-mono text-muted-foreground truncate">
          {maskedToken}
        </code>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Webhook URL: <span className="font-mono">{fullUrl.slice(0, 50)}...</span>
      </div>
    </div>
  );
}
