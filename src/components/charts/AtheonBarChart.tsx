import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartTheme, chartPalette, tooltipStyle } from "@/lib/chart-theme";

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
        <CartesianGrid stroke={chartTheme.grid.stroke} strokeWidth={chartTheme.grid.strokeWidth} />
        <XAxis dataKey={xAxisKey} tick={{ fill: chartTheme.text.fill, fontSize: chartTheme.text.fontSize }} />
        <YAxis tick={{ fill: chartTheme.text.fill, fontSize: chartTheme.text.fontSize }} />
        <Tooltip contentStyle={tooltipStyle.contentStyle} />
        {dataKeys.map((key, i) => (
          <Bar key={key} dataKey={key} fill={chartPalette[i % chartPalette.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
