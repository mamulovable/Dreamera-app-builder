import Link from "next/link"

import { Logo } from "@/components/home/logo"

const FOOTER_LINKS = [
  { label: "How it works", href: "/#steps" },
  { label: "Explore", href: "/#possible" },
  { label: "Why Dreamera", href: "/#why" },
  { label: "Pricing", href: "/pricing" },
]

export function SiteFooter() {
  return (
    <footer className="relative px-4 pb-10 sm:px-6">
      <div className="mx-auto max-w-6xl border-t border-border/60 pt-10">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm text-center sm:text-left">
            <Link href="/" aria-label="Dreamera home" className="inline-flex">
              <Logo className="size-9 rounded-2xl" />
            </Link>
            <p className="mt-4 text-base font-semibold tracking-tight">
              Dreamera — Where Dreams Become Applications.
            </p>
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              Have a dream app? We&apos;ve got the AI to help you build it.
            </p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-brand-dark"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border/50 pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Dreamera. All rights reserved.</p>
          <p className="font-semibold tracking-[0.16em] text-brand-dark uppercase">
            Dream Big. Build Bigger.
          </p>
        </div>
      </div>
    </footer>
  )
}
