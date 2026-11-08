"use client"

import Link from "next/link"
import * as React from "react"
import { CheckIcon, CoinsIcon, FolderPlusIcon, LayersIcon, Loader2Icon, SmartphoneIcon, SparklesIcon, type LucideIcon } from "lucide-react"
import { format } from "date-fns"

import { useAuth } from "@/lib/auth-client"
import { PLANS, PRO_MONTHLY_CREDITS, PRO_PRICE_LABEL, type UpgradeReason } from "@/lib/plans"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const REASONS: Record<UpgradeReason, { icon: LucideIcon; title: string; description: string }> = {
  projects: {
    icon: FolderPlusIcon,
    title: "You've used your free projects",
    description: `The Free plan includes ${PLANS.free.maxProjects} projects. Join Pro to build as many as you like.`,
  },
  screens: {
    icon: LayersIcon,
    title: "This app needs more screens",
    description: `The Free plan allows ${PLANS.free.maxScreens} screens per project. Join Pro to build up to ${PLANS.pro.maxScreens}.`,
  },
  credits: {
    icon: CoinsIcon,
    title: "You're out of credits",
    description: "You don't have enough credits for this. Join Pro to get a fresh set every month.",
  },
  "native-publish": {
    icon: SmartphoneIcon,
    title: "Publish to the app stores with Pro",
    description: "Exporting for iOS and Android is part of Pro. On Free, you can still publish your app as a website.",
  },
}

const PRO_HIGHLIGHTS = [
  `${PRO_MONTHLY_CREDITS.toLocaleString()} credits every month`,
  "Unlimited projects",
  `Up to ${PLANS.pro.maxScreens} screens per project`,
  "Export for iOS and Android",
]

/** Sends the browser to a billing page from `/api/billing`. */
export function useBillingRedirect() {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const redirect = React.useCallback(async (action: "upgrade" | "manage") => {
    setPending(true)
    setError(null)
    const response = await fetch("/api/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok && body?.url) {
      // Stays pending until the browser has left.
      window.location.href = body.url
      return
    }
    setPending(false)
    setError(body?.error ?? "Couldn't reach the server. Check your connection and try again.")
  }, [])

  return { redirect, pending, error }
}

const UpgradeDialogContext = React.createContext<((reason: UpgradeReason) => void) | null>(null)

/** Opens the popup explaining a plan limit the person ran into. */
export function useUpgradeDialog() {
  const openUpgrade = React.useContext(UpgradeDialogContext)
  if (!openUpgrade) throw new Error("useUpgradeDialog must be used within UpgradeDialogProvider")
  return openUpgrade
}

export function UpgradeDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  // Stays on its reason while the dialog animates closed.
  const [reason, setReason] = React.useState<UpgradeReason>("credits")
  const openUpgrade = React.useCallback((next: UpgradeReason) => {
    setReason(next)
    setOpen(true)
  }, [])

  return (
    <UpgradeDialogContext.Provider value={openUpgrade}>
      {children}
      <UpgradeDialog reason={reason} open={open} onOpenChange={setOpen} />
    </UpgradeDialogContext.Provider>
  )
}

function UpgradeDialog({ reason, open, onOpenChange }: { reason: UpgradeReason; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  const { redirect, pending, error } = useBillingRedirect()
  const { icon: Icon, title, description } = REASONS[reason]
  const alreadyPro = user?.plan === "pro"

  if (alreadyPro) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-sm">
          <DialogHeader className="items-center text-center">
            <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
              <CoinsIcon className="size-5" />
            </span>
            <DialogTitle className="text-lg font-semibold tracking-tight">You've used this month's credits</DialogTitle>
            <DialogDescription>
              {user.currentPeriodEnd && !user.cancelAtPeriodEnd
                ? `You'll get ${PRO_MONTHLY_CREDITS.toLocaleString()} more when Pro renews on ${format(new Date(user.currentPeriodEnd), "MMMM d")}.`
                : "You don't have enough credits left for this."}
            </DialogDescription>
          </DialogHeader>
          <Button variant="outline" className="h-10 rounded-full" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 overflow-hidden rounded-3xl p-0 sm:max-w-md">
        <div className="bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-6 pt-6 pb-5 text-white">
          <span className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <Icon className="size-5" />
          </span>
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="text-xl font-semibold tracking-tight text-white">{title}</DialogTitle>
            <DialogDescription className="text-white/85">{description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 pb-6">
          <ul className="space-y-2">
            {PRO_HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-700">
                  <CheckIcon className="size-3" />
                </span>
                {item}
              </li>
            ))}
          </ul>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Button
              className="h-11 w-full rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30 hover:opacity-95"
              disabled={pending}
              onClick={() => void redirect("upgrade")}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
              Join Pro for {PRO_PRICE_LABEL}/month
            </Button>
            <Button variant="ghost" className="h-10 w-full rounded-full text-muted-foreground" render={<Link href="/pricing" />} nativeButton={false} onClick={() => onOpenChange(false)}>
              Compare plans
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
