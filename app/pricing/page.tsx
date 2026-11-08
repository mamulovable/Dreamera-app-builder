import type { Metadata } from "next"

import { PricingPlans } from "@/components/billing/pricing-plans"
import { Logo } from "@/components/home/logo"
import { SignInDialogProvider } from "@/components/home/sign-in-dialog"
import { SiteHeader } from "@/components/home/site-header"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { EDIT_CREDITS, IMAGE_CREDITS, PLANS, PRO_MONTHLY_CREDITS, SCREEN_CREDITS, SMALL_APP_CREDITS } from "@/lib/plans"

export const metadata: Metadata = {
  title: "Pricing — AppForge",
  description: "Start free and build your first apps with AI. Upgrade to Pro for unlimited projects and iOS and Android exports.",
}

const CREDIT_COSTS = [
  { value: SMALL_APP_CREDITS, label: "A small app", detail: `4 screens, at ${SCREEN_CREDITS} credits each` },
  { value: EDIT_CREDITS, label: "An edit", detail: "One round of changes by chat" },
  { value: IMAGE_CREDITS, label: "An AI image", detail: "Made or changed in edit mode" },
  { value: 0, label: "Planning", detail: "Chatting, plans, and theme switches" },
]

const QUESTIONS = [
  {
    question: "When are credits used?",
    answer: `When a build starts. A new screen costs ${SCREEN_CREDITS} credits and a round of changes costs ${EDIT_CREDITS}, and a new screen added in that round costs ${SCREEN_CREDITS} on top. If a build fails, you get back the credits for what it didn't finish.`,
  },
  {
    question: "Do my credits roll over?",
    answer: `Free credits never expire. Pro's monthly credits expire at each renewal and are replaced with a new ${PRO_MONTHLY_CREDITS.toLocaleString()}. Free credits you still have when you join Pro stay yours, and are used after the monthly ones.`,
  },
  {
    question: "Can I downgrade at any time?",
    answer: `Yes. You keep Pro until the end of the period you've paid for, and then move to Free. Your projects stay yours, even if you have more than ${PLANS.free.maxProjects}, but you can't start new ones beyond that.`,
  },
  {
    question: "Can I publish on the Free plan?",
    answer: "Yes, as a website with its own address. Building .aab, .apk, and .ipa files for the app stores is part of Pro.",
  },
]

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams

  return (
    <SignInDialogProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-background">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[700px] overflow-hidden">
          <div className="absolute -top-40 left-1/2 size-[520px] -translate-x-[110%] animate-blob rounded-full bg-indigo-300/40 blur-[100px]" />
          <div className="absolute -top-20 left-1/2 size-[480px] translate-x-[10%] animate-blob rounded-full bg-fuchsia-300/35 blur-[100px] [animation-delay:-6s]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
        </div>

        <SiteHeader />

        <main className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <section className="mx-auto max-w-2xl pt-14 pb-10 text-center sm:pt-20">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Simple pricing for building apps</h1>
            <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">
              Start free, and upgrade when you're ready to ship to the app stores.
            </p>
          </section>

          <PricingPlans checkout={checkout === "success"} />

          <section aria-labelledby="credit-costs" className="mx-auto mt-20 max-w-4xl">
            <h2 id="credit-costs" className="text-center text-2xl font-semibold tracking-tight">
              How credits work
            </h2>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CREDIT_COSTS.map(({ value, label, detail }) => (
                <li key={label} className="rounded-3xl border border-border/60 bg-white/70 p-5">
                  <p className="text-3xl font-semibold tracking-tight text-violet-700">
                    {value === 0 ? "Free" : `${value} ${value === 1 ? "credit" : "credits"}`}
                  </p>
                  <p className="mt-2 text-sm font-medium">{label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="questions" className="mx-auto mt-20 max-w-2xl">
            <h2 id="questions" className="text-center text-2xl font-semibold tracking-tight">
              Questions
            </h2>
            <Accordion className="mt-6">
              {QUESTIONS.map(({ question, answer }) => (
                <AccordionItem key={question} value={question}>
                  <AccordionTrigger>{question}</AccordionTrigger>
                  <AccordionContent>{answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
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
