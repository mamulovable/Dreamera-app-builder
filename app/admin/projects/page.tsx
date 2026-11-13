import Link from "next/link"

import { AdminPageHeader, DataTable, EmptyNote, RowLink, StatusBadge, formatWhen } from "@/components/admin/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PLATFORM_LABELS, STATUS_STYLES, searchAdminProjects } from "@/lib/admin"
import { PROJECT_PLATFORMS, PROJECT_STATUSES, type ProjectPlatform, type ProjectStatus } from "@/lib/projects"

type Props = {
  searchParams: Promise<{ status?: string; platform?: string; public?: string; owner?: string }>
}

function asStatus(value?: string): ProjectStatus | null {
  return PROJECT_STATUSES.includes(value as ProjectStatus) ? (value as ProjectStatus) : null
}

function asPlatform(value?: string): ProjectPlatform | null {
  return PROJECT_PLATFORMS.includes(value as ProjectPlatform) ? (value as ProjectPlatform) : null
}

export default async function AdminProjectsPage({ searchParams }: Props) {
  const params = await searchParams
  const status = asStatus(params.status)
  const platform = asPlatform(params.platform)
  const isPublic = params.public === "1" ? true : params.public === "0" ? false : null
  const owner = params.owner ?? null
  const rows = await searchAdminProjects({ status, platform, isPublic, owner })

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Projects" description="Filter by status, platform, visibility, or owner." />

      <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" action="/admin/projects" method="get">
        <select name="status" defaultValue={status ?? ""} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">Any status</option>
          {PROJECT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_STYLES[value].label}
            </option>
          ))}
        </select>
        <select name="platform" defaultValue={platform ?? ""} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">Any platform</option>
          {PROJECT_PLATFORMS.map((value) => (
            <option key={value} value={value}>
              {PLATFORM_LABELS[value]}
            </option>
          ))}
        </select>
        <select name="public" defaultValue={params.public ?? ""} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">Any visibility</option>
          <option value="1">Public</option>
          <option value="0">Private</option>
        </select>
        <Input name="owner" defaultValue={owner ?? ""} placeholder="Owner email or name" />
        <Button type="submit" className="rounded-full">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyNote>No projects match those filters.</EmptyNote>
      ) : (
        <DataTable headers={["Project", "Owner", "Status", "Platform", "Updated"]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-2.5">
                <RowLink href={`/admin/projects/${row.id}`}>{row.title}</RowLink>
                {row.isPublic ? <span className="ml-2 text-xs text-brand-dark">public</span> : null}
                <p className="line-clamp-1 text-xs text-muted-foreground">{row.prompt}</p>
              </td>
              <td className="px-3 py-2.5">
                <Link href={`/admin/users/${row.ownerId}`} className="hover:underline">
                  {row.ownerEmail}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge label={STATUS_STYLES[row.status].label} />
              </td>
              <td className="px-3 py-2.5">{PLATFORM_LABELS[row.platform]}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(row.updatedAt)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  )
}
