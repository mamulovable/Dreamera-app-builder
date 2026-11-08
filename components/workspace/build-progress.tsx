"use client"

import { CheckIcon, CircleIcon, XIcon } from "lucide-react"

import type { ProjectScreen } from "@/lib/agent-protocol"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/** Live progress of a build: each screen's status, with the tail of the code being written. */
export function BuildProgress({ screens }: { screens: ProjectScreen[] }) {
  const finished = screens.filter((s) => s.status === "done" || s.status === "failed").length
  const current = screens.find((s) => s.status === "generating")

  return (
    <section
      aria-label="Build progress"
      className="w-full overflow-hidden rounded-2xl border border-violet-200/80 bg-white shadow-[0_12px_32px_-20px_rgba(76,29,149,0.4)]"
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Building your app</span>
          <span className="tabular-nums text-muted-foreground">
            {finished} of {screens.length}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={screens.length}
          aria-valuenow={finished}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-500/10"
        >
          <div
            className="h-full rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-[width] duration-500"
            style={{ width: `${(finished / Math.max(screens.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      <ol className="space-y-1.5 px-4 pb-3.5">
        {screens.map((screen) => (
          <li key={screen.id} className="flex items-center gap-2 text-sm">
            <StatusIcon status={screen.status} />
            <span className={cn("min-w-0 flex-1 truncate", screen.status === "pending" && "text-muted-foreground")}>
              {screen.name}
            </span>
            {screen.status === "generating" && (
              <span className="text-[11px] tabular-nums text-violet-700">
                {screen.code ? `${screen.code.split("\n").length} lines` : "designing"}
              </span>
            )}
            {screen.status === "failed" && <span className="text-[11px] text-red-600">Failed</span>}
          </li>
        ))}
      </ol>

      {current?.code && (
        <pre
          aria-label={`Code being written for ${current.name}`}
          className="max-h-28 overflow-hidden border-t border-neutral-800 bg-neutral-950 px-4 py-2.5 font-mono text-[10.5px] leading-relaxed text-neutral-300"
        >
          <span className="block text-neutral-500">{current.filePath}</span>
          {current.code.split("\n").slice(-6).join("\n")}
          <span aria-hidden className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-violet-400 align-middle" />
        </pre>
      )}
    </section>
  )
}

function StatusIcon({ status }: { status: ProjectScreen["status"] }) {
  if (status === "generating") return <Spinner className="size-4 shrink-0 text-violet-600" />
  if (status === "done") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <CheckIcon className="size-2.5" strokeWidth={3} />
        <span className="sr-only">Done</span>
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
        <XIcon className="size-2.5" strokeWidth={3} />
      </span>
    )
  }
  return <CircleIcon className="size-4 shrink-0 text-neutral-300" aria-label="Waiting" />
}
