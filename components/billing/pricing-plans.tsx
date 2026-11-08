"use client"

import Link from "next/link"
import * as React from "react"
import { format } from "date-fns"
import { CheckIcon, Loader2Icon, MinusIcon, SparklesIcon } from "lucide-react"

import { useAuth } from "@/lib/auth-client"
import {
  EDIT_CREDITS,
  FREE_SIGNUP_CREDITS,
  PLANS,
  PRO_MONTHLY_CREDITS,
  PRO_PRICE_LABEL,
  SMALL_APP_CREDITS,
  type PlanId,
} from "@/lib/plans"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useBillingRedirect } from "@/components/billing/upgrade-dialog"
import { useSignInDialog } from "@/components/home/sign-in-dialog"

const FEATURES: { label: string; free: string | boolean; pro: string | boolean }[] = [
  {
    label: "Credits",
    free: `${FREE_SIGNUP_CREDITS} one-time credits that never expire`,
    pro: `${PRO_MONTHLY_CREDITS.toLocaleString()} credits every month. Unused ones expire at renewal`,
  },
  {
    label: "What they build",
    free: `About ${Math.floor((FREE_SIGNUP_CREDITS - 4 * EDIT_CREDITS) / SMALL_APP_CREDITS)} small apps and 4 edits`,
    pro: `About ${PRO_MONTHLY_CREDITS / SMALL_APP_CREDITS} small apps or ${PRO_MONTHLY_CREDITS / EDIT_CREDITS} edits`,
  },
  { label: "Projects", free: `${PLANS.free.maxProjects} projects`, pro: "Unlimited projects" },
  { label: "Screens", free: `Up to ${PLANS.free.maxScreens} screens per project`, pro: `Up to ${PLANS.pro.maxScreens} screens per project` },
  { label: "Web", free: "Publish as a website", pro: "Publish as a website" },
  { label: "App stores", free: false, pro: "Export for iOS and Android" },
]

/** `checkout` is how the browser's trip to Stripe went, when it has just come back. */
export function PricingPlans({ checkout }: { checkout: boolean }) {
  const { user, isPending, refresh } = useAuth()
  const { redirect, pending, error: redirectError } = useBillingRedirect()
  const { openSignIn } = useSignInDialog()
  const [waitingForPayment, setWaitingForPayment] = React.useState(checkout)
  const [changing, setChanging] = React.useState(false)
  const [changeError, setChangeError] = React.useState<string | null>(null)
  const [confirmDowngrade, setConfirmDowngrade] = React.useState(false)

  const isPro = user?.plan === "pro"

  // Stripe tells the server by webhook, which can land a moment after the browser is back.
  React.useEffect(() => {
    if (!waitingForPayment) return
    if (isPro) return setWaitingForPayment(false)
    const timer = setInterval(() => void refresh(), 2000)
    const giveUp = setTimeout(() => setWaitingForPayment(false), 30_000)
    return () => {
      clearInterval(timer)
      clearTimeout(giveUp)
    }
  }, [isPro, refresh, waitingForPayment])

  async function change(action: "downgrade" | "keep-pro") {
    setChanging(true)
    setChangeError(null)
    const response = await fetch("/api/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null)
    if (response?.ok) {
      await refresh()
    } else {
      const body = await response?.json().catch(() => null)
      setChangeError(body?.error ?? "Couldn't reach the server. Check your connection and try again.")
    }
    setChanging(false)
    setConfirmDowngrade(false)
  }

  const endsOn = user?.currentPeriodEnd ? format(new Date(user.currentPeriodEnd), "MMMM d, yyyy") : null
  const error = redirectError ?? changeError

  return (
    <div className="space-y-6">
      {checkout && (waitingForPayment || isPro) && (
        <p role="status" className="mx-auto flex w-fit items-center gap-2 rounded-full bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-800">
          {isPro ? <CheckIcon className="size-4" /> : <Loader2Icon className="size-4 animate-spin" />}
          {isPro ? "Welcome to Pro! Your credits are ready." : "Confirming your payment…"}
        </p>
      )}
      {checkout && !waitingForPayment && !isPro && !isPending && (
        <p role="status" className="mx-auto w-fit rounded-full bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-800">
          Your payment is still being confirmed. This page will show Pro once it's through, so check back in a minute.
        </p>
      )}
      {error && (
        <p role="alert" className="mx-auto w-fit rounded-full bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mx-auto grid max-w-4xl items-stretch gap-5 md:grid-cols-2">
        <PlanCard
          plan="free"
          current={!isPending && !!user && !isPro}
          tagline="Try AppForge and build your first apps."
          price="$0"
          period="forever"
          action={
            isPending ? (
              <Skeleton className="h-11 rounded-full" />
            ) : !user ? (
              <Button variant="outline" className="h-11 w-full rounded-full" onClick={() => openSignIn("sign-up")}>
                Get started free
              </Button>
            ) : !isPro ? (
              <Button variant="outline" className="h-11 w-full rounded-full" render={<Link href="/" />} nativeButton={false}>
                Build an app
              </Button>
            ) : user.cancelAtPeriodEnd ? (
              <p className="flex h-11 items-center justify-center text-center text-sm text-muted-foreground">Your plan moves here on {endsOn}</p>
            ) : (
              <Button variant="outline" className="h-11 w-full rounded-full" disabled={changing} onClick={() => setConfirmDowngrade(true)}>
                Downgrade to Free
              </Button>
            )
          }
        />

        <PlanCard
          plan="pro"
          featured
          current={isPro}
          tagline="For people shipping apps every month."
          price={PRO_PRICE_LABEL}
          period="per month"
          action={
            isPending ? (
              <Skeleton className="h-11 rounded-full" />
            ) : !user ? (
              <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" onClick={() => openSignIn("sign-up")}>
                <SparklesIcon />
                Sign up to join Pro
              </Button>
            ) : !isPro ? (
              <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" disabled={pending} onClick={() => void redirect("upgrade")}>
                {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                Upgrade to Pro
              </Button>
            ) : (
              <div className="space-y-2">
                {user.cancelAtPeriodEnd ? (
                  <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" disabled={changing} onClick={() => void change("keep-pro")}>
                    {changing && <Loader2Icon className="animate-spin" />}
                    Keep Pro
                  </Button>
                ) : (
                  <Button className="h-11 w-full rounded-full bg-white text-violet-700 hover:bg-white/90" disabled={pending} onClick={() => void redirect("manage")}>
                    {pending && <Loader2Icon className="animate-spin" />}
                    Manage billing
                  </Button>
                )}
                {endsOn && (
                  <p className="text-center text-xs text-white/80">
                    {user.cancelAtPeriodEnd ? `Pro ends on ${endsOn}` : `Renews on ${endsOn}`}
                  </p>
                )}
              </div>
            )
          }
        />
      </div>

      <AlertDialog open={confirmDowngrade} onOpenChange={setConfirmDowngrade}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Downgrade to Free?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll keep Pro until {endsOn ?? "the end of this billing period"}, and won't be charged again. Then your monthly credits end, and you can't export for iOS or Android, or start new projects beyond {PLANS.free.maxProjects}. The projects you've already made stay yours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep Pro</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={changing}
              onClick={(event) => {
                event.preventDefault()
                void change("downgrade")
              }}
            >
              {changing && <Loader2Icon className="animate-spin" />}
              Downgrade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PlanCard({
  plan,
  featured = false,
  current,
  tagline,
  price,
  period,
  action,
}: {
  plan: PlanId
  featured?: boolean
  current: boolean
  tagline: string
  price: string
  period: string
  action: React.ReactNode
}) {
  return (
    <section
      aria-label={`${PLANS[plan].name} plan`}
      className={cn(
        "relative flex flex-col gap-6 rounded-[2rem] p-7",
        featured
          ? "bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-xl shadow-violet-500/30"
          : "border border-border/60 bg-white/70 shadow-[0_8px_32px_-12px_rgba(76,29,149,0.15)] backdrop-blur-xl"
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{PLANS[plan].name}</h2>
          {current && (
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", featured ? "bg-white/20" : "bg-violet-500/10 text-violet-700")}>Current plan</span>
          )}
        </div>
        <p className={cn("mt-1 text-sm", featured ? "text-white/85" : "text-muted-foreground")}>{tagline}</p>
        <p className="mt-5 flex items-baseline gap-1.5">
          <span className="text-5xl font-semibold tracking-tight">{price}</span>
          <span className={cn("text-sm", featured ? "text-white/80" : "text-muted-foreground")}>{period}</span>
        </p>
      </div>

      {action}

      <ul className="space-y-3">
        {FEATURES.map((feature) => {
          const value = feature[plan]
          return (
            <li key={feature.label} className={cn("flex gap-2.5 text-sm", !value && "text-muted-foreground")}>
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                  featured ? "bg-white/20" : value ? "bg-violet-500/10 text-violet-700" : "bg-muted"
                )}
              >
                {value ? <CheckIcon className="size-3" /> : <MinusIcon className="size-3" />}
              </span>
              {value || "No iOS or Android export"}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
