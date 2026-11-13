import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { cn } from "cn"

export function AdminPageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  )
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string
  value: string | number
  hint?: string
  href?: string
  tone?: "default" | "warn" | "danger" | "ok"
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/5"
        : tone === "ok"
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/70 bg-card"

  const body = (
    <div className={cn("rounded-2xl border p-4 shadow-sm transition-colors", toneClass, href && "hover:border-brand/40")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )

  if (!href) return body
  return (
    <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-2xl">
      {body}
    </Link>
  )
}

export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

export function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  )
}

export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground hover:text-brand-dark hover:underline">
      {children}
    </Link>
  )
}

export function StatusBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", className)}>
      {label}
    </Badge>
  )
}

export function formatWhen(value: Date | string | null | undefined) {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function ageLabel(from: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - from.getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function auditActionLabel(action: string) {
  switch (action) {
    case "grant-credits":
      return "Credits"
    case "set-public":
      return "Visibility"
    case "delete-project":
      return "Delete"
    case "fail-build":
      return "Stop build"
    default:
      return action
  }
}
