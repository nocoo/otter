"use client";

import { Github, Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Breadcrumbs } from "./breadcrumbs";
import { Sidebar } from "./sidebar";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { ThemeToggle } from "./theme-toggle";

// ---------------------------------------------------------------------------
// URL-based breadcrumb generation
// ---------------------------------------------------------------------------

const ROUTE_LABELS: Record<string, string> = {
  snapshots: "Snapshots",
  settings: "Settings",
};

function breadcrumbsFromPathname(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const items: { label: string; href?: string }[] = [{ label: "Home", href: "/" }];

  let href = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    href += `/${seg}`;
    const isLast = i === segments.length - 1;
    const label = ROUTE_LABELS[seg] ?? seg.slice(0, 8); // short-id fallback for dynamic segments
    items.push(isLast ? { label } : { label, href });
  }

  return items;
}

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

interface AppShellProps {
  children: React.ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const pathname = usePathname();

  // Close mobile sidebar on route change
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers the effect intentionally
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const breadcrumbs = breadcrumbsFromPathname(pathname);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar */}
      {!isMobile && <Sidebar />}

      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <>
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: backdrop overlay dismiss */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay dismiss */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop overlay dismiss */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-[260px]">
            <Sidebar />
          </div>
        </>
      )}

      <main className="flex flex-1 flex-col min-h-screen min-w-0">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                className="flex h-8 w-8 min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
              </button>
            )}
            <Breadcrumbs items={breadcrumbs} />
          </div>
          <div className="flex items-center gap-1">
            <a
              href="https://github.com/nocoo/otter"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              className="flex h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Github className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
            </a>
            <ThemeToggle />
          </div>
        </header>

        {/* Content area */}
        <div className="flex-1 p-4 md:p-5 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarProvider>
  );
}
