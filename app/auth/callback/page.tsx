"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Logo } from "@/components/home/logo"

const PROVIDER_ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  unsupported_provider: "That sign-in option isn't available.",
}

export default function AuthCallbackPage() {
  const [error, setError] = React.useState<string | null>(null)
  const started = React.useRef(false)

  React.useEffect(() => {
    if (started.current) return
    started.current = true

    // The token arrives in the fragment; read it, then wipe it from the address bar.
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const state = new URLSearchParams(window.location.search).get("state") ?? ""
    const token = hash.get("token")
    const providerError = hash.get("error")
    window.history.replaceState(null, "", window.location.pathname)

    if (!token) {
      setError(
        (providerError && PROVIDER_ERRORS[providerError]) ||
          "Sign-in wasn't completed. Please try again."
      )
      return
    }

    fetch("/api/auth/social/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, state }),
    })
      .then(async (res) => {
        if (res.ok) {
          window.location.replace("/")
          return
        }
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Sign-in failed. Please try again.")
      })
      .catch(() =>
        setError("Can't reach the server. Check your connection and try again.")
      )
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <Logo showText={false} className="size-10" />
      {error ? (
        <>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Couldn&apos;t sign you in</h1>
            <p role="alert" className="text-sm text-muted-foreground">
              {error}
            </p>
          </div>
          <Button size="lg" className="h-10" nativeButton={false} render={<Link href="/" />}>
            Back to AppForge
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Signing you in…
        </p>
      )}
    </main>
  )
}
