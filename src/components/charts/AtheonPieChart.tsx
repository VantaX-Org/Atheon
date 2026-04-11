import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS, CHART_THEME } from "@/lib/chart-theme";

interface Props {
  data: { name: string; value: number }[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}

export function AtheonPieChart({ data, height = 300, innerRadius = 0, outerRadius = 100 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={innerRadius} outerRadius={outerRadius} dataKey="value" paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS.series[i % CHART_COLORS.series.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: CHART_THEME.tooltip.background, border: CHART_THEME.tooltip.border, borderRadius: CHART_THEME.tooltip.borderRadius, color: CHART_THEME.tooltip.color }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
