import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS, CHART_THEME } from "@/lib/chart-theme";

interface Props {
  data: Record<string, unknown>[];
  dataKeys: string[];
  height?: number;
  xAxisKey?: string;
}

export function AtheonBarChart({ data, dataKeys, height = 300, xAxisKey = "name" }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        <CartesianGrid stroke={CHART_THEME.grid.stroke} strokeDasharray={CHART_THEME.grid.strokeDasharray} />
        <XAxis dataKey={xAxisKey} tick={{ fill: CHART_THEME.axis.color, fontSize: CHART_THEME.axis.fontSize }} />
        <YAxis tick={{ fill: CHART_THEME.axis.color, fontSize: CHART_THEME.axis.fontSize }} />
        <Tooltip contentStyle={{ background: CHART_THEME.tooltip.background, border: CHART_THEME.tooltip.border, borderRadius: CHART_THEME.tooltip.borderRadius, color: CHART_THEME.tooltip.color }} />
        {dataKeys.map((key, i) => (
          <Bar key={key} dataKey={key} fill={CHART_COLORS.series[i % CHART_COLORS.series.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
