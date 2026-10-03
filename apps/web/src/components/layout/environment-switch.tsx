import { useState } from "react";
import { getEnvironment, selectEnvironment } from "@/lib/environment";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

export function EnvironmentSwitch() {
  const environment = getEnvironment();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!environment?.local) return null;
  const change = async (mode: string) => {
    setBusy(true);
    setError(null);
    try {
      await selectEnvironment(mode, () =>
        window.confirm("Discard unsaved changes and switch environments?"),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Environment switch failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Tabs
        value={environment.mode ?? ""}
        onValueChange={(mode) => void change(mode)}
        className="mr-2"
        activationMode="manual"
      >
        <TabsList aria-label="Environment" className="h-8">
          <TabsTrigger value="demo" disabled={busy || environment.locked}>
            Demo
          </TabsTrigger>
          <TabsTrigger value="e2e" disabled={busy}>
            E2E
          </TabsTrigger>
          <TabsTrigger value="prod" disabled={busy || environment.locked}>
            Prod
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {error && (
        <span role="alert" className="max-w-64 text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}
