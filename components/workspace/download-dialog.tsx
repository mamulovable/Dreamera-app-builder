"use client"

import * as React from "react"
import { CheckCircle2Icon, DownloadIcon, Loader2Icon, RotateCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type DownloadState = { step: "packaging" } | { step: "done"; fileName: string } | { step: "failed"; message: string }

const SETUP_COMMANDS = `npm install
npx expo start`

function fileNameFrom(response: Response) {
  return response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "appforge-project.zip"
}

export function DownloadDialog({
  projectId,
  open,
  onOpenChange,
  beforeExport,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Saves edits still on their way, so the download has them. */
  beforeExport: () => Promise<boolean>
}) {
  const [state, setState] = React.useState<DownloadState>({ step: "packaging" })

  const start = React.useCallback(async () => {
    setState({ step: "packaging" })
    if (!(await beforeExport())) {
      return setState({ step: "failed", message: "We couldn't save your latest edits, so we stopped the download. Please try again." })
    }
    const response = await fetch(`/api/projects/${projectId}/export`).catch(() => null)
    if (!response) {
      return setState({ step: "failed", message: "Couldn't reach the server. Check your connection and try again." })
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      return setState({ step: "failed", message: body?.error ?? "We couldn't package your project. Please try again." })
    }
    const fileName = fileNameFrom(response)
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
    setState({ step: "done", fileName })
  }, [beforeExport, projectId])

  // Choosing "Download as ZIP" is the whole request, so this starts as soon as it opens.
  React.useEffect(() => {
    if (open) void start()
    // Only when it opens: `start` changes as the person edits, which isn't a new download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <DownloadIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">Download as ZIP</DialogTitle>
            <DialogDescription>The complete Expo project, ready to run on your computer.</DialogDescription>
          </div>
        </DialogHeader>

        {state.step === "packaging" && (
          <p role="status" className="flex items-center gap-2 rounded-2xl bg-violet-500/10 px-3 py-2.5 text-sm font-medium text-violet-800">
            <Loader2Icon className="size-4 shrink-0 animate-spin" />
            Packaging your project…
          </p>
        )}

        {state.step === "failed" && (
          <>
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.message}
            </p>
            <Button className="h-10 rounded-full" onClick={() => void start()}>
              <RotateCwIcon />
              Try again
            </Button>
          </>
        )}

        {state.step === "done" && (
          <>
            <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-800">
              <CheckCircle2Icon className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{state.fileName} is downloading.</span>
            </p>
            <div className="space-y-1.5">
              <p className="text-xs leading-relaxed text-muted-foreground">Unzip it, open a terminal in the folder, and run:</p>
              <pre className="overflow-x-auto rounded-2xl bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed">{SETUP_COMMANDS}</pre>
              <p className="text-xs leading-relaxed text-muted-foreground">Then scan the QR code with Expo Go. The README has the details.</p>
            </div>
            <Button variant="outline" className="h-10 rounded-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
