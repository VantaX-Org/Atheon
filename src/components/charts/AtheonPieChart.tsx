import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { chartPalette, tooltipStyle } from "@/lib/chart-theme";

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
            <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle.contentStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}
