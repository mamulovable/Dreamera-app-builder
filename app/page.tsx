import { SparklesIcon } from "lucide-react"

import { Logo } from "@/components/home/logo"
import { ProjectsSection } from "@/components/home/projects-section"
import { PromptComposer } from "@/components/home/prompt-composer"
import { SignInDialogProvider } from "@/components/home/sign-in-dialog"
import { SiteHeader } from "@/components/home/site-header"

export default function Home() {
  return (
    <SignInDialogProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-background">
        <BackgroundDecor />
        <SiteHeader />

        <main className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <section className="mx-auto flex max-w-3xl flex-col items-center pt-14 pb-20 text-center sm:pt-20">
            <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/60 py-1 pr-4 pl-1 text-xs font-medium text-violet-700 shadow-[0_4px_20px_-6px_rgba(124,58,237,0.35)] backdrop-blur-md">
              <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-indigo-500 to-fuchsia-500 px-2.5 py-1 text-[11px] font-semibold text-white">
                <SparklesIcon className="size-3" />
                New
              </span>
              AI agent for mobile apps
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]">
              Turn your idea into a{" "}
              <span className="relative inline-block">
                <span className="animate-shimmer bg-linear-to-r from-indigo-500 via-fuchsia-500 to-indigo-500 bg-size-[200%_auto] bg-clip-text text-transparent">
                  mobile app
                </span>
                <svg
                  aria-hidden
                  viewBox="0 0 300 20"
                  preserveAspectRatio="none"
                  className="absolute -bottom-2 left-0 h-3 w-full text-fuchsia-400/70 sm:-bottom-3 sm:h-4"
                >
                  <path
                    d="M4 14 C 60 4, 120 4, 160 10 S 260 18, 296 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
              Describe what you want to build. AppForge designs the screens,
              writes the code, and gets it ready for iOS and Android.
            </p>

            <div className="mt-10 w-full">
              <PromptComposer />
            </div>
          </section>

          <div className="pb-24">
            <ProjectsSection />
          </div>
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

function BackgroundDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px] overflow-hidden">
      <div className="absolute -top-40 left-1/2 size-[520px] -translate-x-[110%] animate-blob rounded-full bg-indigo-300/40 blur-[100px]" />
      <div className="absolute -top-20 left-1/2 size-[480px] translate-x-[10%] animate-blob rounded-full bg-fuchsia-300/35 blur-[100px] [animation-delay:-6s]" />
      <div className="absolute top-60 left-1/2 size-[420px] -translate-x-1/2 animate-blob rounded-full bg-violet-300/30 blur-[110px] [animation-delay:-12s]" />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(0,0,0,0.07)_1px,transparent_1px)] mask-[radial-gradient(ellipse_60%_55%_at_50%_10%,black,transparent)] bg-size-[22px_22px]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
    </div>
  )
}
