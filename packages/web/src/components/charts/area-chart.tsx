"use client";

import { useId } from "react";
import {
  Area,
  CartesianGrid,
  AreaChart as RechartsAreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartAxis, chartMuted, chartPrimary, withAlpha } from "@/lib/palette";

export interface AreaChartDataPoint {
  label: string;
  value: number;
}

interface AreaChartProps {
  data: AreaChartDataPoint[];
  /** Height in pixels (default: 200) */
  height?: number;
  /** Show grid lines (default: true) */
  showGrid?: boolean;
  /** Show the Y axis (default: false) */
  showVerticalAxis?: boolean;
  /** Tooltip value formatter */
  formatValue?: (value: number) => string;
  /** Accessible label for the chart */
  ariaLabel?: string;
}

/**
 * Reusable Area Chart component using Recharts.
 * Uses the app's chart palette from lib/palette.ts.
 */
export function AreaChart({
  data,
  height = 200,
  showGrid = true,
  showVerticalAxis = false,
  formatValue = (v) => String(v),
  ariaLabel,
}: AreaChartProps) {
  const gradientId = useId();

  // Generate a text summary for screen readers
  const summary =
    ariaLabel ||
    (data.length > 0
      ? `Chart showing ${data.length} data points, ranging from ${Math.min(...data.map((d) => d.value))} to ${Math.max(...data.map((d) => d.value))}`
      : "Empty chart");

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
        role="img"
        aria-label={summary}
      >
        No data
      </div>
    );
  }

  return (
    <div role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsAreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartMuted}
              strokeOpacity={0.3}
              vertical={false}
            />
          )}
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: chartAxis, fontSize: 11 }}
            dy={8}
          />
          {showVerticalAxis && (
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: chartAxis, fontSize: 11 }}
              width={32}
              tickFormatter={formatValue}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              borderRadius: "var(--radius)",
              fontSize: 12,
            }}
            labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
            itemStyle={{ color: "hsl(var(--muted-foreground))" }}
            formatter={(value) => [formatValue(Number(value)), "Backups"]}
          />
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartPrimary} stopOpacity={0.3} />
              <stop offset="100%" stopColor={chartPrimary} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={chartPrimary}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{
              r: 4,
              fill: chartPrimary,
              stroke: withAlpha("card", 1),
              strokeWidth: 2,
            }}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
