import Link from "next/link"

import { AdminPageHeader, DataTable, EmptyNote, RowLink, formatWhen } from "@/components/admin/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { searchAdminUsers } from "@/lib/admin"
import { PLANS } from "@/lib/plans"

type Props = { searchParams: Promise<{ q?: string }> }

export default async function AdminUsersPage({ searchParams }: Props) {
  const { q } = await searchParams
  const rows = await searchAdminUsers(q ?? null)

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Users" description="Search by email or name. Open a person to adjust credits." />

      <form className="flex flex-wrap gap-2" action="/admin/users" method="get">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search email or name" className="max-w-sm" />
        <Button type="submit" className="rounded-full">
          Search
        </Button>
        {q ? (
          <Link href="/admin/users" className="inline-flex h-8 items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyNote>No users match that search.</EmptyNote>
      ) : (
        <DataTable headers={["Person", "Plan", "Credits", "Projects", "Joined"]}>
          {rows.map((row) => (
            <tr key={row.id} className="bg-background">
              <td className="px-3 py-2.5">
                <RowLink href={`/admin/users/${row.id}`}>{row.name || row.email}</RowLink>
                <p className="text-xs text-muted-foreground">{row.email}</p>
              </td>
              <td className="px-3 py-2.5">
                {PLANS[row.plan].name}
                {row.cancelAtPeriodEnd ? <span className="ml-1 text-xs text-amber-600">canceling</span> : null}
              </td>
              <td className="px-3 py-2.5 tabular-nums">
                {row.credits + row.monthlyCredits}
                <span className="block text-xs text-muted-foreground">
                  {row.credits} + {row.monthlyCredits} monthly
                </span>
              </td>
              <td className="px-3 py-2.5 tabular-nums">{row.projectCount}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{formatWhen(row.createdAt)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  )
}
