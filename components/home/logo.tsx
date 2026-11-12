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
          "relative flex size-8 items-center justify-center rounded-xl bg-brand text-white shadow-md shadow-brand/30",
          className
        )}
      >
        <span className="text-[1.15rem] leading-none font-bold">D</span>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className="absolute top-0.5 right-0.5 size-2.5"
        >
          <path
            fill="currentColor"
            d="M6 0.4 7.1 4.2 11 5.2 7.1 6.3 6 10.1 4.9 6.3 1 5.2 4.9 4.2 6 0.4Z"
          />
        </svg>
      </span>
      {showText && (
        <span className="text-lg font-bold tracking-tight">Dreamera</span>
      )}
    </span>
  )
}
