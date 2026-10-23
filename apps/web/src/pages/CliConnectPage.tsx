import { Button, LayerCard } from "@nocoo/basalt";
import { Code, CodeBlock } from "@nocoo/basalt/components/code";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { ExternalLink, ShieldAlert, Terminal } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { apiPath } from "@/lib/environment";

function isValidCallback(callback: string): boolean {
  try {
    const url = new URL(callback);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:"
    );
  } catch {
    return false;
  }
}
export function CliConnectPage() {
  const [params] = useSearchParams();
  const callback = params.get("callback");
  const state = params.get("state");
  const [authorizing, setAuthorizing] = useState(false);
  const valid = !!callback && isValidCallback(callback);
  return (
    <div className="max-w-2xl space-y-basalt-layout-lg">
      <PageHeader title="Connect CLI" description="Link your Otter CLI to this dashboard" />
      {!callback ? (
        <LayerCard>
          <LayerCard.Empty
            icon={<Terminal strokeWidth={1.5} />}
            title="No callback URL"
            description="This page should be opened from the CLI. Run:"
          >
            <CodeBlock>otter login</CodeBlock>
          </LayerCard.Empty>
        </LayerCard>
      ) : !valid ? (
        <LayerCard role="alert">
          <LayerCard.Empty
            icon={<ShieldAlert strokeWidth={1.5} />}
            title="Invalid callback URL"
            description="For security, only loopback callbacks are allowed. The callback URL must start with http://localhost or http://127.0.0.1."
          />
        </LayerCard>
      ) : (
        <LayerCard>
          <LayerCard.Header>
            <h2 className="text-sm font-medium">Authorize your CLI</h2>
          </LayerCard.Header>
          <LayerCard.Body>
            <p className="text-sm text-basalt-muted-foreground">
              Authorize the <Code>otter</Code> CLI to use this dashboard. A fresh API token will be
              minted under your account and sent back to the loopback callback.
            </p>
          </LayerCard.Body>
          <LayerCard.Well>
            <p className="text-xs text-basalt-muted-foreground">Connecting to</p>
            <CodeBlock className="mt-2 break-all whitespace-pre-wrap">{callback}</CodeBlock>
          </LayerCard.Well>
          <LayerCard.Footer>
            <Button
              loading={authorizing}
              onClick={() => {
                setAuthorizing(true);
                window.location.href = apiPath(
                  `/api/auth/cli?callback=${encodeURIComponent(callback)}${state ? `&state=${encodeURIComponent(state)}` : ""}`,
                );
              }}
            >
              <ExternalLink strokeWidth={1.5} aria-hidden="true" />
              {authorizing ? "Authorizing…" : "Authorize CLI"}
            </Button>
          </LayerCard.Footer>
        </LayerCard>
      )}
    </div>
  );
}
