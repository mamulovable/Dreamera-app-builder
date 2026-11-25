"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AiProviderName, BuilderRoute } from "@/lib/agent/provider-settings"

function priceField(value: number) {
  return value > 0 ? String(value) : ""
}

type ModelPriceFields = Record<string, { input: string; output: string }>

function fieldsFromRoute(route: BuilderRoute, models: string[]): ModelPriceFields {
  const fields: ModelPriceFields = {}
  for (const model of models) {
    const price = route.modelPrices[model]
    fields[model] = {
      input: price ? priceField(price.input) : "",
      output: price ? priceField(price.output) : "",
    }
  }
  return fields
}

const PROVIDERS: AiProviderName[] = ["cloudhike", "gemini", "openrouter"]
const NAMES: Record<AiProviderName, string> = {
  cloudhike: "CloudHike",
  gemini: "Gemini",
  openrouter: "OpenRouter",
}

export function BuilderProviderForm({
  route,
  modelsUsed,
}: {
  route: BuilderRoute
  modelsUsed: string[]
}) {
  const router = useRouter()
  const knownModels = React.useMemo(() => {
    const set = new Set<string>([
      ...modelsUsed,
      ...Object.keys(route.modelPrices),
      route.plannerModel,
      route.builderModel,
    ])
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [modelsUsed, route.modelPrices, route.plannerModel, route.builderModel])

  const [primary, setPrimary] = React.useState<AiProviderName>(route.primary)
  const [overrides, setOverrides] = React.useState(route.overrides)
  const [inputPrice, setInputPrice] = React.useState(priceField(route.inputPricePerMillion))
  const [outputPrice, setOutputPrice] = React.useState(priceField(route.outputPricePerMillion))
  const [modelPrices, setModelPrices] = React.useState(() => fieldsFromRoute(route, knownModels))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ok, setOk] = React.useState<string | null>(null)

  React.useEffect(() => {
    setModelPrices((previous) => {
      const next = { ...previous }
      for (const model of knownModels) {
        if (!next[model]) {
          const price = route.modelPrices[model]
          next[model] = {
            input: price ? priceField(price.input) : "",
            output: price ? priceField(price.output) : "",
          }
        }
      }
      return next
    })
  }, [knownModels, route.modelPrices])

  const current = overrides[primary]
  const defaults = route.defaults[primary]
  const otherReady = PROVIDERS.find((name) => name !== primary && route.ready[name])
  const fallbackHint =
    route.fallback !== "none" ? NAMES[route.fallback] : otherReady ? NAMES[otherReady] : null

  function setModel(field: "planner" | "builder", value: string) {
    setOverrides((previous) => ({
      ...previous,
      [primary]: { ...previous[primary], [field]: value },
    }))
  }

  function setModelPrice(model: string, field: "input" | "output", value: string) {
    setModelPrices((previous) => ({
      ...previous,
      [model]: { ...previous[model], [field]: value },
    }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const pricesPayload: Record<string, { input: string; output: string }> = {}
      for (const model of knownModels) {
        const row = modelPrices[model] ?? { input: "", output: "" }
        pricesPayload[model] = { input: row.input.trim(), output: row.output.trim() }
      }
      const response = await fetch("/api/admin/builder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primary,
          cloudhikePlannerModel: overrides.cloudhike.planner ?? "",
          cloudhikeBuilderModel: overrides.cloudhike.builder ?? "",
          geminiPlannerModel: overrides.gemini.planner ?? "",
          geminiBuilderModel: overrides.gemini.builder ?? "",
          openrouterPlannerModel: overrides.openrouter.planner ?? "",
          openrouterBuilderModel: overrides.openrouter.builder ?? "",
          inputPricePerMillion: inputPrice.trim(),
          outputPricePerMillion: outputPrice.trim(),
          modelPrices: pricesPayload,
        }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error ?? "Couldn't save the provider.")
      setOk(`Saved. App costs use each model's own token prices.`)
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
            {PROVIDERS.map((name) => (
              <option key={name} value={name} disabled={!route.ready[name]}>
                {NAMES[name]}
                {route.ready[name] ? "" : " (not set up)"}
              </option>
            ))}
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

      <div className="space-y-3 rounded-xl border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Model token prices (USD per 1M)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Each app is billed from the models that actually built it. Leave a model blank to use the default below. App cost is
            the build cost times two.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="builder-input-price">Default input</Label>
            <Input
              id="builder-input-price"
              inputMode="decimal"
              value={inputPrice}
              placeholder="0"
              disabled={busy}
              onChange={(event) => setInputPrice(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="builder-output-price">Default output</Label>
            <Input
              id="builder-output-price"
              inputMode="decimal"
              value={outputPrice}
              placeholder="0"
              disabled={busy}
              onChange={(event) => setOutputPrice(event.target.value)}
            />
          </div>
        </div>
        {knownModels.length === 0 ? (
          <p className="text-sm text-muted-foreground">Models show up here after the first planner or builder call.</p>
        ) : (
          <div className="space-y-3">
            {knownModels.map((model) => {
              const row = modelPrices[model] ?? { input: "", output: "" }
              return (
                <div key={model} className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`model-price-${model}`}>Model</Label>
                    <Input id={`model-price-${model}`} value={model} readOnly disabled className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`model-input-${model}`}>Input / 1M</Label>
                    <Input
                      id={`model-input-${model}`}
                      inputMode="decimal"
                      value={row.input}
                      placeholder={inputPrice || "0"}
                      disabled={busy}
                      onChange={(event) => setModelPrice(model, "input", event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`model-output-${model}`}>Output / 1M</Label>
                    <Input
                      id={`model-output-${model}`}
                      inputMode="decimal"
                      value={row.output}
                      placeholder={outputPrice || "0"}
                      disabled={busy}
                      onChange={(event) => setModelPrice(model, "output", event.target.value)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !route.ready[primary]}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Leave a model blank to keep the default.
          {fallbackHint ? ` ${fallbackHint} stays the fallback.` : " No other provider has a key, so there is no fallback."}
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {ok ? <p className="text-sm text-emerald-700">{ok}</p> : null}
    </form>
  )
}
