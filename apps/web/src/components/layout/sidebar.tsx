import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Sidebar as BasaltSidebar,
  Button,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nocoo/basalt";
import { Archive, LayoutDashboard, LogOut, PanelLeft, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
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
  const navigate = useNavigate();
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
    <Avatar>
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
    const control = collapsed ? (
      <SidebarIconItem
        key={entry.href}
        active={active(entry.href)}
        aria-label={entry.label}
        onClick={() => navigate(entry.href)}
      >
        <entry.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      </SidebarIconItem>
    ) : (
      <SidebarItem
        key={entry.href}
        active={active(entry.href)}
        aria-label={entry.label}
        onClick={() => navigate(entry.href)}
      >
        <entry.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="flex-1 truncate text-left">{entry.label}</span>
      </SidebarItem>
    );
    return collapsed ? (
      <Tooltip key={entry.href}>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {entry.label}
        </TooltipContent>
      </Tooltip>
    ) : (
      control
    );
  };
  return (
    <BasaltSidebar collapsed={collapsed}>
      <SidebarHeader>
        {collapsed ? (
          <img src="/logo-24.png" alt="Otter" width={24} height={24} className="h-5 w-5 shrink-0" />
        ) : (
          <div className="flex w-full min-w-0 items-center justify-between">
            <div className="flex min-w-0 items-center gap-basalt-space-lg">
              <img
                src="/logo-24.png"
                alt="Otter"
                width={24}
                height={24}
                className="h-5 w-5 shrink-0"
              />
              <span className="truncate text-lg font-semibold text-basalt-foreground md:text-xl">
                Otter
              </span>
              <span className="shrink-0 rounded-md bg-basalt-secondary px-basalt-space-md py-basalt-space-xs text-basalt-xs font-medium leading-none text-basalt-muted-foreground">
                v{APP_VERSION}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Collapse sidebar"
              onClick={onToggle}
            >
              <PanelLeft strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </div>
        )}
      </SidebarHeader>
      {collapsed && (
        <Button variant="ghost" size="icon" aria-label="Expand sidebar" onClick={onToggle}>
          <PanelLeft strokeWidth={1.5} aria-hidden="true" />
        </Button>
      )}
      <SidebarNav aria-label="Main navigation">
        {collapsed
          ? items.map(item)
          : GROUPS.map((group) => (
              <SidebarGroup key={group.label} label={group.label}>
                {group.items.map(item)}
              </SidebarGroup>
            ))}
      </SidebarNav>
      <SidebarFooter>
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
            <TooltipContent side="right" sideOffset={8}>
              {email || name}
            </TooltipContent>
          </Tooltip>
        ) : (
          <SidebarUser name={name} email={email} avatar={avatar} action={signOut} />
        )}
      </SidebarFooter>
    </BasaltSidebar>
  );
}
