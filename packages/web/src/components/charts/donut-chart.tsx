"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_COLORS } from "@/lib/palette";

export interface DonutChartDataPoint {
  name: string;
  value: number;
}

interface DonutChartProps {
  data: DonutChartDataPoint[];
  /** Height in pixels (default: 180) */
  height?: number;
  /** Inner radius ratio (default: 0.6) */
  innerRadius?: number;
  /** Outer radius ratio (default: 0.85) */
  outerRadius?: number;
  /** Show legend below chart (default: true) */
  showLegend?: boolean;
  /** Tooltip value formatter */
  formatValue?: (value: number) => string;
}

/**
 * Reusable Donut Chart component using Recharts.
 * Uses the app's chart palette from lib/palette.ts.
 */
export function DonutChart({
  data,
  height = 180,
  innerRadius = 0.6,
  outerRadius = 0.85,
  showLegend = true,
  formatValue = (v) => String(v),
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  // Calculate actual pixel radii based on container
  const chartHeight = showLegend ? height - 40 : height;
  const minDimension = Math.min(chartHeight, 200); // Assume reasonable width
  const outerPx = (minDimension / 2) * outerRadius;
  const innerPx = outerPx * innerRadius;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={innerPx}
            outerRadius={outerPx}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((item, index) => (
              <Cell
                key={`cell-${item.name}`}
                fill={CHART_COLORS[index % CHART_COLORS.length] ?? "hsl(var(--primary))"}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              borderRadius: "var(--radius)",
              fontSize: 12,
            }}
            formatter={(value, name) => [formatValue(Number(value)), String(name)]}
          />
        </PieChart>
      </ResponsiveContainer>

      {showLegend && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-2">
          {data.map((item, index) => (
            <div key={item.name} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span className="text-[11px] text-muted-foreground">
                {item.name}{" "}
                <span className="font-medium text-foreground">{formatValue(item.value)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
