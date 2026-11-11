import { ContentIsland, SidebarProvider } from "@nocoo/basalt";
import { AppHeader, AppHeaderMenuButton, ProjectLinks } from "@nocoo/basalt/components/app-header";
import { AppMain, AppSkipLink, AppShell as BasaltShell } from "@nocoo/basalt/components/app-shell";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nocoo/basalt/components/sheet";
import { ThemeToggle } from "@nocoo/basalt/components/theme-toggle";
import { useEffect, useId, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { EnvironmentSwitch } from "@/components/layout/environment-switch";
import { MobileNavProvider, useMobileNav } from "@/components/layout/mobile-nav-context";
import { PersistedSidebarProvider, Sidebar } from "@/components/layout/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

const LABELS: Record<string, string> = {
  snapshots: "Snapshots",
  devices: "Machines",
  compare: "Compare",
  settings: "Settings",
  cli: "CLI",
  connect: "Connect",
};

function buildAncestorBreadcrumbs(pathname: string): { href?: string; label: string }[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return [];
  }
  return [
    { href: "/", label: "Home" },
    ...segments
      .slice(0, -1)
      .filter((part) => part !== "cli")
      .map((part, index) => ({
        ...(part === "devices"
          ? { href: "/" }
          : { href: `/${segments.slice(0, index + 1).join("/")}` }),
        label: LABELS[part] ?? part,
      })),
  ];
}

function AppShellInner() {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useMobileNav();
  const { pathname } = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const mobileSheetId = useId();

  useEffect(() => {
    void pathname;
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  const segments = pathname.split("/").filter(Boolean);
  const title = segments.length
    ? (LABELS[segments.at(-1) ?? ""] ?? segments.at(-1)?.slice(0, 32) ?? "Home")
    : "Home";
  const ancestorBreadcrumbs = buildAncestorBreadcrumbs(pathname);
  const breadcrumbs = isMobile
    ? [{ label: title }]
    : ancestorBreadcrumbs.length > 0
      ? ancestorBreadcrumbs
      : undefined;

  return (
    <BasaltShell layout="responsive" className="relative">
      <AppSkipLink href="#main-content">Skip to main content</AppSkipLink>
      {!isMobile && (
        <PersistedSidebarProvider>
          <Sidebar ariaLabel="Main navigation" />
        </PersistedSidebarProvider>
      )}
      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            id={mobileSheetId}
            side="left"
            className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0 sm:max-w-[260px] sm:p-0"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuButton.current?.focus();
            }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Navigate your configuration workspace.</SheetDescription>
            </SheetHeader>
            <SidebarProvider collapsed={false} defaultWidth={260}>
              <Sidebar
                ariaLabel="Navigation"
                variant="mobile"
                onNavigate={() => setMobileOpen(false)}
                onDismiss={() => setMobileOpen(false)}
              />
            </SidebarProvider>
          </SheetContent>
        </Sheet>
      )}
      <AppMain>
        <AppHeader
          data-testid="app-header"
          density={isMobile ? "compact" : "comfortable"}
          leading={
            isMobile ? (
              <AppHeaderMenuButton
                ref={menuButton}
                label="Open navigation"
                aria-expanded={mobileOpen}
                aria-haspopup="dialog"
                aria-controls={mobileOpen ? mobileSheetId : undefined}
                onClick={() => setMobileOpen(true)}
              />
            ) : undefined
          }
          title={title}
          {...(breadcrumbs ? { breadcrumbs, breadcrumbsLabel: "Breadcrumb" } : {})}
          actions={
            <>
              <EnvironmentSwitch />
              <ProjectLinks github="nocoo/otter" hexly="otter" name="Otter" />
              <ThemeToggle aria-label="Toggle theme" />
            </>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
          <ContentIsland className="relative text-basalt-base">
            <Outlet />
          </ContentIsland>
        </div>
      </AppMain>
    </BasaltShell>
  );
}

export function AppShell() {
  return (
    <MobileNavProvider>
      <AppShellInner />
    </MobileNavProvider>
  );
}
