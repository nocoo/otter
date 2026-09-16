import { ExternalLink, ShieldAlert, Terminal } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";

// CLI pairing — Step 2 of the unified protocol.
//
// CLI opens this page with `?callback=http://127.0.0.1:PORT/callback&state=NONCE`.
// On confirmation we full-page-redirect to `/api/auth/cli?callback=…&state=…` so
// the CF Access cookie attaches; the API mints a fresh api_token and 302s back
// to the loopback callback with `?token=…&state=…&email=…`.
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

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Connect CLI</h1>
      <p className="text-sm text-muted-foreground">Link your Otter CLI to this dashboard</p>
    </div>
  );
}

interface ErrorCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  code?: string;
}

function ErrorCard({ icon, title, description, code }: ErrorCardProps) {
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

export function CliConnectPage() {
  const [searchParams] = useSearchParams();
  const callback = searchParams.get("callback");
  const state = searchParams.get("state");
  const callbackValid = !!callback && isValidCallback(callback);
  const [authorizing, setAuthorizing] = useState(false);

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

  if (!callbackValid) {
    return (
      <div className="max-w-2xl space-y-6">
        <Header />
        <ErrorCard
          icon={<ShieldAlert className="h-8 w-8 text-destructive/60" />}
          title="Invalid callback URL"
          description="For security, only loopback callbacks are allowed. The callback URL must start with http://localhost or http://127.0.0.1."
        />
      </div>
    );
  }

  const mintUrl = `/api/auth/cli?callback=${encodeURIComponent(callback)}${
    state ? `&state=${encodeURIComponent(state)}` : ""
  }`;

  const handleAuthorize = () => {
    setAuthorizing(true);
    window.location.href = mintUrl;
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Header />

      <div className="rounded-xl bg-secondary p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>
            Connecting to{" "}
            <code className="bg-background/50 px-1.5 py-0.5 rounded text-xs">{callback}</code>
          </span>
        </div>
      </div>

      <div className="rounded-xl bg-secondary p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Authorize the <code className="bg-background/50 px-1 py-0.5 rounded">otter</code> CLI to
          use this dashboard. A fresh API token will be minted under your account and sent back to{" "}
          <code className="bg-background/50 px-1 py-0.5 rounded">{callback}</code>.
        </p>
        <Button onClick={handleAuthorize} disabled={authorizing} className="gap-1.5">
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          {authorizing ? "Authorizing…" : "Authorize CLI"}
        </Button>
      </div>
    </div>
  );
}
