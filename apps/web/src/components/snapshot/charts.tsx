import {
  ANIMATION_PROPS,
  BAR_RADIUS,
  CHART_PLOT_MARGIN_BARE,
  ChartFrame,
  ChartLegend,
  type ChartSeriesDescriptor,
  cartesianAxisProps,
  chartTooltipProps,
  getChartColor,
  type NamedValue,
  RESPONSIVE_CONTAINER_PROPS,
  resolveChartSeries,
  seriesColor,
  type XYPoint,
} from "@nocoo/basalt/components/chart";
import type { ReactNode } from "react";
import {
  Bar,
  Cell,
  Pie,
  PieChart,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface DonutChartProps {
  data: NamedValue[];
  series?: ChartSeriesDescriptor[];
  ariaLabel?: string;
  className?: string;
  showLegend?: boolean;
  valueFormatter?: (value: number) => string;
  dataAlternative?: ReactNode;
}

export function DonutChart({
  data,
  series,
  ariaLabel = "Donut chart",
  className,
  showLegend = false,
  valueFormatter,
  dataAlternative,
}: DonutChartProps) {
  const legendItems: ChartSeriesDescriptor[] = data.map((entry, index) => {
    const item = series?.find((candidate) => candidate.key === entry.name);
    const color = seriesColor(item, index) ?? getChartColor(index);
    return {
      key: `${entry.name}-${index}`,
      label: item?.label ?? entry.name,
      color,
    };
  });

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      size="h-basalt-36 w-basalt-36"
      {...(className !== undefined ? { className } : {})}
      {...(showLegend ? { legend: <ChartLegend items={legendItems} shape="bar" /> } : {})}
      {...(dataAlternative !== undefined ? { dataAlternative } : {})}
    >
      <ResponsiveContainer {...RESPONSIVE_CONTAINER_PROPS}>
        <PieChart accessibilityLayer aria-label={ariaLabel}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={24}
            outerRadius={48}
            stroke="none"
            {...ANIMATION_PROPS}
          >
            {data.map((entry, index) => {
              const item = series?.find((candidate) => candidate.key === entry.name);
              const fill = seriesColor(item, index) ?? getChartColor(index);
              return <Cell key={entry.name} fill={fill} />;
            })}
          </Pie>
          <Tooltip
            {...chartTooltipProps({
              ...(valueFormatter !== undefined ? { formatter: valueFormatter } : {}),
              cursor: false,
            })}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

interface BarChartProps {
  data: XYPoint[];
  series?: ChartSeriesDescriptor[];
  ariaLabel?: string;
  className?: string;
  valueFormatter?: (value: number) => string;
  dataAlternative?: ReactNode;
}

export function BarChart({
  data,
  series,
  ariaLabel = "Bar chart",
  className,
  valueFormatter,
  dataAlternative,
}: BarChartProps) {
  const bars = resolveChartSeries(series, ["y"]);

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      {...(className !== undefined ? { className } : {})}
      {...(dataAlternative !== undefined ? { dataAlternative } : {})}
    >
      <ResponsiveContainer {...RESPONSIVE_CONTAINER_PROPS}>
        <RechartsBarChart
          data={data}
          margin={CHART_PLOT_MARGIN_BARE}
          accessibilityLayer
          aria-label={ariaLabel}
        >
          <XAxis dataKey="x" {...cartesianAxisProps(true)} />
          <YAxis
            {...cartesianAxisProps(true)}
            {...(valueFormatter !== undefined ? { tickFormatter: valueFormatter } : {})}
          />
          <Tooltip
            {...chartTooltipProps({
              ...(valueFormatter !== undefined ? { formatter: valueFormatter } : {}),
              cursor: "bar",
            })}
          />
          {bars.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label ?? item.key}
              fill={seriesColor(item, index) ?? getChartColor(index)}
              radius={BAR_RADIUS.vertical}
              {...ANIMATION_PROPS}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
