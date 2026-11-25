import Link from "next/link"

import { BuilderProviderForm } from "@/components/admin/builder-provider-form"
import { TokenChart } from "@/components/admin/token-chart"
import { AdminPageHeader, DataTable, EmptyNote, Panel, RowLink, StatCard, StatGrid, StatusBadge, formatWhen } from "@/components/admin/admin-ui"
import { defaultTokenPrice, readBuilderRoute } from "@/lib/agent/provider-settings"
import { getAdminBuilderUsage } from "@/lib/admin"
import { appBuildCostFromModels, formatNgn, formatUsd } from "@/lib/token-cost"

const KIND_LABEL = {
  planner: "Planner",
  screen: "Screen",
  component: "Component",
  foundation: "Foundation",
  data: "Data",
  page: "Page",
  build: "Build",
} as const

const APPS_PER_PAGE = 10
const CALLS_PER_PAGE = 10

const APP_SORTS = ["recent", "app-cost", "build-cost", "tokens", "name"] as const
type AppSort = (typeof APP_SORTS)[number]

const APP_SORT_LABEL: Record<AppSort, string> = {
  recent: "Most recent",
  "app-cost": "Highest app cost",
  "build-cost": "Highest build cost",
  tokens: "Most tokens",
  name: "Name A–Z",
}

type Props = {
  searchParams: Promise<{ sort?: string; page?: string; callsPage?: string }>
}

function count(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString()
}

function asAppSort(value?: string): AppSort {
  return APP_SORTS.includes(value as AppSort) ? (value as AppSort) : "recent"
}

function asPage(value: string | undefined, pageCount: number) {
  const parsed = Number.parseInt(value ?? "1", 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, Math.max(pageCount, 1))
}

function recentMs(app: {
  lastCallAt: Date | string | null
  updatedAt: Date | string | null
  createdAt: Date | string | null
}) {
  const stamp = app.lastCallAt ?? app.updatedAt ?? app.createdAt
  if (!stamp) return 0
  const ms = new Date(stamp).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function builderHref(options: { sort: AppSort; page: number; callsPage: number; hash: "apps" | "calls" }) {
  const params = new URLSearchParams()
  if (options.sort !== "recent") params.set("sort", options.sort)
  if (options.page > 1) params.set("page", String(options.page))
  if (options.callsPage > 1) params.set("callsPage", String(options.callsPage))
  const query = params.toString()
  return query ? `/admin/builder?${query}#${options.hash}` : `/admin/builder#${options.hash}`
}

export default async function AdminBuilderPage({ searchParams }: Props) {
  const params = await searchParams
  const sort = asAppSort(params.sort)
  const [usage, route] = await Promise.all([getAdminBuilderUsage(), readBuilderRoute()])
  const chartTotal = usage.days.reduce((sum, day) => sum + day.uncached + day.cached + day.output, 0)

  const fallbackPrice = defaultTokenPrice(route)
  const ranked = usage.apps
    .map((app) => ({
      app,
      cost: appBuildCostFromModels(
        app.byModel.length > 0
          ? app.byModel
          : [{ model: "_", inputTokens: app.inputTokens, outputTokens: app.outputTokens }],
        route.modelPrices,
        fallbackPrice
      ),
    }))
    .sort((a, b) => {
      if (sort === "app-cost") {
        const byCost = b.cost.app - a.cost.app
        if (byCost !== 0) return byCost
      } else if (sort === "build-cost") {
        const byCost = b.cost.build - a.cost.build
        if (byCost !== 0) return byCost
      } else if (sort === "tokens") {
        const byTokens = b.app.totalTokens - a.app.totalTokens
        if (byTokens !== 0) return byTokens
      } else if (sort === "name") {
        const byName = a.app.title.localeCompare(b.app.title)
        if (byName !== 0) return byName
      } else {
        const byRecent = recentMs(b.app) - recentMs(a.app)
        if (byRecent !== 0) return byRecent
      }
      const byTokens = b.app.totalTokens - a.app.totalTokens
      if (byTokens !== 0) return byTokens
      return a.app.title.localeCompare(b.app.title)
    })

  const pageCount = Math.max(1, Math.ceil(ranked.length / APPS_PER_PAGE))
  const page = asPage(params.page, pageCount)
  const start = (page - 1) * APPS_PER_PAGE
  const pageRows = ranked.slice(start, start + APPS_PER_PAGE)
  const from = ranked.length === 0 ? 0 : start + 1
  const to = Math.min(start + APPS_PER_PAGE, ranked.length)

  const callsPageCount = Math.max(1, Math.ceil(usage.calls.length / CALLS_PER_PAGE))
  const callsPage = asPage(params.callsPage, callsPageCount)
  const callsStart = (callsPage - 1) * CALLS_PER_PAGE
  const callRows = usage.calls.slice(callsStart, callsStart + CALLS_PER_PAGE)
  const callsFrom = usage.calls.length === 0 ? 0 : callsStart + 1
  const callsTo = Math.min(callsStart + CALLS_PER_PAGE, usage.calls.length)
  const pricesUnset =
    route.inputPricePerMillion === 0 &&
    route.outputPricePerMillion === 0 &&
    Object.keys(route.modelPrices).length === 0

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Builder tokens"
        description="Every model call that plans or builds an app. Costs use each model's own token price, then app cost is the build cost times two."
      />

      <Panel title="Provider">
        <BuilderProviderForm route={route} modelsUsed={usage.modelsUsed} />
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

      <Panel
        title="Tokens to build each app"
        action={
          <span className="text-xs text-muted-foreground">
            {ranked.length.toLocaleString()} apps
            {pricesUnset
              ? " · set per-model token prices to see a dollar cost"
              : Object.keys(route.modelPrices).length > 0
                ? ` · priced by ${Object.keys(route.modelPrices).length} model${Object.keys(route.modelPrices).length === 1 ? "" : "s"}`
                : " · using default rates"}
          </span>
        }
      >
        <div id="apps" className="space-y-3">
          <form className="flex flex-wrap items-end gap-2" action="/admin/builder" method="get">
            <div className="space-y-1.5">
              <label htmlFor="builder-apps-sort" className="text-xs font-medium text-muted-foreground">
                Sort by
              </label>
              <select
                id="builder-apps-sort"
                name="sort"
                defaultValue={sort}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {APP_SORTS.map((value) => (
                  <option key={value} value={value}>
                    {APP_SORT_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm font-medium hover:bg-muted"
            >
              Apply
            </button>
          </form>

          {ranked.length === 0 ? (
            <EmptyNote>No apps yet.</EmptyNote>
          ) : (
            <>
              <DataTable headers={["App", "Owner", "Calls", "Input", "Output", "Total", "Build cost", "App cost", "App cost (NGN)"]}>
                {pageRows.map(({ app, cost }) => (
                  <tr key={app.projectId ?? app.title}>
                    <td className="px-3 py-2.5">
                      {app.projectId ? <RowLink href={`/admin/projects/${app.projectId}`}>{app.title}</RowLink> : app.title}
                    </td>
                    <td className="px-3 py-2.5">{app.userEmail}</td>
                    <td className="px-3 py-2.5 tabular-nums">{count(app.calls)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{count(app.inputTokens)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{count(app.outputTokens)}</td>
                    <td className="px-3 py-2.5 font-medium tabular-nums">{count(app.totalTokens)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatUsd(cost.build)}</td>
                    <td className="px-3 py-2.5 font-medium tabular-nums">{formatUsd(cost.app)}</td>
                    <td className="px-3 py-2.5 font-medium tabular-nums">{formatNgn(cost.app)}</td>
                  </tr>
                ))}
              </DataTable>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">
                  Showing {from}–{to} of {ranked.length.toLocaleString()} · {APP_SORT_LABEL[sort]}
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 ? (
                    <Link
                      href={builderHref({ sort, page: page - 1, callsPage, hash: "apps" })}
                      className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm font-medium hover:bg-muted"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm text-muted-foreground opacity-50">
                      Previous
                    </span>
                  )}
                  <span className="tabular-nums text-muted-foreground">
                    Page {page} of {pageCount}
                  </span>
                  {page < pageCount ? (
                    <Link
                      href={builderHref({ sort, page: page + 1, callsPage, hash: "apps" })}
                      className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm font-medium hover:bg-muted"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm text-muted-foreground opacity-50">
                      Next
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Recent calls" action={<span className="text-xs text-muted-foreground">Latest {usage.calls.length.toLocaleString()}</span>}>
        <div id="calls" className="space-y-3">
          {usage.calls.length === 0 ? (
            <EmptyNote>Calls show up the next time the builder plans or writes a screen.</EmptyNote>
          ) : (
            <>
              <DataTable headers={["When", "User", "App", "Step", "Model", "Input", "Cached", "Output", "Total", "Status"]}>
                {callRows.map((call) => (
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

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">
                  Showing {callsFrom}–{callsTo} of {usage.calls.length.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  {callsPage > 1 ? (
                    <Link
                      href={builderHref({ sort, page, callsPage: callsPage - 1, hash: "calls" })}
                      className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm font-medium hover:bg-muted"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm text-muted-foreground opacity-50">
                      Previous
                    </span>
                  )}
                  <span className="tabular-nums text-muted-foreground">
                    Page {callsPage} of {callsPageCount}
                  </span>
                  {callsPage < callsPageCount ? (
                    <Link
                      href={builderHref({ sort, page, callsPage: callsPage + 1, hash: "calls" })}
                      className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm font-medium hover:bg-muted"
                    >
                      Next
                    </Link>
                  ) : (
                    <span className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm text-muted-foreground opacity-50">
                      Next
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
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
