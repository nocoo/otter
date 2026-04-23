import { useSearchParams } from "react-router";

// CLI pairing — Step 2 of the unified protocol.
//
// The CLI opens this page in a browser with `?callback=http://127.0.0.1:PORT/callback&state=NONCE`.
// On confirmation we full-page-redirect to `/api/auth/cli?callback=…&state=…` so the
// CF Access cookie attaches; the API mints a token and 302s back to the loopback callback
// with `?token=…&state=…&email=…`, which the CLI's local server captures.

function isLoopbackHttp(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function CliConnectPage() {
  const [params] = useSearchParams();
  const callback = params.get("callback") ?? "";
  const state = params.get("state") ?? "";
  const callbackValid = callback.length > 0 && isLoopbackHttp(callback);

  if (!callback) {
    return (
      <section>
        <h1 className="text-2xl font-semibold mb-4">Connect CLI</h1>
        <p className="text-sm text-gray-500">
          Run <code>otter login</code> from your terminal to start the pairing flow.
        </p>
      </section>
    );
  }

  if (!callbackValid) {
    return (
      <section>
        <h1 className="text-2xl font-semibold mb-4">Connect CLI</h1>
        <p className="text-sm text-red-500">
          Invalid callback URL — only <code>http://localhost</code> or <code>http://127.0.0.1</code>{" "}
          are accepted.
        </p>
      </section>
    );
  }

  const mintUrl = `/api/auth/cli?callback=${encodeURIComponent(callback)}${
    state ? `&state=${encodeURIComponent(state)}` : ""
  }`;

  const handleConnect = () => {
    window.location.href = mintUrl;
  };

  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Connect CLI</h1>
      <p className="text-sm text-gray-500">
        Authorize <code>otter</code> CLI to use this dashboard. A new API token will be issued and
        sent back to{" "}
        <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{callback}</code>.
      </p>
      <button
        type="button"
        onClick={handleConnect}
        className="px-4 py-2 rounded-md bg-orange-500 text-white text-sm font-medium hover:bg-orange-600"
      >
        Authorize CLI
      </button>
    </section>
  );
}
