"use client"

import { ChevronDownIcon, PaletteIcon } from "lucide-react"

import type { AppTheme, ThemePackage } from "@/lib/themes"
import { activeTheme } from "@/lib/themes"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function ThemeSwatch({ theme }: { theme: AppTheme }) {
  const { background, primary, accent } = theme.colors
  return (
    <span aria-hidden className="flex shrink-0 -space-x-1">
      {[background, primary, accent].map((color, i) => (
        <span key={i} className="size-3.5 rounded-full ring-1 ring-black/15 ring-offset-1 ring-offset-white" style={{ backgroundColor: color }} />
      ))}
    </span>
  )
}

/** Attached to the top of the canvas. Switching restyles the running app, with no rebuild. */
export function ThemeSwitcher({
  themePackage,
  onChange,
}: {
  themePackage: ThemePackage
  onChange: (themeId: string) => void
}) {
  const current = activeTheme(themePackage)
  if (!current) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`App theme: ${current.name}. Change theme`}
        className="absolute top-0 left-1/2 z-10 flex h-9 max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-b-2xl border-x border-b border-border/60 bg-white pr-2.5 pl-3 text-xs font-medium shadow-[0_8px_20px_-14px_rgba(76,29,149,0.45)] outline-none transition-colors hover:bg-violet-50 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-violet-50"
      >
        <PaletteIcon className="size-3.5 shrink-0 text-violet-600" aria-hidden />
        <span className="truncate">{current.name}</span>
        <ThemeSwatch theme={current} />
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="w-60 rounded-2xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px]">App theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={current.id} onValueChange={onChange}>
            {themePackage.themes.map((theme) => (
              <DropdownMenuRadioItem key={theme.id} value={theme.id} className="gap-2.5 rounded-xl py-2">
                <ThemeSwatch theme={theme} />
                <span className="min-w-0 flex-1 truncate">{theme.name}</span>
                <span className="mr-5 text-[11px] text-muted-foreground capitalize">{theme.mode}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
