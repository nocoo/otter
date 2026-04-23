import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  /**
   * Visual variant:
   * - "primary": larger, more prominent (for key metrics)
   * - "secondary": compact (default, for supporting metrics)
   */
  variant?: "primary" | "secondary";
  /**
   * Accent bar at top of card — shows a colored line as visual decoration.
   * Pass a Tailwind color class (e.g., "bg-primary", "bg-chart-5").
   */
  accentColor?: string;
  className?: string;
}

/**
 * Compact stat card — basalt L2 style (bg-secondary, no border/shadow).
 * Shows title, large value, optional icon.
 */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-muted-foreground",
  variant = "secondary",
  accentColor,
  className,
}: StatCardProps) {
  const isPrimary = variant === "primary";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary",
        isPrimary ? "p-5 md:p-6" : "p-4 md:p-5",
        className,
      )}
    >
      {/* Top accent bar — custom color or gradient for primary */}
      {(accentColor || isPrimary) && (
        <div
          className={cn(
            "h-0.5 w-8 rounded-full mb-4",
            accentColor ?? "bg-gradient-to-r from-primary to-chart-8",
          )}
        />
      )}

      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p
            className={cn(
              "text-muted-foreground",
              isPrimary ? "text-xs md:text-sm font-medium" : "text-xs md:text-sm",
            )}
          >
            {title}
          </p>
          <p
            className={cn(
              "font-semibold text-foreground font-display tracking-tight",
              isPrimary ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl",
            )}
          >
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={cn("rounded-md bg-card p-2", iconColor)}>
            <Icon className={cn(isPrimary ? "h-6 w-6" : "h-5 w-5")} strokeWidth={1.5} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatGrid
// ---------------------------------------------------------------------------

export interface StatGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

/** Responsive grid layout for stat cards. */
export function StatGrid({ children, columns = 4, className }: StatGridProps) {
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  };

  return <div className={cn("grid gap-3 md:gap-4", gridCols[columns], className)}>{children}</div>;
}
