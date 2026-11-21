"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const config = {
  uncached: { label: "Input tokens", color: "#7c6cf0" },
  cached: { label: "Cached input", color: "#2f9e6b" },
  output: { label: "Output tokens", color: "#3b82f6" },
} satisfies ChartConfig

export type TokenDay = {
  day: string
  label: string
  uncached: number
  cached: number
  output: number
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

export function TokenChart({ days }: { days: TokenDay[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={1} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="uncached" stackId="tokens" fill="var(--color-uncached)" />
        <Bar dataKey="cached" stackId="tokens" fill="var(--color-cached)" />
        <Bar dataKey="output" stackId="tokens" fill="var(--color-output)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
