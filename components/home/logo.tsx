import { SparklesIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function Logo({
  showText = true,
  className,
}: {
  showText?: boolean
  className?: string
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-sm shadow-violet-500/30",
          className
        )}
      >
        <SparklesIcon className="size-1/2" />
      </span>
      {showText && (
        <span className="text-lg font-semibold tracking-tight">AppForge</span>
      )}
    </span>
  )
}
