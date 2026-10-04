import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Sidebar as BasaltSidebar,
  Button,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nocoo/basalt";
import { Archive, LayoutDashboard, LogOut, PanelLeft, Settings } from "lucide-react";
import { Link, useLocation } from "react-router";
import useSWR from "swr";
import { apiFetch } from "@/api";
import { APP_VERSION } from "@/lib/version";

const GROUPS = [
  {
    label: "Recovery",
    items: [
      { href: "/", label: "Machines", icon: LayoutDashboard },
      { href: "/snapshots", label: "Snapshots", icon: Archive },
    ],
  },
  { label: "Workspace", items: [{ href: "/settings", label: "Settings", icon: Settings }] },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname } = useLocation();
  const { data: session } = useSWR<{ email: string }>("/api/me", (path: string) =>
    apiFetch<{ email: string }>(path),
  );
  const email = session?.email ?? "";
  const name = email.split("@")[0] || "User";
  const { data: profile } = useSWR<{ avatar: string | null }>(
    email ? ["/api/profile", email] : null,
    ([path]: [string, string]) => apiFetch<{ avatar: string | null }>(path),
    { revalidateOnFocus: false },
  );
  const avatarUrl = profile?.avatar;
  const avatar = (
    <Avatar className="h-9 w-9 shrink-0">
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} referrerPolicy="no-referrer" />}
      <AvatarFallback>{name[0]?.toUpperCase() ?? "?"}</AvatarFallback>
    </Avatar>
  );
  const signOut = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            window.location.href = "/cdn-cgi/access/logout";
          }}
          aria-label="Sign out"
        >
          <LogOut strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Sign out</TooltipContent>
    </Tooltip>
  );
  const items = GROUPS.flatMap((group) => group.items);
  const active = (href: string) =>
    href === "/"
      ? pathname === href || pathname.startsWith("/devices/")
      : pathname === href || pathname.startsWith(`${href}/`);
  const item = (entry: (typeof items)[number]) => {
    const control = (
      <Button
        asChild
        key={entry.href}
        variant={active(entry.href) ? "secondary" : "ghost"}
        size={collapsed ? "icon" : "default"}
        className={collapsed ? "" : "w-full justify-start"}
      >
        <Link
          to={entry.href}
          aria-current={active(entry.href) ? "page" : undefined}
          aria-label={entry.label}
        >
          <entry.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          {!collapsed && <span>{entry.label}</span>}
        </Link>
      </Button>
    );
    return collapsed ? (
      <Tooltip key={entry.href}>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent side="right">{entry.label}</TooltipContent>
      </Tooltip>
    ) : (
      control
    );
  };
  return (
    <BasaltSidebar collapsed={collapsed}>
      <SidebarHeader>
        <div className="flex w-full items-center gap-3">
          <img src="/logo-24.png" alt="Otter" width={24} height={24} className="ml-3 shrink-0" />
          {!collapsed && (
            <>
              <span className="text-lg font-semibold tracking-tight">Otter</span>
              <Badge variant="secondary" className="text-xs">
                v{APP_VERSION}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label="Collapse sidebar"
                onClick={onToggle}
              >
                <PanelLeft strokeWidth={1.5} aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </SidebarHeader>
      {collapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="mb-1 self-center"
          aria-label="Expand sidebar"
          onClick={onToggle}
        >
          <PanelLeft strokeWidth={1.5} aria-hidden="true" />
        </Button>
      )}
      <SidebarNav aria-label="Main navigation" className={collapsed ? "items-center gap-1" : ""}>
        {collapsed
          ? items.map(item)
          : GROUPS.map((group) => (
              <SidebarGroup key={group.label} label={group.label}>
                {group.items.map(item)}
              </SidebarGroup>
            ))}
      </SidebarNav>
      <SidebarFooter className={collapsed ? "flex justify-center px-0" : ""}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${email || name} — Sign out`}
                onClick={() => {
                  window.location.href = "/cdn-cgi/access/logout";
                }}
              >
                {avatar}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{email || name}</TooltipContent>
          </Tooltip>
        ) : (
          <SidebarUser name={name} email={email} avatar={avatar} action={signOut} />
        )}
      </SidebarFooter>
    </BasaltSidebar>
  );
}
