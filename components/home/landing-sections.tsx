import {
  BriefcaseBusinessIcon,
  CodeIcon,
  CompassIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PenLineIcon,
  RocketIcon,
  SparklesIcon,
  StoreIcon,
  UsersIcon,
  WandSparklesIcon,
} from "lucide-react"

const DREAM_QUESTIONS = [
  "A business platform?",
  "An online marketplace?",
  "A productivity tool?",
  "The next big social application?",
]

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

const REASONS = [
  {
    icon: CompassIcon,
    title: "Dream Without Limits",
    body: "Explore ideas without being restricted by your coding knowledge.",
  },
  {
    icon: PenLineIcon,
    title: "Describe, Don't Code",
    body: "Explain what you want in your own words.",
  },
  {
    icon: SparklesIcon,
    title: "Create With AI",
    body: "Let artificial intelligence help turn your vision into software.",
  },
  {
    icon: WandSparklesIcon,
    title: "Make It Yours",
    body: "Refine your creation until it reflects your dream.",
  },
  {
    icon: RocketIcon,
    title: "Build Your Future",
    body: "Take your ideas beyond imagination and towards reality.",
  },
]

const DREAMERS = [
  {
    icon: GraduationCapIcon,
    title: "Students",
    body: "An exciting project.",
  },
  {
    icon: BriefcaseBusinessIcon,
    title: "Entrepreneurs",
    body: "A business idea.",
  },
  {
    icon: PenLineIcon,
    title: "Creators",
    body: "A vision.",
  },
  {
    icon: CodeIcon,
    title: "Developers",
    body: "Looking to work smarter.",
  },
]

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
    <div className="space-y-24 sm:space-y-32">
      <section id="dream" className="scroll-mt-28">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <Eyebrow>The dream</Eyebrow>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
              Every Great App Starts With a Dream
            </h2>
            <div className="mt-6 space-y-4 text-base text-pretty text-muted-foreground sm:text-lg">
              <p className="font-medium text-foreground">
                What&apos;s the app you&apos;ve always dreamed of building?
              </p>
              <p>
                A business platform? An online marketplace? A productivity
                tool? The next big social application?
              </p>
              <p>You don&apos;t have to keep that idea in your imagination.</p>
              <p>
                With Dreamera, you can turn your dreams into real software.
                Describe what you envision, explain how you want it to work,
                and watch your idea take shape.
              </p>
            </div>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {DREAM_QUESTIONS.map((question, index) => (
              <li
                key={question}
                className="h-full rounded-[1.75rem] border border-white/80 bg-white/75 p-5 shadow-[0_18px_40px_-28px_rgba(76,29,149,0.55)] backdrop-blur-md"
              >
                <span className="text-xs font-semibold tracking-[0.18em] text-brand-accent uppercase">
                  0{index + 1}
                </span>
                <p className="mt-3 text-lg font-medium tracking-tight text-balance">
                  {question}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <blockquote className="relative mt-10 overflow-hidden rounded-[2rem] border border-brand/20 bg-linear-to-r from-brand/5 via-white to-brand-accent/10 px-6 py-8 text-center sm:px-12 sm:py-10">
          <p className="text-xl font-medium tracking-tight text-balance sm:text-3xl">
            Your imagination sets the limit.{" "}
            <span className="bg-linear-to-r from-brand to-brand-accent bg-clip-text text-transparent">
              Dreamera helps make it happen.
            </span>
          </p>
        </blockquote>
      </section>

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

        <ol className="relative mt-12 grid gap-5 md:grid-cols-3">
          <div
            aria-hidden
            className="absolute top-16 right-[16%] left-[16%] hidden h-px bg-linear-to-r from-transparent via-brand-accent to-transparent md:block"
          />
          {STEPS.map((step) => (
            <li
              key={step.number}
              className="relative rounded-[2rem] border border-white/80 bg-white/80 p-7 shadow-[0_24px_50px_-32px_rgba(76,29,149,0.55)] backdrop-blur-md"
            >
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

      <section id="possible" className="scroll-mt-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Possibilities</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
            Whatever You Can Dream, You Can Start Building
          </h2>
          <p className="mt-5 text-lg font-medium text-foreground">
            One dream can become something extraordinary.
          </p>
          <p className="mt-3 text-base text-pretty text-muted-foreground sm:text-lg">
            Dreamera gives you the freedom to explore your ideas and create
            different kinds of software.
          </p>
        </div>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {POSSIBILITIES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="group rounded-[2rem] border border-border/60 bg-white/75 p-6 shadow-[0_18px_40px_-30px_rgba(76,29,149,0.45)] transition-transform duration-300 hover:-translate-y-1"
            >
              <span className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-brand/15 to-brand-accent/20 text-brand-dark transition-transform duration-300 group-hover:scale-105">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-8 max-w-xl text-center text-base text-pretty text-muted-foreground">
          Whatever your dream app looks like, Dreamera gives you a place to
          begin.
        </p>
      </section>

      <section id="why" className="scroll-mt-28">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-linear-to-br from-[#2e1065] via-brand-dark to-[#0f172a] px-6 py-14 text-white sm:px-10 sm:py-16 lg:px-14">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-brand-accent/30 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 bottom-0 size-72 rounded-full bg-brand/25 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.16)_1px,transparent_1px)] bg-size-[22px_22px] opacity-40"
          />

          <div className="relative mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-[0.22em] text-brand-accent uppercase">
              Why Dreamera
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
              Because dreams shouldn&apos;t require a computer science degree.
            </h2>
            <div className="mt-5 space-y-3 text-base text-pretty text-white/75 sm:text-lg">
              <p>
                You shouldn&apos;t need to be a professional developer to build
                something extraordinary.
              </p>
              <p>
                Dreamera makes software creation more accessible by bringing
                AI-powered development into a simple, intuitive experience.
              </p>
            </div>
          </div>

          <ul className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {REASONS.map(({ icon: Icon, title, body }, index) => (
              <li
                key={title}
                className={`rounded-[1.75rem] border border-white/10 bg-white/10 p-5 backdrop-blur-md lg:col-span-2 ${
                  index === 3 ? "lg:col-start-2" : ""
                }`}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-brand-accent">
                  <Icon className="size-4" />
                </span>
                <h3 className="mt-4 text-base font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="dreamers" className="scroll-mt-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Who it&apos;s for</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
            Who Can Dream With Dreamera?
          </h2>
          <div className="mt-5 space-y-4 text-base text-pretty text-muted-foreground sm:text-lg">
            <p className="font-medium text-foreground">
              Dreamers come in different forms. Dreamera welcomes them all.
            </p>
            <p>
              Whether you&apos;re a student with an exciting project, an
              entrepreneur with a business idea, a creator with a vision or a
              developer looking to work smarter, there&apos;s room for your
              dream here.
            </p>
            <p>Dreamera is for everyone who has an idea worth bringing to life.</p>
          </div>
        </div>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DREAMERS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="overflow-hidden rounded-[2rem] border border-border/60 bg-white/80 shadow-[0_18px_40px_-30px_rgba(76,29,149,0.45)]"
            >
              <div className="h-1.5 bg-brand" />
              <div className="p-6">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-brand/10 text-brand-dark">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function ClosingCta() {
  return (
    <section className="relative overflow-hidden rounded-[2.5rem] bg-linear-to-br from-brand to-brand-dark px-6 py-16 text-center text-white shadow-[0_30px_80px_-36px_rgba(124,58,237,0.8)] sm:px-12 sm:py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 size-72 -translate-x-1/2 rounded-full bg-white/20 blur-3xl"
      />
      <div className="relative mx-auto max-w-3xl">
        <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]">
          Don&apos;t Just Dream About It. Build It.
        </h2>
        <div className="mt-6 space-y-4 text-base text-pretty text-white/85 sm:text-lg">
          <p>
            That app you&apos;ve been imagining? That business idea you&apos;ve
            been thinking about? That platform you wish existed?
          </p>
          <p>It&apos;s time to stop wondering what could be.</p>
          <p>
            Tell Dreamera about your dream. Let&apos;s turn it into something
            real.
          </p>
        </div>
        <a
          href="#composer"
          className="mt-9 inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-brand-dark shadow-lg transition-transform hover:scale-[1.03]"
        >
          Bring My Dream to Life
        </a>
        <p className="mt-5 text-sm text-white/80 italic">
          Dream it. Describe it. Dreamera builds it.
        </p>
      </div>
    </section>
  )
}
