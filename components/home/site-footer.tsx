import { Logo } from "@/components/home/logo"

export function SiteFooter() {
  return (
    <footer className="relative px-4 pb-6 sm:px-6">
      <div className="mx-auto max-w-6xl rounded-[2.5rem] border border-border/60 bg-white/75 px-6 py-12 text-center shadow-[0_24px_60px_-36px_rgba(76,29,149,0.45)] backdrop-blur-md sm:px-12">
        <div className="flex justify-center">
          <Logo className="size-10 rounded-2xl" />
        </div>
        <p className="mt-6 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Dreamera — Where Dreams Become Applications.
        </p>
        <p className="mx-auto mt-3 max-w-md text-pretty text-muted-foreground">
          Have a dream app? We&apos;ve got the AI to help you build it.
        </p>
        <p className="mt-6 text-sm font-semibold tracking-[0.16em] text-brand-dark uppercase">
          Dream Big. Build Bigger.
        </p>
        <p className="mt-8 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Dreamera. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
