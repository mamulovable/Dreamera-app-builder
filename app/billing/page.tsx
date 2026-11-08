import type { Metadata } from "next"

import { UsageBilling } from "@/components/billing/usage-billing"
import { Logo } from "@/components/home/logo"
import { SignInDialogProvider } from "@/components/home/sign-in-dialog"
import { SiteHeader } from "@/components/home/site-header"

export const metadata: Metadata = {
  title: "Usage & billing — AppForge",
  description: "See your plan, the credits you have left, and how many projects you've used.",
}

export default function BillingPage() {
  return (
    <SignInDialogProvider>
      <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-background">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[700px] overflow-hidden">
          <div className="absolute -top-40 left-1/2 size-[520px] -translate-x-[110%] animate-blob rounded-full bg-indigo-300/40 blur-[100px]" />
          <div className="absolute -top-20 left-1/2 size-[480px] translate-x-[10%] animate-blob rounded-full bg-fuchsia-300/35 blur-[100px] [animation-delay:-6s]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
        </div>

        <SiteHeader />

        <main className="relative mx-auto w-full max-w-5xl flex-1 px-4 pb-24 sm:px-6">
          <section className="pt-14 pb-8 sm:pt-20">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Usage &amp; billing</h1>
            <p className="mt-4 text-base text-pretty text-muted-foreground">
              Your plan, the credits you have left, and how many projects you've used.
            </p>
          </section>

          <UsageBilling />
        </main>

        <footer className="relative px-4 pb-4 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 rounded-[2rem] border border-border/60 bg-muted/40 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
            <Logo className="size-7 rounded-xl" />
            <p>© {new Date().getFullYear()} AppForge. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </SignInDialogProvider>
  )
}
