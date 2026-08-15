"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LogSource } from "@/components/SourceBadge";

export interface TrendPoint {
  date: string; // ISO
  label: string; // formatted short date, e.g. "Aug 12"
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  source: LogSource;
  parsedByAi: boolean;
}

function SourceDot(props: any) {
  const { cx, cy, payload, stroke } = props;
  if (cx == null || cy == null) return null;
  const isCaregiver = payload.source === "CAREGIVER_SMS";
  return (
    <svg x={cx - 5} y={cy - 5} width={10} height={10} style={{ overflow: "visible" }}>
      {isCaregiver ? (
        <rect x={0} y={0} width={10} height={10} rx={2} fill={stroke} stroke="var(--surface-1, #fcfcfb)" strokeWidth={1.5} />
      ) : (
        <circle cx={5} cy={5} r={5} fill={stroke} stroke="var(--surface-1, #fcfcfb)" strokeWidth={1.5} />
      )}
    </svg>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point: TrendPoint = payload[0]?.payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-block size-2 rounded-full" style={{ background: p.stroke }} />
          <span className="capitalize">{p.dataKey}:</span>
          <span className="font-medium text-popover-foreground">{p.value}</span>
        </div>
      ))}
      <div className="mt-1 text-[10px] text-muted-foreground">
        Source: {point.source === "CAREGIVER_SMS" ? "Caregiver SMS" : point.source === "WEB" ? "Web" : "Patient SMS"}
        {point.parsedByAi ? " · AI-parsed" : ""}
      </div>
    </div>
  );
}

export function SymptomTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium">Symptom severity (0–10)</h4>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
              axisLine={{ stroke: "var(--viz-axis)" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 10]}
              tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
              axisLine={false}
              tickLine={false}
              width={24}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              iconType="line"
              wrapperStyle={{ fontSize: 12, color: "var(--viz-muted)" }}
            />
            <Line
              type="monotone"
              dataKey="pain"
              name="Pain"
              stroke="var(--viz-series-pain)"
              strokeWidth={2}
              dot={<SourceDot />}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="nausea"
              name="Nausea"
              stroke="var(--viz-series-nausea)"
              strokeWidth={2}
              dot={<SourceDot />}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="fatigue"
              name="Fatigue"
              stroke="var(--viz-series-fatigue)"
              strokeWidth={2}
              dot={<SourceDot />}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium">Temperature (°F)</h4>
          <span className="text-[11px] text-muted-foreground">Dashed line = 100.4°F neutropenic fever threshold</span>
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} margin={{ top: 4, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
              axisLine={{ stroke: "var(--viz-axis)" }}
              tickLine={false}
            />
            <YAxis
              domain={[96, 104]}
              tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine
              y={100.4}
              stroke="var(--viz-status-critical)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
            <Line
              type="monotone"
              dataKey="fever"
              name="Fever"
              stroke="var(--viz-series-fever)"
              strokeWidth={2}
              dot={<SourceDot />}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width={10} height={10}><circle cx={5} cy={5} r={5} fill="var(--viz-muted)" /></svg>
          Patient-reported day
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width={10} height={10}><rect width={10} height={10} rx={2} fill="var(--viz-muted)" /></svg>
          Caregiver-reported day
        </span>
      </div>
    </div>
  );
}
