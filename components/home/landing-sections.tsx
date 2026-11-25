import Link from "next/link"
import {
  BriefcaseBusinessIcon,
  CheckIcon,
  GraduationCapIcon,
  ListChecksIcon,
  RocketIcon,
  StoreIcon,
  UsersIcon,
} from "lucide-react"

import {
  FREE_SIGNUP_CREDITS,
  PLANS,
  PRO_MONTHLY_CREDITS,
  PRO_PRICE_LABEL,
} from "@/lib/plans"
import { cn } from "@/lib/utils"
import {
  CreateMockup,
  DescribeMockup,
  FutureMockup,
  LimitsMockup,
  RefineMockup,
} from "@/components/home/feature-mockups"

const STEPS = [
  {
    number: "01",
    title: "Dream It",
    body: "Imagine the application you want to create. Think about its purpose, features and the problem it will solve. No technical knowledge needed.",
  },
  {
    number: "02",
    title: "Tell Dreamera",
    body: "Share your dream with Dreamera using simple, everyday language. Our AI understands your vision and helps transform it into an application.",
  },
  {
    number: "03",
    title: "Bring It to Life",
    body: "Watch your dream app take shape. Preview your creation, request changes, refine its features and move closer to launching something real.",
  },
]

const POSSIBILITIES = [
  {
    icon: BriefcaseBusinessIcon,
    title: "Dream of a business?",
    body: "Build the tools to manage and grow it.",
  },
  {
    icon: StoreIcon,
    title: "Dream of an online store?",
    body: "Create an e-commerce experience.",
  },
  {
    icon: UsersIcon,
    title: "Dream of a social platform?",
    body: "Bring your community together.",
  },
  {
    icon: GraduationCapIcon,
    title: "Dream of an educational platform?",
    body: "Create new learning experiences.",
  },
  {
    icon: ListChecksIcon,
    title: "Dream of a productivity app?",
    body: "Turn your ideas into useful everyday tools.",
  },
  {
    icon: RocketIcon,
    title: "Dream of the next big startup?",
    body: "Start building your MVP with Dreamera.",
  },
]

const FEATURES = [
  {
    id: "describe",
    title: "Describe, Don't Code",
    description: "Explain what you want in your own words.",
    use: "Write in everyday language, pick a platform, then choose Build, Plan, or Chat.",
    Mockup: DescribeMockup,
  },
  {
    id: "create",
    title: "Create With AI",
    description: "Let artificial intelligence help turn your vision into software.",
    use: "Watch screens appear in the live preview as Dreamera builds your app.",
    Mockup: CreateMockup,
  },
  {
    id: "refine",
    title: "Make It Yours",
    description: "Refine your creation until it reflects your dream.",
    use: "Ask for changes in chat and see the preview update in place.",
    Mockup: RefineMockup,
  },
  {
    id: "limits",
    title: "Dream Without Limits",
    description: "Explore ideas without being restricted by your coding knowledge.",
    use: "Start a business tool, store, social app, or learning product from one prompt.",
    Mockup: LimitsMockup,
  },
  {
    id: "future",
    title: "Build Your Future",
    description: "Take your ideas beyond imagination and towards reality.",
    use: "Publish a website on every plan. Pro also exports for the app stores.",
    Mockup: FutureMockup,
  },
] as const

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="text-xs font-semibold tracking-[0.22em] text-brand uppercase">
      {children}
    </p>
  )
}

export function HeroIntro() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
      <span className="mb-7 inline-flex items-center rounded-full border border-white/70 bg-white/60 px-4 py-1.5 text-xs font-medium text-brand-dark shadow-[0_4px_20px_-6px_rgba(124,58,237,0.35)] backdrop-blur-md">
        Your dream. Our AI. Your creation.
      </span>

      <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]">
        Got a dream app in mind?{" "}
        <span className="relative inline-block">
          <span className="animate-shimmer bg-linear-to-r from-brand via-brand-accent to-brand bg-size-[200%_auto] bg-clip-text text-transparent">
            Tell Dreamera.
          </span>
          <svg
            aria-hidden
            viewBox="0 0 300 20"
            preserveAspectRatio="none"
            className="absolute -bottom-2 left-0 h-3 w-full text-brand-accent sm:-bottom-3 sm:h-4"
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
        Describe your dream app. Dreamera&apos;s AI designs it, builds it, and
        brings it to life. No coding required.
      </p>
    </div>
  )
}

export function StorySections() {
  return (
    <div className="space-y-28 sm:space-y-36">
      <StepsSection />
      <FeatureStage />
      <PossibilitiesSection />
      <LandingPricing />
    </div>
  )
}

function StepsSection() {
  return (
    <section id="steps" className="scroll-mt-28">
      <div className="mx-auto max-w-2xl text-center">
        <Eyebrow>Three steps</Eyebrow>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
          From Dream to Reality in Three Steps
        </h2>
        <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">
          Your dream deserves more than just an idea. Let&apos;s build it.
        </p>
      </div>

      <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
        <div
          aria-hidden
          className="absolute top-7 right-[16%] left-[16%] hidden h-px bg-linear-to-r from-transparent via-brand-accent/60 to-transparent md:block"
        />
        {STEPS.map((step) => (
          <li key={step.number} className="relative text-center md:text-left">
            <span className="relative inline-flex size-14 items-center justify-center rounded-2xl bg-brand text-sm font-semibold text-white shadow-lg shadow-brand/30">
              {step.number}
            </span>
            <h3 className="mt-6 text-2xl font-semibold tracking-tight">
              {step.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-pretty text-muted-foreground">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FeatureStage() {
  return (
    <section id="why" className="scroll-mt-28">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/45 px-5 py-12 shadow-[0_40px_100px_-48px_rgba(76,29,149,0.45)] backdrop-blur-xl sm:rounded-[2.5rem] sm:px-10 sm:py-16 lg:px-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-brand/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 top-1/3 size-80 rounded-full bg-brand-accent/15 blur-3xl"
        />

        <div className="relative mx-auto max-w-2xl text-center">
          <Eyebrow>Why Dreamera</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
            Because dreams shouldn&apos;t require a computer science degree.
          </h2>
          <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">
            Dreamera makes software creation more accessible by bringing
            AI-powered development into a simple, intuitive experience.
          </p>
        </div>

        <div className="relative mt-16 space-y-20 sm:mt-20 sm:space-y-24">
          {FEATURES.map((feature, index) => {
            const visualLeft = index % 2 === 0
            const { Mockup } = feature
            return (
              <div
                key={feature.id}
                className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14"
              >
                <div className={cn(visualLeft ? "lg:order-1" : "lg:order-2")}>
                  <Mockup />
                </div>
                <div className={cn(visualLeft ? "lg:order-2" : "lg:order-1")}>
                  <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                    {feature.title}
                  </h3>
                  <p className="mt-4 text-base text-pretty text-muted-foreground sm:text-lg">
                    {feature.description}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-pretty text-foreground/80 sm:text-base">
                    {feature.use}
                  </p>
                  <a
                    href="#composer"
                    className="mt-7 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-semibold text-background transition-transform hover:scale-[1.03]"
                  >
                    Start dreaming
                  </a>
                </div>
              </div>
            )
          })}
        </div>

        <p className="relative mx-auto mt-16 max-w-xl text-center text-sm text-muted-foreground sm:mt-20 sm:text-base">
          Students, entrepreneurs, creators, and developers — Dreamera is for
          everyone who has an idea worth bringing to life.
        </p>
      </div>
    </section>
  )
}

function PossibilitiesSection() {
  return (
    <section id="possible" className="scroll-mt-28">
      <div className="mx-auto max-w-2xl text-center">
        <Eyebrow>Possibilities</Eyebrow>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl sm:leading-[1.1]">
          Whatever You Can Dream, You Can Start Building
        </h2>
        <p className="mt-4 text-base text-pretty text-muted-foreground">
          One dream can become something extraordinary.
        </p>
      </div>

      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {POSSIBILITIES.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex items-start gap-3 rounded-2xl border border-border/50 bg-white/50 px-4 py-4 backdrop-blur-sm"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand/15 to-brand-accent/20 text-brand-dark">
              <Icon className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LandingPricing() {
  const freeFeatures = [
    `${FREE_SIGNUP_CREDITS} one-time credits that never expire`,
    `${PLANS.free.maxProjects} projects`,
    `Up to ${PLANS.free.maxScreens} screens per project`,
    "Publish as a website",
  ]
  const proFeatures = [
    `${PRO_MONTHLY_CREDITS.toLocaleString()} credits every month`,
    "Unlimited projects",
    `Up to ${PLANS.pro.maxScreens} screens per project`,
    "Publish as a website",
    "Export for iOS and Android",
  ]

  return (
    <section id="pricing" className="scroll-mt-28">
      <div className="mx-auto max-w-2xl text-center">
        <Eyebrow>Pricing</Eyebrow>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
          Pricing plans for every need
        </h2>
        <p className="mt-5 text-base text-pretty text-muted-foreground sm:text-lg">
          Start free, and upgrade when you&apos;re ready to ship to the app stores.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl items-stretch gap-5 md:grid-cols-2">
        <article className="flex flex-col gap-6 rounded-[2rem] border border-white/80 bg-white/70 p-7 shadow-[0_24px_60px_-36px_rgba(76,29,149,0.35)] backdrop-blur-xl">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">{PLANS.free.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Start with a dream and build your first apps.
            </p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-5xl font-semibold tracking-tight">$0</span>
              <span className="text-sm text-muted-foreground">forever</span>
            </p>
          </div>
          <a
            href="#composer"
            className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-background px-5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Get started free
          </a>
          <ul className="space-y-3">
            {freeFeatures.map((item) => (
              <li key={item} className="flex gap-2.5 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand-dark">
                  <CheckIcon className="size-3" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="relative flex flex-col gap-6 overflow-hidden rounded-[2rem] bg-linear-to-br from-brand to-brand-dark p-7 text-white shadow-xl shadow-brand/30">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-brand-accent/30 blur-3xl"
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold tracking-tight">{PLANS.pro.name}</h3>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">
                Recommended
              </span>
            </div>
            <p className="mt-1 text-sm text-white/85">
              For people shipping apps every month.
            </p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-5xl font-semibold tracking-tight">{PRO_PRICE_LABEL}</span>
              <span className="text-sm text-white/80">per month</span>
            </p>
          </div>
          <Link
            href="/pricing"
            className="relative inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-brand-dark transition-transform hover:scale-[1.02]"
          >
            Upgrade to Pro
          </Link>
          <ul className="relative space-y-3">
            {proFeatures.map((item) => (
              <li key={item} className="flex gap-2.5 text-sm text-white/95">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                  <CheckIcon className="size-3" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </article>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Full details, credits, and checkout live on{" "}
        <Link href="/pricing" className="font-medium text-brand-dark underline-offset-4 hover:underline">
          the pricing page
        </Link>
        .
      </p>
    </section>
  )
}

export function ClosingCta() {
  return (
    <section className="relative overflow-hidden rounded-[2.5rem] border border-white/70 bg-white/55 px-6 py-16 text-center shadow-[0_40px_100px_-48px_rgba(76,29,149,0.4)] backdrop-blur-xl sm:px-12 sm:py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 left-1/2 size-72 -translate-x-1/2 rounded-full bg-brand/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 right-0 size-64 rounded-full bg-brand-accent/20 blur-3xl"
      />
      <div className="relative mx-auto max-w-3xl">
        <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]">
          Don&apos;t Just Dream About It. Build It.
        </h2>
        <div className="mt-6 space-y-4 text-base text-pretty text-muted-foreground sm:text-lg">
          <p>
            That app you&apos;ve been imagining? That business idea you&apos;ve
            been thinking about? That platform you wish existed?
          </p>
          <p>
            Tell Dreamera about your dream. Let&apos;s turn it into something
            real.
          </p>
        </div>
        <a
          href="#composer"
          className="mt-9 inline-flex h-12 items-center justify-center rounded-full bg-foreground px-6 text-sm font-semibold text-background shadow-lg transition-transform hover:scale-[1.03]"
        >
          Bring My Dream to Life
        </a>
        <p className="mt-5 text-sm text-muted-foreground italic">
          Dream it. Describe it. Dreamera builds it.
        </p>
      </div>
    </section>
  )
}
