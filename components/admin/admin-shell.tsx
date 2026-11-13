"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  FolderIcon,
  GaugeIcon,
  GlobeIcon,
  HammerIcon,
  UsersIcon,
} from "lucide-react"

import { Logo } from "@/components/home/logo"
import { cn } from "cn"

const NAV = [
  { href: "/admin", label: "Overview", icon: GaugeIcon, exact: true },
  { href: "/admin/users", label: "Users", icon: UsersIcon, exact: false },
  { href: "/admin/projects", label: "Projects", icon: FolderIcon, exact: false },
  { href: "/admin/builds", label: "Builds", icon: HammerIcon, exact: false },
  { href: "/admin/public", label: "Public", icon: GlobeIcon, exact: false },
] as const

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="relative min-h-screen bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
        <div className="absolute -top-32 left-1/2 size-[420px] -translate-x-[90%] rounded-full bg-brand/20 blur-[100px]" />
        <div className="absolute -top-16 left-1/2 size-[360px] translate-x-[20%] rounded-full bg-brand-accent/15 blur-[100px]" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-b from-transparent to-background" />
      </div>

      <header className="relative border-b border-border/70 bg-white/65 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Dreamera home">
              <Logo className="size-8 rounded-full" />
            </Link>
            <div>
              <p className="text-sm font-semibold tracking-tight">Admin</p>
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Back to site
          </Link>
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col lg:gap-1">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "bg-brand/10 text-brand-dark" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
