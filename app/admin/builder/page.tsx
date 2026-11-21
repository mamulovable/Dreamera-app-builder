import Link from "next/link"

import { BuilderProviderForm } from "@/components/admin/builder-provider-form"
import { TokenChart } from "@/components/admin/token-chart"
import { AdminPageHeader, DataTable, EmptyNote, Panel, RowLink, StatCard, StatGrid, StatusBadge, formatWhen } from "@/components/admin/admin-ui"
import { readBuilderRoute } from "@/lib/agent/provider-settings"
import { getAdminBuilderUsage } from "@/lib/admin"

const KIND_LABEL = {
  planner: "Planner",
  screen: "Screen",
  component: "Component",
  foundation: "Foundation",
  data: "Data",
  page: "Page",
  build: "Build",
} as const

function count(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString()
}

export default async function AdminBuilderPage() {
  const [usage, route] = await Promise.all([getAdminBuilderUsage(), readBuilderRoute()])
  const chartTotal = usage.days.reduce((sum, day) => sum + day.uncached + day.cached + day.output, 0)

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Builder tokens"
        description="Every model call that plans or builds an app. Input, cached input, and output, plus the total for the day and for each app."
      />

      <Panel title="Provider">
        <BuilderProviderForm route={route} />
      </Panel>

      <StatGrid>
        <StatCard label="Tokens today" value={usage.today.totalTokens} hint={`${usage.today.calls.toLocaleString()} calls`} href="/admin/builder" />
        <StatCard label="Input today" value={usage.today.inputTokens} hint={`${usage.today.cachedInputTokens.toLocaleString()} cached`} />
        <StatCard label="Output today" value={usage.today.outputTokens} hint="Tokens the model wrote" />
        <StatCard label="Last 14 days" value={chartTotal} hint="Input plus output" />
      </StatGrid>

      <Panel title="Tokens by day" action={<span className="text-xs text-muted-foreground">UTC</span>}>
        {chartTotal === 0 ? <EmptyNote>No builder calls in the last 14 days.</EmptyNote> : <TokenChart days={usage.days} />}
      </Panel>

      <Panel title="Tokens to build each app">
        {usage.apps.length === 0 ? (
          <EmptyNote>No apps have been planned or built since token logging started.</EmptyNote>
        ) : (
          <DataTable headers={["App", "Owner", "Calls", "Input", "Output", "Total"]}>
            {usage.apps.map((app) => (
              <tr key={app.projectId ?? app.title}>
                <td className="px-3 py-2.5">
                  {app.projectId ? <RowLink href={`/admin/projects/${app.projectId}`}>{app.title}</RowLink> : app.title}
                </td>
                <td className="px-3 py-2.5">{app.userEmail}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(app.calls)}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(app.inputTokens)}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(app.outputTokens)}</td>
                <td className="px-3 py-2.5 font-medium tabular-nums">{count(app.totalTokens)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Recent calls" action={<span className="text-xs text-muted-foreground">Latest 80</span>}>
        {usage.calls.length === 0 ? (
          <EmptyNote>Calls show up the next time the builder plans or writes a screen.</EmptyNote>
        ) : (
          <DataTable headers={["When", "User", "App", "Step", "Model", "Input", "Cached", "Output", "Total", "Status"]}>
            {usage.calls.map((call) => (
              <tr key={call.id} className="align-top">
                <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatWhen(call.createdAt)}</td>
                <td className="px-3 py-2.5">
                  {call.userId ? <RowLink href={`/admin/users/${call.userId}`}>{call.userEmail}</RowLink> : call.userEmail}
                </td>
                <td className="px-3 py-2.5">
                  {call.projectId ? (
                    <RowLink href={`/admin/projects/${call.projectId}`}>{call.projectTitle}</RowLink>
                  ) : (
                    call.projectTitle
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className="font-medium">{call.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {KIND_LABEL[call.kind as keyof typeof KIND_LABEL] ?? call.kind}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                  {call.model}
                  <span className="mt-0.5 block text-muted-foreground">{call.provider}</span>
                </td>
                <td className="px-3 py-2.5 tabular-nums">{count(call.inputTokens)}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(call.cachedInputTokens)}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(call.outputTokens)}</td>
                <td className="px-3 py-2.5 font-medium tabular-nums">{count(call.totalTokens)}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge
                    label={call.status}
                    className={call.status === "failed" ? "border-destructive/40 text-destructive" : "border-emerald-500/40 text-emerald-700"}
                  />
                  {call.error ? <p className="mt-1 max-w-48 text-xs text-destructive">{call.error}</p> : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Generated-app usage, the calls a published app makes with Allow AI, stays on{" "}
        <Link href="/admin/ai" className="font-medium text-brand-dark hover:underline">
          AI calls
        </Link>
        .
      </p>
    </div>
  )
}
