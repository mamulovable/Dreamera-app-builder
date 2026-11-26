"use client"

import { ClosingCta, HeroIntro, StorySections } from "@/components/home/landing-sections"
import { HeroWorkspaceMockup } from "@/components/home/hero-workspace-mockup"
import { ProjectsSection } from "@/components/home/projects-section"
import { PromptComposer } from "@/components/home/prompt-composer"
import { SiteFooter } from "@/components/home/site-footer"
import { useAuth } from "@/lib/auth-client"

export function HomeContent() {
  const { user, isPending } = useAuth()

  if (isPending || user) {
    const firstName = user?.name.trim().split(/\s+/)[0]
    return (
      <main className="relative mx-auto max-w-6xl px-4 pt-16 pb-24 sm:px-6 sm:pt-24">
        {user && (
          <div id="composer" className="mx-auto mb-16 w-full max-w-3xl scroll-mt-28">
            <div className="mb-10 text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Welcome back{firstName ? `, ${firstName}` : ""}
              </h1>
              <p className="mt-3 text-base text-pretty text-muted-foreground sm:text-lg">
                What dream app should we build next?
              </p>
            </div>
            <PromptComposer />
          </div>
        )}
        <ProjectsSection />
      </main>
    )
  }

  return (
    <>
      <main className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <section className="pt-14 pb-8 sm:pt-20">
          <HeroIntro />
          <div id="composer" className="mx-auto mt-12 w-full max-w-3xl scroll-mt-28">
            <PromptComposer />
          </div>
          <HeroWorkspaceMockup />
        </section>

        <div className="pt-20 pb-24 sm:pt-28">
          <StorySections />
        </div>

        <div className="pb-24">
          <ProjectsSection />
        </div>

        <div className="pb-16">
          <ClosingCta />
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
