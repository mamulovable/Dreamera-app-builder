"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AiProviderName, BuilderRoute } from "@/lib/agent/provider-settings"

const NAMES: Record<AiProviderName, string> = { cloudhike: "CloudHike", gemini: "Gemini" }

export function BuilderProviderForm({ route }: { route: BuilderRoute }) {
  const router = useRouter()
  const [primary, setPrimary] = React.useState<AiProviderName>(route.primary)
  const [overrides, setOverrides] = React.useState(route.overrides)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ok, setOk] = React.useState<string | null>(null)

  const current = overrides[primary]
  const defaults = route.defaults[primary]
  const fallback = primary === "cloudhike" ? "gemini" : "cloudhike"

  function setModel(field: "planner" | "builder", value: string) {
    setOverrides((previous) => ({
      ...previous,
      [primary]: { ...previous[primary], [field]: value },
    }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const response = await fetch("/api/admin/builder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primary,
          cloudhikePlannerModel: overrides.cloudhike.planner ?? "",
          cloudhikeBuilderModel: overrides.cloudhike.builder ?? "",
          geminiPlannerModel: overrides.gemini.planner ?? "",
          geminiBuilderModel: overrides.gemini.builder ?? "",
        }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error ?? "Couldn't save the provider.")
      setOk(`The builder now uses ${NAMES[primary]}.`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the provider.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        Now using {NAMES[route.primary]}. Planner {route.plannerModel}. Builder {route.builderModel}.
        {route.fallback === "none" ? " No fallback is set." : ` If it fails before any output, ${NAMES[route.fallback]} answers.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="builder-provider">Provider</Label>
          <select
            id="builder-provider"
            value={primary}
            disabled={busy}
            onChange={(event) => setPrimary(event.target.value as AiProviderName)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <option value="cloudhike" disabled={!route.ready.cloudhike}>
              CloudHike{route.ready.cloudhike ? "" : " (not set up)"}
            </option>
            <option value="gemini" disabled={!route.ready.gemini}>
              Gemini{route.ready.gemini ? "" : " (not set up)"}
            </option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="builder-planner-model">Planner model</Label>
          <Input
            id="builder-planner-model"
            value={current.planner ?? ""}
            placeholder={defaults.planner}
            disabled={busy}
            onChange={(event) => setModel("planner", event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="builder-model">Builder model</Label>
          <Input
            id="builder-model"
            value={current.builder ?? ""}
            placeholder={defaults.builder}
            disabled={busy}
            onChange={(event) => setModel("builder", event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !route.ready[primary]}>
          {busy ? "Saving…" : "Save provider"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Leave a model blank to keep the default. {route.ready[fallback] ? `${NAMES[fallback]} stays the fallback.` : `${NAMES[fallback]} has no key, so there is no fallback.`}
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {ok ? <p className="text-sm text-emerald-700">{ok}</p> : null}
    </form>
  )
}
