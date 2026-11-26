"use client"

import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CompassIcon,
  HammerIcon,
  PencilLineIcon,
  SparklesIcon,
} from "lucide-react"

import type { ChangePlan, PlanQuestion } from "@/lib/agent-protocol"
import { EDIT_CREDITS } from "@/lib/plans"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type PlanQuestionsCardState = "pending" | "answered"

export function PlanQuestionsCard({
  questions,
  state,
  disabled,
  isBuiltProject,
  onSubmitAnswers,
}: {
  questions: PlanQuestion[]
  state: PlanQuestionsCardState
  disabled?: boolean
  isBuiltProject?: boolean
  onSubmitAnswers?: (formattedMessage: string) => void
}) {
  const [expanded, setExpanded] = React.useState(state === "pending")
  const [step, setStep] = React.useState(0)
  const [answers, setAnswers] = React.useState<Record<string, string>>({})
  const [customOpen, setCustomOpen] = React.useState<Record<string, boolean>>({})
  const [customValues, setCustomValues] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (state === "answered") setExpanded(false)
  }, [state])

  const currentIndex = Math.min(step, questions.length - 1)
  const current = questions[currentIndex]
  const answeredCount = questions.filter((q) => Boolean(answers[q.id]?.trim())).length
  const allAnswered = answeredCount === questions.length

  function selectOption(questionId: string, label: string) {
    if (disabled || state !== "pending") return
    setCustomOpen((prev) => ({ ...prev, [questionId]: false }))
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: label }
      // Advance smoothly to the next unanswered step so picking options takes single clicks.
      const nextUnanswered = questions.findIndex((q, idx) => idx > currentIndex && !next[q.id]?.trim())
      if (nextUnanswered !== -1) {
        setTimeout(() => setStep(nextUnanswered), 140)
      } else if (currentIndex < questions.length - 1 && !prev[questionId]) {
        setTimeout(() => setStep(currentIndex + 1), 140)
      }
      return next
    })
  }

  function applyRecommendedForRemaining() {
    if (disabled || state !== "pending") return
    setAnswers((prev) => {
      const next = { ...prev }
      for (const q of questions) {
        if (!next[q.id]?.trim()) {
          const rec = q.options.find((o) => o.recommended) ?? q.options[0]
          if (rec) next[q.id] = rec.label
        }
      }
      return next
    })
    setStep(questions.length - 1)
  }

  function handleSubmit() {
    if (!onSubmitAnswers || disabled || !allAnswered) return
    const lines = questions.map((q) => `- ${q.stepLabel}: ${answers[q.id]}`)
    const message = `Here are my planning choices:\n${lines.join("\n")}`
    onSubmitAnswers(message)
  }

  if (state === "answered") {
    return (
      <section
        aria-label="Completed planning questions"
        className="w-full overflow-hidden rounded-2xl border border-border/60 bg-card/80 opacity-85"
      >
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 bg-linear-to-br from-brand/10 via-muted/60 to-brand-accent/10 px-3.5 py-2.5 text-left"
        >
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-dark">
            <CompassIcon className="size-3.5" />
            Planning questions ({questions.length})
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            <CheckIcon className="size-3" />
            Answered
            <ChevronDownIcon className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
          </span>
        </button>
        {expanded && (
          <ol className="space-y-2.5 border-t border-border/50 px-3.5 py-3 text-xs">
            {questions.map((q, idx) => {
              const rec = q.options.find((o) => o.recommended) ?? q.options[0]
              return (
                <li key={q.id} className="space-y-0.5">
                  <p className="font-medium text-foreground">
                    {idx + 1}. {q.stepLabel}: <span className="font-normal text-muted-foreground">{q.question}</span>
                  </p>
                  {rec && (
                    <p className="text-[11px] text-brand-dark/80">
                      AI recommended: {rec.label}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>
    )
  }

  if (!current) return null

  const selectedAnswer = answers[current.id] ?? ""
  const isCustomSelected =
    Boolean(selectedAnswer) && !current.options.some((o) => o.label === selectedAnswer)
  const showCustomInput = Boolean(customOpen[current.id]) || isCustomSelected

  return (
    <section
      aria-label="Interactive planning questions"
      className="w-full overflow-hidden rounded-2xl border border-brand/25 bg-card shadow-[0_12px_32px_-20px_rgba(76,29,149,0.4)]"
    >
      <div className="bg-linear-to-br from-brand/10 via-muted/60 to-brand-accent/10 px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-brand-dark uppercase">
            <CompassIcon className="size-3.5" />
            Plan Mode · Step {currentIndex + 1} of {questions.length}
          </span>
          {!allAnswered && (
            <button
              type="button"
              disabled={disabled}
              onClick={applyRecommendedForRemaining}
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand-dark transition-colors hover:bg-brand/15 disabled:opacity-50"
            >
              <SparklesIcon className="size-2.5" />
              Use recommended
            </button>
          )}
        </div>

        {questions.length > 1 && (
          <div className="mt-2.5 flex flex-wrap gap-1" role="tablist" aria-label="Planning steps">
            {questions.map((q, idx) => {
              const done = Boolean(answers[q.id]?.trim())
              const active = idx === currentIndex
              return (
                <button
                  key={q.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStep(idx)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                    active
                      ? "bg-brand text-white shadow-xs"
                      : done
                        ? "bg-emerald-500/12 text-emerald-800 hover:bg-emerald-500/20"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {done && !active && <CheckIcon className="size-2.5" />}
                  <span>{q.stepLabel}</span>
                </button>
              )
            })}
          </div>
        )}

        <h3 className="mt-2.5 text-sm font-semibold leading-snug text-foreground">
          {current.question}
        </h3>
      </div>

      <div className="space-y-2 px-3.5 py-3">
        {current.options.map((option) => {
          const selected = selectedAnswer === option.label
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => selectOption(current.id, option.label)}
              className={cn(
                "group flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all disabled:opacity-50",
                selected
                  ? "border-brand bg-brand/8 ring-1 ring-brand/25"
                  : option.recommended
                    ? "border-brand/30 bg-brand/[0.025] hover:border-brand/50 hover:bg-brand/5"
                    : "border-border/70 bg-card hover:border-brand/30 hover:bg-muted/30"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] transition-colors",
                  selected
                    ? "border-brand bg-brand text-white"
                    : "border-muted-foreground/35 bg-card group-hover:border-brand/60"
                )}
              >
                {selected && <CheckIcon className="size-2.5 stroke-[3]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{option.label}</span>
                  {option.recommended && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand/12 px-1.5 py-0.5 text-[10px] font-semibold text-brand-dark">
                      <SparklesIcon className="size-2.5" />
                      Recommended
                    </span>
                  )}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          )
        })}

        {showCustomInput ? (
          <div className="rounded-xl border border-brand/30 bg-brand/[0.03] p-2">
            <label htmlFor={`custom-${current.id}`} className="block text-[11px] font-medium text-brand-dark">
              Your custom choice for {current.stepLabel.toLowerCase()}
            </label>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                id={`custom-${current.id}`}
                type="text"
                value={customValues[current.id] ?? (isCustomSelected ? selectedAnswer : "")}
                onChange={(e) => {
                  const val = e.target.value
                  setCustomValues((prev) => ({ ...prev, [current.id]: val }))
                  setAnswers((prev) => ({ ...prev, [current.id]: val.trim() }))
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    if (currentIndex < questions.length - 1 && answers[current.id]?.trim()) {
                      setStep(currentIndex + 1)
                    }
                  }
                }}
                placeholder="Type your own preference…"
                disabled={disabled}
                className="h-7 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-brand"
              />
              {currentIndex < questions.length - 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!answers[current.id]?.trim() || disabled}
                  onClick={() => setStep(currentIndex + 1)}
                  className="h-7 rounded-lg px-2 text-xs"
                >
                  Next
                </Button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCustomOpen((prev) => ({ ...prev, [current.id]: true }))}
            className="inline-flex items-center gap-1.5 px-1 pt-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-brand-dark"
          >
            <PencilLineIcon className="size-3" />
            Write my own answer…
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3.5 py-2.5">
        <div className="flex items-center gap-1">
          {questions.length > 1 && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={currentIndex === 0 || disabled}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="h-7 rounded-full px-2 text-xs"
              >
                <ArrowLeftIcon className="size-3.5" />
                Back
              </Button>
              {currentIndex < questions.length - 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setStep((s) => Math.min(questions.length - 1, s + 1))}
                  className="h-7 rounded-full px-2 text-xs"
                >
                  Next
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              )}
            </>
          )}
        </div>

        {onSubmitAnswers && (
          <Button
            type="button"
            size="sm"
            disabled={!allAnswered || disabled}
            onClick={handleSubmit}
            className="h-8 rounded-full bg-brand px-3.5 text-xs text-white shadow-md shadow-brand/30 hover:opacity-95 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            <SparklesIcon className="size-3.5" />
            {isBuiltProject ? "Create change plan" : `Create plan (${answeredCount}/${questions.length})`}
          </Button>
        )}
      </div>
    </section>
  )
}

export function ChangePlanCard({
  changePlan,
  state,
  disabled,
  onConfirm,
}: {
  changePlan: ChangePlan
  state: "pending" | "confirmed"
  disabled?: boolean
  onConfirm?: () => void
}) {
  return (
    <section
      aria-label={`Change plan: ${changePlan.title}`}
      className={cn(
        "w-full overflow-hidden rounded-2xl border bg-card shadow-[0_12px_32px_-20px_rgba(76,29,149,0.4)]",
        state === "confirmed" ? "border-border/60" : "border-brand/25"
      )}
    >
      <div className="bg-linear-to-br from-brand/10 via-muted/60 to-brand-accent/10 px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-brand-dark uppercase">
            <CompassIcon className="size-3.5" />
            Planned changes
          </span>
          {state === "confirmed" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckIcon className="size-3" />
              Confirmed
            </span>
          )}
        </div>
        <h3 className="mt-1.5 text-sm font-semibold tracking-tight">{changePlan.title}</h3>
        {changePlan.summary && (
          <p className="mt-0.5 text-xs text-muted-foreground">{changePlan.summary}</p>
        )}
      </div>

      <ul className="space-y-1.5 px-4 py-3">
        {changePlan.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-foreground">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-semibold text-brand-dark">
              {i + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {state === "pending" && onConfirm && (
        <div className="space-y-1.5 border-t border-border/60 px-4 py-3">
          <Button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className="h-9 w-full rounded-full bg-brand text-white shadow-md shadow-brand/30 hover:opacity-95"
          >
            <HammerIcon />
            Confirm & build changes
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            {`Uses ${EDIT_CREDITS}+ credits when built. Want adjustments? Tell me below.`}
          </p>
        </div>
      )}
    </section>
  )
}
