"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, HammerIcon, LayoutListIcon } from "lucide-react"

import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import { buildCost } from "@/lib/plans"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type PlanCardState =
  /** The latest plan, waiting for confirmation. */
  | "pending"
  /** The latest plan, already confirmed and building or built. */
  | "confirmed"
  /** An earlier plan that a revision replaced. */
  | "superseded"

export function PlanCard({
  plan,
  state,
  screens,
  disabled,
  onConfirm,
}: {
  plan: AppPlan
  state: PlanCardState
  /** What's built so far, so a retry only shows the cost of what's left. */
  screens: ProjectScreen[]
  disabled?: boolean
  onConfirm?: () => void
}) {
  // Earlier versions start collapsed so the thread stays short.
  const [showScreens, setShowScreens] = React.useState(state !== "superseded")
  const [showDetails, setShowDetails] = React.useState(false)
  const colors = [plan.design.primaryColor, plan.design.accentColor, plan.design.backgroundColor]

  return (
    <section
      aria-label={`App plan: ${plan.appName}`}
      className={cn(
        "w-full overflow-hidden rounded-2xl border bg-white shadow-[0_12px_32px_-20px_rgba(76,29,149,0.4)]",
        state === "superseded" ? "border-border/60 opacity-70" : "border-violet-200/80"
      )}
    >
      <div className="bg-linear-to-br from-indigo-50 via-violet-50 to-fuchsia-50 px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-violet-700 uppercase">
            <LayoutListIcon className="size-3.5" />
            App plan
          </span>
          {state === "superseded" && (
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-muted-foreground">Earlier version</span>
          )}
          {state === "confirmed" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <CheckIcon className="size-3" />
              Confirmed
            </span>
          )}
        </div>
        <h3 className="mt-1.5 text-base font-semibold tracking-tight">{plan.appName}</h3>
        <p className="text-xs text-muted-foreground">{plan.tagline}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1" title={colors.join(", ")}>
            {colors.map((color) => (
              <span key={color} className="size-3.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />
            ))}
          </span>
          <span className="capitalize">{plan.design.mode} mode</span>
          <span>{plan.navigation === "tabs" ? "Tab navigation" : "Stack navigation"}</span>
        </div>
      </div>

      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => setShowScreens((s) => !s)}
          aria-expanded={showScreens}
          className="flex w-full items-center justify-between text-left text-xs font-semibold"
        >
          {plan.screens.length} screens
          <ChevronDownIcon className={cn("size-3.5 text-muted-foreground transition-transform", showScreens && "rotate-180")} />
        </button>

        {showScreens && (
          <>
            <ol className="mt-2.5 space-y-2.5">
              {plan.screens.map((screen, i) => (
                <li key={screen.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-700">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{screen.name}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{screen.purpose}</p>
                    {showDetails && (
                      <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
                        {screen.keyElements.map((element) => (
                          <li key={element} className="flex gap-1.5">
                            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-violet-400" />
                            {element}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              className="mt-2.5 text-xs font-medium text-violet-700 hover:underline"
            >
              {showDetails ? "Hide screen details" : "Show screen details"}
            </button>
          </>
        )}
      </div>

      {state === "pending" && onConfirm && (
        <div className="space-y-2 border-t border-border/60 px-4 py-3">
          <Button
            onClick={onConfirm}
            disabled={disabled}
            className="h-9 w-full rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30 hover:opacity-95"
          >
            <HammerIcon />
            Confirm & build {plan.screens.length} screens
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">Uses {buildCost(plan, screens)} credits. Want changes? Tell me in the chat below.</p>
        </div>
      )}
    </section>
  )
}
