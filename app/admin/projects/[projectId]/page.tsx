import Link from "next/link"
import { notFound } from "next/navigation"

import { DeleteProjectButton, SetPublicButton } from "@/components/admin/admin-actions"
import { AdminPageHeader, DataTable, EmptyNote, Panel, StatusBadge, formatWhen } from "@/components/admin/admin-ui"
import { getAdminProject, PLATFORM_LABELS, STATUS_STYLES } from "@/lib/admin"

type Props = { params: Promise<{ projectId: string }> }

export default async function AdminProjectDetailPage({ params }: Props) {
  const { projectId } = await params
  const detail = await getAdminProject(projectId)
  if (!detail) notFound()

  const { project, ownerEmail, ownerName, ownerId, screens, shareCount, backend, github, appBuilds, webPublish, activeBuild } =
    detail

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={project.title}
        description={`${PLATFORM_LABELS[project.platform]} · ${STATUS_STYLES[project.status].label} · owned by ${ownerEmail}`}
      />

      <div className="flex flex-wrap gap-3">
        <SetPublicButton projectId={project.id} isPublic={project.isPublic} />
        <DeleteProjectButton projectId={project.id} title={project.title} />
        <Link
          href={`/workspace/${project.id}`}
          className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm font-medium hover:bg-muted"
        >
          Open workspace
        </Link>
        <Link
          href={`/preview/${project.id}`}
          className="inline-flex h-8 items-center rounded-full border border-input px-3 text-sm font-medium hover:bg-muted"
        >
          Preview
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Details">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Owner</dt>
              <dd>
                <Link href={`/admin/users/${ownerId}`} className="font-medium hover:underline">
                  {ownerName || ownerEmail}
                </Link>
                <span className="text-muted-foreground"> · {ownerEmail}</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Prompt</dt>
              <dd className="mt-1 whitespace-pre-wrap text-pretty">{project.prompt}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Shares</dt>
              <dd className="font-medium tabular-nums">{shareCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created / updated</dt>
              <dd>
                {formatWhen(project.createdAt)} · {formatWhen(project.updatedAt)}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Integrations">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Backend</dt>
              <dd className="font-medium">{backend ? backend.state : "Not connected"}</dd>
              {backend?.error ? <p className="mt-1 text-xs text-destructive">{backend.error}</p> : null}
            </div>
            <div>
              <dt className="text-muted-foreground">GitHub</dt>
              <dd className="font-medium">{github ? `${github.owner}/${github.name}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Active agent build</dt>
              <dd className="font-medium">
                {activeBuild ? `Step ${activeBuild.step} · job ${activeBuild.jobId ?? "—"}` : "None"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Web publish</dt>
              <dd className="font-medium">{webPublish ? webPublish.status : "—"}</dd>
              {webPublish?.liveUrl ? (
                <a href={webPublish.liveUrl} className="mt-1 block text-xs text-brand-dark hover:underline" target="_blank" rel="noreferrer">
                  {webPublish.liveUrl}
                </a>
              ) : null}
              {webPublish?.error ? <p className="mt-1 text-xs text-destructive">{webPublish.error}</p> : null}
            </div>
          </dl>
        </Panel>
      </div>

      <Panel title="Screens">
        {screens.length === 0 ? (
          <EmptyNote>No screens yet.</EmptyNote>
        ) : (
          <DataTable headers={["#", "Name", "Slug", "Status", "Code"]}>
            {screens.map((screen) => (
              <tr key={screen.id}>
                <td className="px-3 py-2.5 tabular-nums">{screen.position + 1}</td>
                <td className="px-3 py-2.5 font-medium">{screen.name}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{screen.slug}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge label={screen.status} />
                </td>
                <td className="px-3 py-2.5">{screen.hasCode ? "Yes" : "No"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Native builds">
        {appBuilds.length === 0 ? (
          <EmptyNote>No native builds yet.</EmptyNote>
        ) : (
          <DataTable headers={["When", "Platform", "Format", "Version", "Status", "Error"]}>
            {appBuilds.map((build) => (
              <tr key={build.id}>
                <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(build.createdAt)}</td>
                <td className="px-3 py-2.5">{build.platform}</td>
                <td className="px-3 py-2.5">{build.format}</td>
                <td className="px-3 py-2.5 tabular-nums">{build.version}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge label={build.status} />
                </td>
                <td className="max-w-xs px-3 py-2.5 text-xs text-destructive">{build.error || "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
