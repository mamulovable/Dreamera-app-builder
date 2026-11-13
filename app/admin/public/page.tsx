import { HidePublicButton } from "@/components/admin/admin-actions"
import { AdminPageHeader, DataTable, EmptyNote, RowLink, formatWhen } from "@/components/admin/admin-ui"
import { listPublicAdminProjects } from "@/lib/admin"

export default async function AdminPublicPage() {
  const rows = await listPublicAdminProjects()

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Public apps" description="Apps listed on the home page. Hide removes them from Explore." />

      {rows.length === 0 ? (
        <EmptyNote>No public apps right now.</EmptyNote>
      ) : (
        <DataTable headers={["App", "Owner", "Prompt", "Updated", ""]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-2.5">
                <RowLink href={`/admin/projects/${row.id}`}>{row.title}</RowLink>
              </td>
              <td className="px-3 py-2.5">{row.ownerEmail}</td>
              <td className="max-w-sm px-3 py-2.5">
                <p className="line-clamp-2 text-xs text-muted-foreground">{row.prompt}</p>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(row.updatedAt)}</td>
              <td className="px-3 py-2.5">
                <HidePublicButton projectId={row.id} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  )
}
