import Image from "next/image"
import {
  GlobeIcon,
  MessageSquareIcon,
  MonitorSmartphoneIcon,
  SendIcon,
  SmartphoneIcon,
  SparklesIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

type MockupProps = {
  /** Optional real screenshot — when set, replaces the CSS sketch. */
  imageSrc?: string
  imageAlt?: string
  className?: string
}

function Frame({
  children,
  className,
  imageSrc,
  imageAlt,
}: {
  children: React.ReactNode
  className?: string
  imageSrc?: string
  imageAlt?: string
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/70 shadow-[0_28px_60px_-36px_rgba(76,29,149,0.55)] backdrop-blur-xl",
        className
      )}
    >
      {imageSrc ? (
        <div className="relative aspect-[4/3] w-full">
          <Image src={imageSrc} alt={imageAlt ?? ""} fill className="object-cover" sizes="(max-width: 768px) 100vw, 480px" />
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export function DescribeMockup({ imageSrc, imageAlt, className }: MockupProps) {
  return (
    <Frame imageSrc={imageSrc} imageAlt={imageAlt} className={className}>
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {["iOS & Android", "Build", "Plan", "Chat"].map((label, i) => (
            <span
              key={label}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                i === 0 || i === 1
                  ? "bg-brand text-white shadow-sm shadow-brand/30"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            A marketplace where local makers sell what they create, with carts, profiles, and live order tracking…
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">Press Enter to build</span>
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand text-white shadow-md shadow-brand/25">
              <SendIcon className="size-3.5" />
            </span>
          </div>
        </div>
      </div>
    </Frame>
  )
}

export function CreateMockup({ imageSrc, imageAlt, className }: MockupProps) {
  return (
    <Frame imageSrc={imageSrc} imageAlt={imageAlt} className={cn("p-5 sm:p-6", className)}>
      <div className="mx-auto w-[148px] rounded-[1.6rem] border border-foreground/15 bg-foreground p-2 shadow-xl shadow-black/20">
        <div className="overflow-hidden rounded-[1.25rem] bg-white">
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted" />
          <div className="space-y-3 px-3 pt-4 pb-5">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-brand/15 text-brand">
                <SparklesIcon className="size-3.5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold text-foreground">Home</p>
                <p className="text-[9px] text-muted-foreground">Your app preview</p>
              </div>
            </div>
            <div className="h-16 rounded-xl bg-linear-to-br from-brand/20 to-brand-accent/20" />
            <div className="space-y-1.5">
              <div className="h-2 w-[80%] rounded-full bg-muted" />
              <div className="h-2 w-[60%] rounded-full bg-muted" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="h-12 rounded-xl bg-muted/80" />
              <div className="h-12 rounded-xl bg-muted/80" />
            </div>
            <div className="h-8 rounded-full bg-brand" />
          </div>
        </div>
      </div>
    </Frame>
  )
}

export function RefineMockup({ imageSrc, imageAlt, className }: MockupProps) {
  return (
    <Frame imageSrc={imageSrc} imageAlt={imageAlt} className={className}>
      <div className="grid grid-cols-[1.1fr_0.9fr] gap-3 p-4 sm:p-5">
        <div className="space-y-2.5 rounded-2xl border border-border/60 bg-background/70 p-3">
          <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-[10px] leading-snug text-white">
            Make the home screen calmer and add a streak chart
          </div>
          <div className="flex max-w-[95%] gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
              <MessageSquareIcon className="size-2.5" />
            </span>
            <div className="rounded-2xl rounded-tl-md bg-muted/80 px-3 py-2 text-[10px] leading-snug text-muted-foreground">
              Done — soft greens, weekly chart, and a clearer habit list.
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-dashed border-border/80 px-2.5 py-2">
            <span className="text-[10px] text-muted-foreground">Ask for changes…</span>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[110px] self-center rounded-[1.35rem] border border-foreground/15 bg-foreground p-1.5">
          <div className="overflow-hidden rounded-[1.05rem] bg-white p-2.5">
            <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-muted" />
            <div className="h-8 rounded-lg bg-emerald-100/80" />
            <div className="mt-2 space-y-1">
              <div className="h-1.5 w-full rounded-full bg-muted" />
              <div className="h-1.5 w-[66%] rounded-full bg-muted" />
            </div>
            <div className="mt-2 h-10 rounded-lg bg-linear-to-t from-brand/20 to-brand-accent/10" />
          </div>
        </div>
      </div>
    </Frame>
  )
}

export function LimitsMockup({ imageSrc, imageAlt, className }: MockupProps) {
  const cards = [
    { title: "Business", tint: "from-brand/20 to-brand/5" },
    { title: "Store", tint: "from-brand-accent/25 to-brand-accent/5" },
    { title: "Social", tint: "from-violet-200/80 to-violet-50" },
    { title: "Learn", tint: "from-cyan-100 to-white" },
  ]

  return (
    <Frame imageSrc={imageSrc} imageAlt={imageAlt} className={className}>
      <div className="grid grid-cols-2 gap-3 p-5 sm:gap-4 sm:p-6">
        {cards.map((card, i) => (
          <div
            key={card.title}
            className={cn(
              "rounded-2xl border border-white/80 bg-linear-to-br p-3 shadow-sm",
              card.tint,
              i % 2 === 1 && "translate-y-3"
            )}
          >
            <div className="flex size-8 items-center justify-center rounded-xl bg-white/80 text-brand-dark">
              <MonitorSmartphoneIcon className="size-3.5" />
            </div>
            <p className="mt-3 text-xs font-semibold tracking-tight">{card.title}</p>
            <div className="mt-2 space-y-1">
              <div className="h-1.5 w-full rounded-full bg-white/70" />
              <div className="h-1.5 w-2/3 rounded-full bg-white/50" />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

export function FutureMockup({ imageSrc, imageAlt, className }: MockupProps) {
  return (
    <Frame imageSrc={imageSrc} imageAlt={imageAlt} className={className}>
      <div className="space-y-3 p-5 sm:p-6">
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <GlobeIcon className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">Publish as a website</p>
              <p className="text-xs text-muted-foreground">Live on every plan</p>
            </div>
            <span className="ml-auto rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              Live
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-brand/20 bg-linear-to-br from-brand to-brand-deep p-4 text-white shadow-lg shadow-brand/25">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-white/15">
              <SmartphoneIcon className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">Export for iOS & Android</p>
              <p className="text-xs text-white/75">Included with Pro</p>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  )
}
