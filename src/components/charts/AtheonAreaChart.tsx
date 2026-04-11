import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartTheme, chartPalette, tooltipStyle } from "@/lib/chart-theme";

interface Props {
  data: Record<string, unknown>[];
  dataKeys: string[];
  height?: number;
  xAxisKey?: string;
}

export function AtheonAreaChart({ data, dataKeys, height = 300, xAxisKey = "name" }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <CartesianGrid stroke={chartTheme.grid.stroke} strokeWidth={chartTheme.grid.strokeWidth} />
        <XAxis dataKey={xAxisKey} tick={{ fill: chartTheme.text.fill, fontSize: chartTheme.text.fontSize }} />
        <YAxis tick={{ fill: chartTheme.text.fill, fontSize: chartTheme.text.fontSize }} />
        <Tooltip contentStyle={tooltipStyle.contentStyle} />
        {dataKeys.map((key, i) => (
          <Area key={key} type="monotone" dataKey={key} stroke={chartPalette[i % chartPalette.length]} fill={chartPalette[i % chartPalette.length]} fillOpacity={0.1} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
