// Centralized chart / visualization color palette.
// All values reference CSS custom properties defined in globals.css.
// Use these constants everywhere instead of hardcoded color strings.

/** Helper — wraps a CSS custom property name for inline style usage. */
const v = (token: string) => `hsl(var(--${token}))`;

/**
 * Returns a CSS color string with alpha from a CSS custom property.
 * Usage: `withAlpha("chart-1", 0.12)` -> `hsl(var(--chart-1) / 0.12)`
 */
export const withAlpha = (token: string, alpha: number) => `hsl(var(--${token}) / ${alpha})`;

// -- 24 sequential chart colors --

export const chart = {
  teal: v("chart-1"), // Brand teal (= --primary)
  sky: v("chart-2"),
  jade: v("chart-3"),
  green: v("chart-4"),
  lime: v("chart-5"),
  amber: v("chart-6"),
  orange: v("chart-7"),
  vermilion: v("chart-8"),
  blue: v("chart-9"),
  red: v("chart-10"),
  rose: v("chart-11"),
  magenta: v("chart-12"),
  orchid: v("chart-13"),
  purple: v("chart-14"),
  indigo: v("chart-15"),
  cobalt: v("chart-16"),
  steel: v("chart-17"),
  cadet: v("chart-18"),
  seafoam: v("chart-19"),
  olive: v("chart-20"),
  gold: v("chart-21"),
  tangerine: v("chart-22"),
  crimson: v("chart-23"),
  gray: v("chart-24"),
} as const;

/** Ordered array — use for pie / donut / bar where you need N colors by index. */
export const CHART_COLORS = Object.values(chart);

/** CSS variable names (without --) matching CHART_COLORS order — for withAlpha(). */
export const CHART_TOKENS = Array.from(
  { length: 24 },
  (_, i) => `chart-${i + 1}`,
) as readonly string[];

// -- Semantic aliases --

export const chartAxis = v("chart-axis");
export const chartMuted = v("chart-muted");

/** Positive / success */
export const chartPositive = chart.green;

/** Negative / destructive — reuses the destructive token */
export const chartNegative = v("destructive");

/** Primary chart accent (most-used single color) */
export const chartPrimary = chart.teal;
