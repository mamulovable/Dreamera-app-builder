"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const activityConfig = {
  signups: { label: "Signups", color: "#0f766e" },
  projects: { label: "Projects", color: "#2563eb" },
} satisfies ChartConfig

const creditsConfig = {
  credits: { label: "Credits spent", color: "#c2410c" },
} satisfies ChartConfig

const statusConfig = {
  planning: { label: "Planning", color: "#64748b" },
  building: { label: "Building", color: "#d97706" },
  ready: { label: "Ready", color: "#059669" },
  failed: { label: "Failed", color: "#dc2626" },
} satisfies ChartConfig

const planConfig = {
  free: { label: "Free", color: "#64748b" },
  pro: { label: "Pro", color: "#5b21b6" },
} satisfies ChartConfig

export type ActivityDay = {
  day: string
  label: string
  signups: number
  projects: number
  credits: number
}

export type NamedCount = {
  key: string
  label: string
  count: number
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

export function ActivityAreaChart({ days }: { days: ActivityDay[] }) {
  return (
    <ChartContainer config={activityConfig} className="aspect-auto h-72 w-full">
      <AreaChart data={days} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fillSignups" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-signups)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-signups)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fillProjects" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-projects)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-projects)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={1} />
        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} tickFormatter={compact} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="signups"
          stroke="var(--color-signups)"
          fill="url(#fillSignups)"
          strokeWidth={2.25}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Area
          type="monotone"
          dataKey="projects"
          stroke="var(--color-projects)"
          fill="url(#fillProjects)"
          strokeWidth={2.25}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}

export function CreditsBarChart({ days }: { days: ActivityDay[] }) {
  return (
    <ChartContainer config={creditsConfig} className="aspect-auto h-64 w-full">
      <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={1} />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={compact} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="credits" fill="var(--color-credits)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

export function StatusDonutChart({ rows }: { rows: NamedCount[] }) {
  const data = rows.filter((row) => row.count > 0)
  if (data.length === 0) return null
  return (
    <ChartContainer config={statusConfig} className="aspect-auto mx-auto h-64 w-full max-w-sm">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
        <Pie
          data={data}
          dataKey="count"
          nameKey="key"
          innerRadius={58}
          outerRadius={88}
          paddingAngle={3}
          strokeWidth={2}
        >
          {data.map((row) => (
            <Cell key={row.key} fill={`var(--color-${row.key})`} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="key" />} />
      </PieChart>
    </ChartContainer>
  )
}

export function PlanDonutChart({ rows }: { rows: NamedCount[] }) {
  const data = rows.filter((row) => row.count > 0)
  if (data.length === 0) return null
  return (
    <ChartContainer config={planConfig} className="aspect-auto mx-auto h-64 w-full max-w-sm">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
        <Pie
          data={data}
          dataKey="count"
          nameKey="key"
          innerRadius={58}
          outerRadius={88}
          paddingAngle={3}
          strokeWidth={2}
        >
          {data.map((row) => (
            <Cell key={row.key} fill={`var(--color-${row.key})`} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="key" />} />
      </PieChart>
    </ChartContainer>
  )
}
