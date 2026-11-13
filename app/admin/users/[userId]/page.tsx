import Link from "next/link"
import { notFound } from "next/navigation"

import { CreditAdjustForm } from "@/components/admin/admin-actions"
import { AdminPageHeader, DataTable, EmptyNote, Panel, RowLink, StatusBadge, formatWhen } from "@/components/admin/admin-ui"
import { getAdminUser, PLATFORM_LABELS, STATUS_STYLES } from "@/lib/admin"
import { PLANS } from "@/lib/plans"

type Props = { params: Promise<{ userId: string }> }

export default async function AdminUserDetailPage({ params }: Props) {
  const { userId: raw } = await params
  const userId = Number.parseInt(raw, 10)
  if (!Number.isFinite(userId)) notFound()

  const detail = await getAdminUser(userId)
  if (!detail) notFound()

  const { user, projectCount, connections, ledger, projects } = detail

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={user.name || user.email}
        description={`${user.email} · ${PLANS[user.plan].name} · ${projectCount} projects`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Non-expiring credits</dt>
              <dd className="font-medium tabular-nums">{user.credits}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Monthly credits</dt>
              <dd className="font-medium tabular-nums">{user.monthlyCredits}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Period end</dt>
              <dd className="font-medium">{formatWhen(user.currentPeriodEnd)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cancel at period end</dt>
              <dd className="font-medium">{user.cancelAtPeriodEnd ? "Yes" : "No"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Stripe customer</dt>
              <dd className="font-mono text-xs break-all">{user.stripeCustomerId || "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Connections</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                <StatusBadge label={connections.github ? "GitHub" : "No GitHub"} />
                <StatusBadge label={connections.expo ? "Expo" : "No Expo"} />
                <StatusBadge label={connections.cloudhike ? "CloudHike" : "No CloudHike"} />
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Adjust credits">
          <p className="mb-3 text-sm text-muted-foreground">
            Changes the non-expiring pool only. Plan and Stripe stay untouched.
          </p>
          <CreditAdjustForm userId={user.id} />
        </Panel>
      </div>

      <Panel title="Projects">
        {projects.length === 0 ? (
          <EmptyNote>No projects yet.</EmptyNote>
        ) : (
          <DataTable headers={["Project", "Status", "Platform", "Updated"]}>
            {projects.map((project) => (
              <tr key={project.id}>
                <td className="px-3 py-2.5">
                  <RowLink href={`/admin/projects/${project.id}`}>{project.title}</RowLink>
                  {project.isPublic ? <span className="ml-2 text-xs text-brand-dark">public</span> : null}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge label={STATUS_STYLES[project.status].label} />
                </td>
                <td className="px-3 py-2.5">{PLATFORM_LABELS[project.platform]}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(project.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Credit ledger" action={<Link href="/admin/users" className="text-xs text-muted-foreground hover:underline">All users</Link>}>
        {ledger.length === 0 ? (
          <EmptyNote>No credit transactions yet.</EmptyNote>
        ) : (
          <DataTable headers={["When", "Amount", "Balance", "Reason", "Reference"]}>
            {ledger.map((entry) => (
              <tr key={entry.id}>
                <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(entry.createdAt)}</td>
                <td className={`px-3 py-2.5 tabular-nums ${entry.amount < 0 ? "text-destructive" : "text-emerald-600"}`}>
                  {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                </td>
                <td className="px-3 py-2.5 tabular-nums">{entry.balanceAfter}</td>
                <td className="px-3 py-2.5">{entry.reason}</td>
                <td className="px-3 py-2.5 font-mono text-xs break-all text-muted-foreground">{entry.reference}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
