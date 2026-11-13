import Link from "next/link"

import { FailBuildButton } from "@/components/admin/admin-actions"
import {
  AdminPageHeader,
  EmptyNote,
  Panel,
  RowLink,
  StatCard,
  StatGrid,
  StatusBadge,
  ageLabel,
  auditActionLabel,
  formatWhen,
} from "@/components/admin/admin-ui"
import { getAdminOverview } from "@/lib/admin"
import { PLANS } from "@/lib/plans"

export default async function AdminOverviewPage() {
  const overview = await getAdminOverview()
  const attentionCount = overview.activeBuilds + overview.failedProjects + overview.nativeInFlight + overview.cancelingPro

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Overview"
        description={
          attentionCount > 0
            ? `${attentionCount.toLocaleString()} item${attentionCount === 1 ? "" : "s"} need attention right now.`
            : "Quiet for now — today's activity and totals are below."
        }
      />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Needs attention</h2>
        <StatGrid>
          <StatCard
            label="Active builds"
            value={overview.activeBuilds}
            hint={overview.buildingProjects ? `${overview.buildingProjects} projects building` : "Agent jobs in flight"}
            href="/admin/builds"
            tone={overview.activeBuilds > 0 ? "warn" : "default"}
          />
          <StatCard
            label="Failed projects"
            value={overview.failedProjects}
            hint="Open Builds to review"
            href="/admin/builds"
            tone={overview.failedProjects > 0 ? "danger" : "default"}
          />
          <StatCard
            label="Native in flight"
            value={overview.nativeInFlight}
            hint="Queued or building on EAS"
            href="/admin/builds"
            tone={overview.nativeInFlight > 0 ? "warn" : "default"}
          />
          <StatCard
            label="Pro canceling"
            value={overview.cancelingPro}
            hint={`${overview.proSubscribers.toLocaleString()} Pro total`}
            href="/admin/users"
            tone={overview.cancelingPro > 0 ? "warn" : "ok"}
          />
        </StatGrid>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Today</h2>
        <StatGrid>
          <StatCard label="Signups" value={overview.signupsToday} hint={`${overview.signupsWeek.toLocaleString()} in 7 days`} href="/admin/users" />
          <StatCard
            label="Projects created"
            value={overview.projectsToday}
            hint={`${overview.projectsWeek.toLocaleString()} in 7 days`}
            href="/admin/projects"
          />
          <StatCard
            label="Credits spent"
            value={overview.creditsSpentToday}
            hint={`${overview.creditsRefundedToday.toLocaleString()} refunded`}
          />
          <StatCard label="Credits granted" value={overview.creditsGrantedToday} hint="Admin adjustments today" href="/admin/users" />
        </StatGrid>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Catalog</h2>
        <StatGrid>
          <StatCard label="Users" value={overview.totalUsers} href="/admin/users" />
          <StatCard
            label="Projects"
            value={overview.totalProjects}
            hint={`${overview.readyProjects.toLocaleString()} ready`}
            href="/admin/projects"
          />
          <StatCard label="Public apps" value={overview.publicApps} href="/admin/public" />
          <StatCard label="Pro subscribers" value={overview.proSubscribers} href="/admin/users" tone="ok" />
        </StatGrid>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Active builds"
          action={
            <Link href="/admin/builds" className="text-xs font-medium text-brand-dark hover:underline">
              View all
            </Link>
          }
        >
          {overview.activeBuildRows.length === 0 ? (
            <EmptyNote>No agent builds running.</EmptyNote>
          ) : (
            <ul className="divide-y divide-border/60">
              {overview.activeBuildRows.map((build) => (
                <li key={build.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <RowLink href={`/admin/projects/${build.projectId}`}>{build.title}</RowLink>
                    <p className="truncate text-xs text-muted-foreground">
                      {build.ownerEmail} · step {build.step} · {ageLabel(build.createdAt)}
                    </p>
                  </div>
                  <FailBuildButton buildId={build.id} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent failures"
          action={
            <Link href="/admin/builds" className="text-xs font-medium text-brand-dark hover:underline">
              View all
            </Link>
          }
        >
          {overview.recentFailed.length === 0 ? (
            <EmptyNote>No failed projects.</EmptyNote>
          ) : (
            <ul className="divide-y divide-border/60">
              {overview.recentFailed.map((project) => (
                <li key={project.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <RowLink href={`/admin/projects/${project.id}`}>{project.title}</RowLink>
                    <p className="truncate text-xs text-muted-foreground">{project.ownerEmail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(project.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Newest signups"
          action={
            <Link href="/admin/users" className="text-xs font-medium text-brand-dark hover:underline">
              All users
            </Link>
          }
        >
          {overview.recentSignups.length === 0 ? (
            <EmptyNote>No users yet.</EmptyNote>
          ) : (
            <ul className="divide-y divide-border/60">
              {overview.recentSignups.map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <RowLink href={`/admin/users/${user.id}`}>{user.name || user.email}</RowLink>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge label={PLANS[user.plan].name} />
                    <span className="text-xs text-muted-foreground">{ageLabel(user.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Admin activity">
          {overview.recentAudit.length === 0 ? (
            <EmptyNote>No admin actions logged yet.</EmptyNote>
          ) : (
            <ul className="divide-y divide-border/60">
              {overview.recentAudit.map((entry) => {
                const detail = entry.detail ?? {}
                const summary =
                  entry.action === "grant-credits"
                    ? `${typeof detail.amount === "number" ? (detail.amount > 0 ? `+${detail.amount}` : detail.amount) : "?"} credits${
                        typeof detail.email === "string" ? ` · ${detail.email}` : ""
                      }`
                    : entry.action === "set-public"
                      ? `${detail.isPublic ? "Made public" : "Hidden"}${typeof detail.title === "string" ? ` · ${detail.title}` : ""}`
                      : entry.action === "delete-project"
                        ? typeof detail.title === "string"
                          ? detail.title
                          : "Project deleted"
                        : typeof detail.title === "string"
                          ? detail.title
                          : "Build stopped"

                return (
                  <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label={auditActionLabel(entry.action)} />
                        {entry.targetProjectId ? (
                          <RowLink href={`/admin/projects/${entry.targetProjectId}`}>Open project</RowLink>
                        ) : entry.targetUserId ? (
                          <RowLink href={`/admin/users/${entry.targetUserId}`}>Open user</RowLink>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {entry.adminEmail} · {summary}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(entry.createdAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Shortcuts">
        <div className="flex flex-wrap gap-2">
          {[
            { href: "/admin/users", label: "Search users" },
            { href: "/admin/projects?status=failed", label: "Failed projects" },
            { href: "/admin/projects?public=1", label: "Public projects" },
            { href: "/admin/builds", label: "Builds & publishes" },
            { href: "/admin/public", label: "Moderate public apps" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex h-9 items-center rounded-full border border-border/70 bg-background px-3.5 text-sm font-medium hover:border-brand/40 hover:bg-brand/5"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  )
}
