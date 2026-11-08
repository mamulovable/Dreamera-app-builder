"use client"

import * as React from "react"

import type { AuthFields, AuthMode, FieldErrors } from "@/lib/auth-validation"
import type { PlanId } from "@/lib/plans"

export type SessionUser = {
  id: number
  name: string
  email: string
  image: string | null
  credits: number
  monthlyCredits: number
  plan: PlanId
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

type AuthResult =
  | { user: SessionUser; error?: undefined; fieldErrors?: undefined }
  | { user?: undefined; error: string; fieldErrors?: FieldErrors }

type AuthContextValue = {
  user: SessionUser | null
  isPending: boolean
  authenticate: (mode: AuthMode, fields: AuthFields) => Promise<AuthResult>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(null)
  const [isPending, setIsPending] = React.useState(true)

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" })
      const data = await res.json()
      setUser(data.user ?? null)
    } catch {
      setUser(null)
    } finally {
      setIsPending(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const authenticate = React.useCallback(
    async (mode: AuthMode, fields: AuthFields): Promise<AuthResult> => {
      try {
        const res = await fetch(`/api/auth/${mode}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fields),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.user) {
          return {
            error: data?.error ?? "Something went wrong. Please try again.",
            fieldErrors: data?.fieldErrors,
          }
        }
        setUser(data.user)
        return { user: data.user }
      } catch {
        return { error: "Can't reach the server. Check your connection and try again." }
      }
    },
    []
  )

  const signOut = React.useCallback(async () => {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => null)
    setUser(null)
  }, [])

  const value = React.useMemo(
    () => ({ user, isPending, authenticate, signOut, refresh }),
    [user, isPending, authenticate, signOut, refresh]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
