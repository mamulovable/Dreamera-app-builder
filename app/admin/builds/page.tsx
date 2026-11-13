import Link from "next/link"

import { FailBuildButton } from "@/components/admin/admin-actions"
import { AdminPageHeader, DataTable, EmptyNote, Panel, RowLink, StatusBadge, ageLabel, formatWhen } from "@/components/admin/admin-ui"
import { getAdminBuilds } from "@/lib/admin"

export default async function AdminBuildsPage() {
  const { active, failed, native, web } = await getAdminBuilds()

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Builds" description="Active agent jobs, failed projects, native builds, and web publishes." />

      <Panel title="Active agent builds">
        {active.length === 0 ? (
          <EmptyNote>No active builds.</EmptyNote>
        ) : (
          <DataTable headers={["Project", "Owner", "Step", "Job", "Age", ""]}>
            {active.map((build) => (
              <tr key={build.id}>
                <td className="px-3 py-2.5">
                  <RowLink href={`/admin/projects/${build.projectId}`}>{build.title}</RowLink>
                </td>
                <td className="px-3 py-2.5">{build.ownerEmail}</td>
                <td className="px-3 py-2.5 tabular-nums">{build.step}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{build.jobId ?? "—"}</td>
                <td className="px-3 py-2.5">{ageLabel(build.createdAt)}</td>
                <td className="px-3 py-2.5">
                  <FailBuildButton buildId={build.id} />
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Failed projects">
        {failed.length === 0 ? (
          <EmptyNote>No failed projects.</EmptyNote>
        ) : (
          <DataTable headers={["Project", "Owner", "Updated"]}>
            {failed.map((project) => (
              <tr key={project.id}>
                <td className="px-3 py-2.5">
                  <RowLink href={`/admin/projects/${project.id}`}>{project.title}</RowLink>
                </td>
                <td className="px-3 py-2.5">{project.ownerEmail}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(project.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Native builds">
        {native.length === 0 ? (
          <EmptyNote>No queued, building, or failed native builds.</EmptyNote>
        ) : (
          <DataTable headers={["Project", "Owner", "Target", "Status", "When", "Error"]}>
            {native.map((build) => (
              <tr key={build.id}>
                <td className="px-3 py-2.5">
                  <RowLink href={`/admin/projects/${build.projectId}`}>{build.title}</RowLink>
                </td>
                <td className="px-3 py-2.5">{build.ownerEmail}</td>
                <td className="px-3 py-2.5">
                  {build.platform}/{build.format} · v{build.version}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge label={build.status} />
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(build.createdAt)}</td>
                <td className="max-w-xs px-3 py-2.5 text-xs text-destructive">{build.error || "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Web publishes">
        {web.length === 0 ? (
          <EmptyNote>No web publishes yet.</EmptyNote>
        ) : (
          <DataTable headers={["Project", "Owner", "Status", "Live URL", "Error"]}>
            {web.map((row) => (
              <tr key={row.projectId}>
                <td className="px-3 py-2.5">
                  <RowLink href={`/admin/projects/${row.projectId}`}>{row.title}</RowLink>
                </td>
                <td className="px-3 py-2.5">{row.ownerEmail}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge label={row.status} />
                </td>
                <td className="px-3 py-2.5">
                  {row.liveUrl ? (
                    <Link href={row.liveUrl} className="text-brand-dark hover:underline" target="_blank">
                      {row.liveUrl}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-xs px-3 py-2.5 text-xs text-destructive">{row.error || "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
