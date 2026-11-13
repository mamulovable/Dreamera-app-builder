import { AdminShell } from "@/components/admin/admin-shell"
import { requireAdminPage } from "@/lib/admin"

export const metadata = {
  title: "Admin — Dreamera",
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage()
  return <AdminShell email={admin.email}>{children}</AdminShell>
}
