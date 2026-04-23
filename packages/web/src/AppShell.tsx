import { Link, NavLink, Outlet } from "react-router";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV: readonly NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/snapshots", label: "Snapshots" },
  { to: "/settings", label: "Settings" },
  { to: "/cli/connect", label: "CLI" },
];

export function AppShell() {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-black/10 dark:border-white/10 p-4 flex flex-col gap-2">
        <Link to="/" className="font-semibold text-lg mb-4">
          🦦 Otter
        </Link>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end ?? false}
            className={({ isActive }) =>
              `px-3 py-2 rounded text-sm ${isActive ? "bg-black/5 dark:bg-white/10 font-medium" : "hover:bg-black/5 dark:hover:bg-white/5"}`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
