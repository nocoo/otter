"use client";

import { AppShell } from "@/components/layout/app-shell";

export default function Home() {
  return (
    <AppShell>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight font-display">Otter Dashboard</h1>
          <p className="mt-2 text-muted-foreground">
            Scaffold complete. Pages coming next.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
