import { Avatar, AvatarFallback, AvatarImage } from "@nocoo/basalt/components/avatar";
import {
  Sidebar as BasaltSidebar,
  SidebarBrand,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarProvider,
  SidebarToggle,
  SidebarUser,
  useSidebar,
} from "@nocoo/basalt/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nocoo/basalt/components/tooltip";
import { Archive, LayoutDashboard, type LucideIcon, Settings } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useLocation } from "react-router";
import { useMe } from "@/hooks/use-me";
import { getDisplayName } from "@/lib/display-name";
import { APP_VERSION } from "@/lib/version";

const ACCESS_LOGOUT_URL = "/cdn-cgi/access/logout";
const SIDEBAR_COLLAPSED_KEY = "otter:sidebar-collapsed";
type SidebarCollapsedPreference = "false" | "true";

type NavItem = { href: string; label: string; icon: LucideIcon };

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Recovery",
    items: [
      { href: "/", label: "Machines", icon: LayoutDashboard },
      { href: "/snapshots", label: "Snapshots", icon: Archive },
    ],
  },
  {
    label: "Workspace",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

const ALL_NAV_ITEMS = GROUPS.flatMap((group) => group.items);

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/devices/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function usePersistedSidebarCollapsed(
  key: string,
  defaultValue: SidebarCollapsedPreference,
): [SidebarCollapsedPreference, (value: SidebarCollapsedPreference) => void] {
  const [stored, setStored] = useState<SidebarCollapsedPreference>(() => {
    if (typeof window === "undefined") return defaultValue;
    const value = localStorage.getItem(key);
    return value === "true" || value === "false" ? value : defaultValue;
  });

  const setValue = useCallback(
    (next: SidebarCollapsedPreference) => {
      setStored(next);
      localStorage.setItem(key, next);
    },
    [key],
  );

  return [stored, setValue];
}

export function PersistedSidebarProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = usePersistedSidebarCollapsed(SIDEBAR_COLLAPSED_KEY, "false");
  const collapsed = stored === "true";
  const onCollapsedChange = useCallback(
    (next: boolean) => {
      setStored(next ? "true" : "false");
    },
    [setStored],
  );

  return (
    <SidebarProvider collapsed={collapsed} onCollapsedChange={onCollapsedChange} defaultWidth={260}>
      {children}
    </SidebarProvider>
  );
}

interface SidebarProps {
  ariaLabel: string;
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
  onDismiss?: () => void;
}

function OtterSidebarBody({
  variant,
  onNavigate,
  onDismiss,
}: {
  variant?: SidebarProps["variant"];
  onNavigate?: () => void;
  onDismiss?: () => void;
}) {
  const { pathname } = useLocation();
  const { collapsed, peek, peeking } = useSidebar();
  const railCollapsed = collapsed && !(peek && peeking);
  const { data: user } = useMe();
  const { name, initial, email, avatar } = getDisplayName(user);

  const userAvatar = (
    <Avatar>
      {avatar ? <AvatarImage src={avatar} alt={name} referrerPolicy="no-referrer" /> : null}
      <AvatarFallback>{initial}</AvatarFallback>
    </Avatar>
  );

  return (
    <>
      <SidebarHeader>
        <SidebarBrand
          logo={<img src="/logo-24.png" alt="Otter" width={24} height={24} />}
          name="Otter"
          version={`v${APP_VERSION}`}
          action={
            variant === "mobile" ? (
              <SidebarToggle
                mode="dismiss"
                dismissLabel="Close navigation"
                {...(onDismiss ? { onDismiss } : {})}
              />
            ) : (
              <SidebarToggle expandLabel="Expand sidebar" collapseLabel="Collapse sidebar" />
            )
          }
        />
      </SidebarHeader>
      <SidebarNav aria-label="Main navigation">
        {railCollapsed
          ? ALL_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <SidebarIconItem
                      href={item.href}
                      active={active}
                      aria-label={item.label}
                      onClick={onNavigate}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                    </SidebarIconItem>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            })
          : GROUPS.map((group) => (
              <SidebarGroup key={group.label} label={group.label}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, item.href);
                  return (
                    <SidebarItem
                      key={item.href}
                      href={item.href}
                      active={active}
                      onClick={onNavigate}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span className="flex-1 truncate text-left">{item.label}</span>
                    </SidebarItem>
                  );
                })}
              </SidebarGroup>
            ))}
      </SidebarNav>
      <SidebarFooter>
        <SidebarUser
          name={name}
          email={email ?? undefined}
          avatar={userAvatar}
          tooltip={name}
          signOutHref={ACCESS_LOGOUT_URL}
          signOutLabel="Sign out"
        />
      </SidebarFooter>
    </>
  );
}

export function Sidebar({ ariaLabel, variant = "desktop", onNavigate, onDismiss }: SidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <BasaltSidebar aria-label={ariaLabel} resizable={false}>
        <OtterSidebarBody
          variant={variant}
          {...(onNavigate ? { onNavigate } : {})}
          {...(onDismiss ? { onDismiss } : {})}
        />
      </BasaltSidebar>
    </TooltipProvider>
  );
}
