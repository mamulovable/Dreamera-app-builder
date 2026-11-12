"use client"

import { ClosingCta, HeroIntro, StorySections } from "@/components/home/landing-sections"
import { ProjectsSection } from "@/components/home/projects-section"
import { PromptComposer } from "@/components/home/prompt-composer"
import { SiteFooter } from "@/components/home/site-footer"
import { useAuth } from "@/lib/auth-client"

export function HomeContent() {
  const { user, isPending } = useAuth()

  if (isPending || user) {
    return (
      <main className="relative mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-6 sm:pt-14">
        {user && (
          <div id="composer" className="mx-auto mb-14 w-full max-w-3xl scroll-mt-28">
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
        </section>

        <div className="pt-16 pb-24 sm:pt-24">
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
