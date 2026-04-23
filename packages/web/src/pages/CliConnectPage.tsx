import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { apiFetch } from "@/api";

interface AuthCliStartResponse {
  redirect: string;
}

export function CliConnectPage() {
  const [params] = useSearchParams();
  const callback = params.get("callback_url") ?? "";
  const state = params.get("state") ?? "";
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!callback) return;
    setStatus("running");
    const url = `/api/auth/cli/callback?callback_url=${encodeURIComponent(callback)}&state=${encodeURIComponent(state)}`;
    apiFetch<AuthCliStartResponse>(url, { method: "POST" })
      .then((r) => {
        setMessage(`Token issued. Redirecting to ${r.redirect}…`);
        window.location.assign(r.redirect);
      })
      .catch((e: Error) => {
        setStatus("error");
        setMessage(e.message);
      });
  }, [callback, state]);

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

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-4">Connecting CLI…</h1>
      <p className="text-sm">{message || "Issuing token…"}</p>
      {status === "error" && <p className="text-sm text-red-500 mt-2">Failed: {message}</p>}
    </section>
  );
}
