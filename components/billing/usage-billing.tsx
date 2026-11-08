"use client"

import * as React from "react"

import { useAuth, type SessionUser } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PlanUsage } from "@/components/billing/plan-usage"
import { LoadFailed, useProjectList } from "@/components/home/projects-section"
import { useSignInDialog } from "@/components/home/sign-in-dialog"

const USAGE_SKELETON = <Skeleton aria-busy="true" className="h-40 rounded-[2rem] sm:h-32" />

export function UsageBilling() {
  const { user, isPending, refresh } = useAuth()
  const { openSignIn } = useSignInDialog()

  // The session is only loaded once per visit, and builds spend credits after that.
  React.useEffect(() => {
    void refresh()
  }, [refresh])

  if (isPending) return USAGE_SKELETON
  if (user) return <SignedInUsage user={user} />
  return (
    <div className="flex flex-col items-center gap-3 rounded-[2rem] border border-border/60 bg-muted/40 px-6 py-14 text-center">
      <p className="text-sm text-muted-foreground">Sign in to see your usage and billing.</p>
      <Button className="h-10 rounded-full px-5" onClick={() => openSignIn("sign-in")}>
        Sign in
      </Button>
    </div>
  )
}

function SignedInUsage({ user }: { user: SessionUser }) {
  const { projects, failed, reload } = useProjectList("/api/projects")

  if (failed && !projects) return <LoadFailed what="your usage" onRetry={reload} />
  if (!projects) return USAGE_SKELETON
  return <PlanUsage user={user} projectCount={projects.length} />
}
