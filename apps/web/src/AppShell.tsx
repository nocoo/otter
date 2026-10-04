import {
  Button,
  ContentIsland,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  ThemeToggle,
} from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import { AppMain, AppSkipLink, AppShell as BasaltShell } from "@nocoo/basalt/components/app-shell";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { EnvironmentSwitch } from "@/components/layout/environment-switch";
import { HeaderTooltip, HexlyLink } from "@/components/layout/header-links";
import { Sidebar } from "@/components/layout/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

const LABELS: Record<string, string> = {
  snapshots: "Snapshots",
  devices: "Machines",
  compare: "Compare",
  settings: "Settings",
  cli: "CLI",
  connect: "Connect",
};

export function AppShell() {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pathname) setMobileOpen(false);
  }, [pathname]);
  const segments = pathname.split("/").filter(Boolean);
  const title = segments.length
    ? (LABELS[segments.at(-1) ?? ""] ?? segments.at(-1)?.slice(0, 8) ?? "Home")
    : "Home";
  const breadcrumbs = segments.length
    ? [
        { href: "/", label: "Home" },
        ...segments
          .slice(0, -1)
          .filter((part) => part !== "cli")
          .map((part, index) => ({
            ...(part === "devices"
              ? { href: "/" }
              : part === "cli"
                ? {}
                : { href: `/${segments.slice(0, index + 1).join("/")}` }),
            label: LABELS[part] ?? part,
          })),
      ]
    : [];
  return (
    <BasaltShell layout="responsive" className="relative">
      <AppSkipLink>Skip to main content</AppSkipLink>
      {!isMobile ? (
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      ) : (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-[260px] max-w-[260px] border-0 p-0 bg-basalt-background"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menu.current?.focus();
            }}
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Navigate your configuration workspace.
            </SheetDescription>
            <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
      <AppMain>
        <AppHeader
          data-testid="app-header"
          density={isMobile ? "compact" : "comfortable"}
          {...(!isMobile ? { title, breadcrumbs } : {})}
          leading={
            isMobile ? (
              <Button
                ref={menu}
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
              >
                <Menu strokeWidth={1.5} aria-hidden="true" />
              </Button>
            ) : null
          }
          actions={
            <>
              <EnvironmentSwitch />
              <HeaderTooltip label="GitHub repository">
                <Button asChild variant="ghost" size="icon">
                  <a
                    href="https://github.com/nocoo/otter"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="GitHub repository"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.57 9.57 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.86v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
                    </svg>
                    <span className="sr-only">GitHub</span>
                  </a>
                </Button>
              </HeaderTooltip>
              <HexlyLink />
              <ThemeToggle aria-label="Toggle theme" />
            </>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
          <ContentIsland className="relative text-sm">
            <Outlet />
          </ContentIsland>
        </div>
      </AppMain>
    </BasaltShell>
  );
}
