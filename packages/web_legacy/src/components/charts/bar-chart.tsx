"use client";

import {
  Bar,
  Cell,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS, chartAxis } from "@/lib/palette";

export interface BarChartDataPoint {
  name: string;
  value: number;
}

interface BarChartProps {
  data: BarChartDataPoint[];
  /** Height in pixels (default: 200) */
  height?: number;
  /** Layout direction (default: "horizontal" for horizontal bars) */
  layout?: "horizontal" | "vertical";
  /** Use different colors for each bar (default: true) */
  multiColor?: boolean;
  /** Tooltip value formatter */
  formatValue?: (value: number) => string;
  /** Show values on bars (default: false) */
  showValues?: boolean;
}

/**
 * Reusable Bar Chart component using Recharts.
 * Uses the app's chart palette from lib/palette.ts.
 *
 * Note: "horizontal" layout means horizontal bars (categories on Y axis, values on X axis).
 */
export function BarChart({
  data,
  height = 200,
  layout = "horizontal",
  multiColor = true,
  formatValue = (v) => String(v),
}: BarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const isHorizontal = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 8, left: 4, bottom: 4 }}
      >
        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fill: chartAxis, fontSize: 10 }}
              tickFormatter={formatValue}
            />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: chartAxis, fontSize: 11 }}
              width={80}
            />
          </>
        ) : (
          <>
            <XAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: chartAxis, fontSize: 11 }}
            />
            <YAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fill: chartAxis, fontSize: 10 }}
              width={32}
              tickFormatter={formatValue}
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            borderRadius: "var(--radius)",
            fontSize: 12,
          }}
          formatter={(value, _name, props) => {
            const payload = props.payload as BarChartDataPoint | undefined;
            return [formatValue(Number(value)), payload?.name ?? ""];
          }}
          cursor={{ fill: "hsl(var(--accent))", fillOpacity: 0.3 }}
        />
        <Bar dataKey="value" radius={[4, 4, 4, 4]} maxBarSize={24}>
          {data.map((item, index) => (
            <Cell
              key={`bar-${item.name}`}
              fill={
                multiColor
                  ? (CHART_COLORS[index % CHART_COLORS.length] ?? "hsl(var(--primary))")
                  : (CHART_COLORS[0] ?? "hsl(var(--primary))")
              }
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
