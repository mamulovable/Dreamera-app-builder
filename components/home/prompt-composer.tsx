"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  SmartphoneIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react"

import { useAuth } from "@/lib/auth-client"
import { isUpgradeReason } from "@/lib/plans"
import { QUICK_PROMPTS } from "@/lib/home-data"
import {
  ACCEPTED_ASSET_TYPES,
  isAcceptedAsset,
  MAX_ASSET_SIZE,
  MAX_ASSETS,
  MAX_PROMPT_LENGTH,
  PLATFORM_LABELS,
  PROJECT_PLATFORMS,
  type ProjectPlatform,
} from "@/lib/projects"
import { PENDING_PROMPT_KEY } from "@/lib/social-auth"
import { cn } from "@/lib/utils"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"
import { useSignInDialog } from "@/components/home/sign-in-dialog"

type PromptFile = {
  id: string
  file: File
  /** Object URL for image previews */
  previewUrl?: string
}

type SubmitStatus =
  | { phase: "idle" }
  | { phase: "uploading"; progress: number }
  | { phase: "creating" }
  | { phase: "redirecting" }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusText(status: SubmitStatus, fileCount: number) {
  switch (status.phase) {
    case "uploading":
      return fileCount > 0
        ? `Uploading ${fileCount} ${fileCount === 1 ? "asset" : "assets"}… ${Math.round(status.progress * 100)}%`
        : "Sending your prompt…"
    case "creating":
      return "Creating your project…"
    case "redirecting":
      return "Opening your workspace…"
    default:
      return null
  }
}

/**
 * Posts the composer to the projects API. Uses XHR rather than fetch so we can
 * report upload progress, and know when the upload ends and the server takes over.
 */
function postProject(
  body: FormData,
  handlers: { onProgress: (fraction: number) => void; onUploaded: () => void }
) {
  return new Promise<{ status: number; data: { project?: { id: string }; error?: string; code?: string } }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/api/projects")
      xhr.responseType = "json"
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) handlers.onProgress(e.loaded / e.total)
      }
      xhr.upload.onload = handlers.onUploaded
      xhr.onload = () => resolve({ status: xhr.status, data: xhr.response ?? {} })
      xhr.onerror = () => reject(new Error("Network error"))
      xhr.send(body)
    }
  )
}

export function PromptComposer() {
  const { user, isPending: isSessionPending } = useAuth()
  const { openSignIn } = useSignInDialog()
  const openUpgrade = useUpgradeDialog()
  const router = useRouter()

  const [prompt, setPrompt] = React.useState("")
  const [files, setFiles] = React.useState<PromptFile[]>([])
  const [platform, setPlatform] = React.useState<ProjectPlatform>(PROJECT_PLATFORMS[0])
  const [error, setError] = React.useState<string | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [previewFile, setPreviewFile] = React.useState<PromptFile | null>(null)
  const [submitStatus, setSubmitStatus] = React.useState<SubmitStatus>({ phase: "idle" })
  const isSubmitting = submitStatus.phase !== "idle"

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const dragDepth = React.useRef(0)

  // Revoke any remaining object URLs on unmount.
  const filesRef = React.useRef(files)
  React.useEffect(() => {
    filesRef.current = files
  }, [files])
  React.useEffect(
    () => () =>
      filesRef.current.forEach(
        (f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl)
      ),
    []
  )

  const canSubmit = prompt.trim().length > 0 && !isSubmitting

  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming)
    if (list.length === 0) return

    const unsupported = list.filter((f) => !isAcceptedAsset(f.name, f.type))
    const tooLarge = list.filter((f) => f.size > MAX_ASSET_SIZE)
    const valid = list.filter((f) => f.size <= MAX_ASSET_SIZE && isAcceptedAsset(f.name, f.type))
    const room = MAX_ASSETS - files.length
    const accepted = valid.slice(0, Math.max(room, 0))

    if (unsupported.length > 0) {
      setError("Attach images, PDFs, or text files (.txt, .md, .json, .csv).")
    } else if (tooLarge.length > 0) {
      setError(`Files must be under ${formatBytes(MAX_ASSET_SIZE)}.`)
    } else if (valid.length > accepted.length) {
      setError(`You can attach up to ${MAX_ASSETS} files.`)
    } else {
      setError(null)
    }

    setFiles((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      })),
    ])
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
    setError(null)
  }

  // Latest composer state, so a submit resumed after sign-in sees current values.
  const draftRef = React.useRef({ prompt, platform, files })
  React.useEffect(() => {
    draftRef.current = { prompt, platform, files }
  }, [prompt, platform, files])

  // Guards against a double submit before the status state has re-rendered.
  const submittingRef = React.useRef(false)

  async function createApp() {
    const draft = draftRef.current
    if (!draft.prompt.trim() || submittingRef.current) return

    // Assets only leave the browser here, once the user has hit Send.
    const body = new FormData()
    body.append("prompt", draft.prompt.trim())
    body.append("platform", draft.platform)
    draft.files.forEach((f) => body.append("files", f.file))

    submittingRef.current = true
    setError(null)
    setSubmitStatus({ phase: "uploading", progress: 0 })

    try {
      const { status, data } = await postProject(body, {
        onProgress: (progress) => setSubmitStatus({ phase: "uploading", progress }),
        onUploaded: () => setSubmitStatus({ phase: "creating" }),
      })

      if (status === 401) {
        submittingRef.current = false
        setSubmitStatus({ phase: "idle" })
        openSignIn("sign-in", {
          reason: "Your session has expired. Sign in again to create your app.",
          onSuccess: createApp,
          onSocialRedirect: parkDraft,
        })
        return
      }
      if (status !== 201 || !data.project) {
        if (isUpgradeReason(data.code)) openUpgrade(data.code)
        throw new Error(data.error || "We couldn't create your project. Please try again.")
      }

      setSubmitStatus({ phase: "redirecting" })
      router.push(`/workspace/${data.project.id}`)
    } catch (err) {
      submittingRef.current = false
      setSubmitStatus({ phase: "idle" })
      setError(
        err instanceof Error && err.message !== "Network error"
          ? err.message
          : "Couldn't reach the server. Check your connection and try again."
      )
    }
  }

  // Social sign-in leaves the page, so park the draft and pick it up on return.
  // Attachments can't be stored, so they're dropped.
  const [resumeAfterAuth, setResumeAfterAuth] = React.useState(false)

  React.useEffect(() => {
    const saved = sessionStorage.getItem(PENDING_PROMPT_KEY)
    if (!saved) return
    sessionStorage.removeItem(PENDING_PROMPT_KEY)
    try {
      const draft = JSON.parse(saved) as { prompt?: string; platform?: string }
      if (!draft.prompt) return
      setPrompt(draft.prompt)
      const savedPlatform = PROJECT_PLATFORMS.find((p) => p === draft.platform)
      if (savedPlatform) setPlatform(savedPlatform)
      setResumeAfterAuth(true)
    } catch {
      // Ignore a malformed draft.
    }
  }, [])

  React.useEffect(() => {
    if (!resumeAfterAuth || isSessionPending) return
    setResumeAfterAuth(false)
    // Only continue if sign-in actually succeeded; otherwise the prompt just stays in the box.
    if (user) createApp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeAfterAuth, isSessionPending, user])

  function parkDraft() {
    const { prompt, platform } = draftRef.current
    sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify({ prompt, platform }))
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    if (!canSubmit || isSessionPending) return

    if (!user) {
      // The prompt stays in the composer; continue as soon as auth succeeds.
      openSignIn("sign-up", {
        reason: "Create a free account to generate your app — your prompt is saved.",
        onSuccess: createApp,
        onSocialRedirect: parkDraft,
      })
      return
    }

    createApp()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSubmit()
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files)
    if (pasted.length > 0) {
      event.preventDefault()
      if (isSubmitting) return
      addFiles(pasted)
    }
  }

  function applySuggestion(text: string) {
    if (isSubmitting) return
    setPrompt(text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(text.length, text.length)
    })
  }

  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return
      e.preventDefault()
      dragDepth.current += 1
      setIsDragging(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault()
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(dragDepth.current - 1, 0)
      if (dragDepth.current === 0) setIsDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setIsDragging(false)
      if (!isSubmitting) addFiles(e.dataTransfer.files)
    },
  }

  return (
    <div className="w-full">
      <div className="group/composer relative">
        {/* Soft glow behind the composer */}
        <div
          aria-hidden
          className="absolute -inset-3 rounded-[2.75rem] bg-linear-to-r from-indigo-400/30 via-fuchsia-400/30 to-violet-400/30 opacity-60 blur-2xl transition-opacity duration-500 group-focus-within/composer:opacity-100"
        />
        <form
          onSubmit={handleSubmit}
          {...dragHandlers}
          aria-busy={isSubmitting}
          className={cn(
            "relative rounded-[2.25rem] bg-linear-to-br from-indigo-300/70 via-white to-fuchsia-300/70 p-px shadow-[0_24px_60px_-20px_rgba(76,29,149,0.35)] transition-[background,box-shadow] focus-within:from-indigo-400 focus-within:to-fuchsia-400",
            isDragging && "from-violet-400 to-violet-400"
          )}
        >
          <div className="relative rounded-[calc(2.25rem-1px)] bg-white/90 p-2.5 backdrop-blur-xl">
            {isDragging && (
              <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-[2rem] border-2 border-dashed border-violet-300 bg-violet-50/90 text-violet-700">
                <UploadCloudIcon className="size-7" />
                <p className="text-sm font-medium">Drop files to attach</p>
              </div>
            )}

            {files.length > 0 && (
              <AttachmentGroup className="px-2 pt-2 pb-1">
                {files.map((item) => (
                  <PromptAttachment
                    key={item.id}
                    item={item}
                    onRemove={isSubmitting ? undefined : () => removeFile(item.id)}
                    onPreview={() => setPreviewFile(item)}
                  />
                ))}
              </AttachmentGroup>
            )}

            <label htmlFor="prompt" className="sr-only">
              Describe the app you want to build
            </label>
            <textarea
              id="prompt"
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              readOnly={isSubmitting}
              maxLength={MAX_PROMPT_LENGTH}
              rows={3}
              placeholder="Describe your app idea… e.g. A recipe app that suggests meals from what's in my fridge"
              className="field-sizing-content block max-h-64 min-h-24 w-full resize-none bg-transparent px-3 pt-3 pb-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground/70"
            />

            <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_ASSET_TYPES}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ""
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="h-9 rounded-full bg-muted/60 px-3.5 text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={files.length >= MAX_ASSETS || isSubmitting}
                >
                  <PaperclipIcon />
                  <span className="hidden sm:inline">Attach</span>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={isSubmitting}
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        className="h-9 rounded-full bg-muted/60 px-3.5 text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
                      />
                    }
                  >
                    <SmartphoneIcon />
                    <span className="hidden sm:inline">{PLATFORM_LABELS[platform]}</span>
                    <ChevronDownIcon className="size-3.5 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-44 rounded-2xl">
                    {PROJECT_PLATFORMS.map((option) => (
                      <DropdownMenuItem
                        key={option}
                        className="rounded-xl py-2"
                        onClick={() => setPlatform(option)}
                      >
                        {PLATFORM_LABELS[option]}
                        {option === platform && (
                          <CheckIcon className="ml-auto text-violet-600" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center gap-3">
                {isSubmitting ? (
                  <span role="status" className="text-xs font-medium text-violet-700">
                    {statusText(submitStatus, files.length)}
                  </span>
                ) : (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    <kbd className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-sans text-[10px]">Shift + Enter</kbd> for new line
                  </span>
                )}
                <Button
                  type="submit"
                  size="icon-lg"
                  disabled={!canSubmit || isSessionPending}
                  aria-label={isSubmitting ? "Creating project" : "Generate app"}
                  className="size-11 rounded-full bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/40 transition-transform hover:scale-105 hover:opacity-95 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
                >
                  {isSubmitting ? <Spinner className="size-5" /> : <ArrowUpIcon className="size-5" />}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>

      {error && (
        <p role="alert" className="mt-2 px-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {QUICK_PROMPTS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => applySuggestion(item.prompt)}
            className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/60 py-1.5 pr-4 pl-1.5 text-sm text-muted-foreground shadow-[0_4px_16px_-8px_rgba(76,29,149,0.3)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:bg-white hover:text-violet-700 hover:shadow-[0_8px_24px_-8px_rgba(124,58,237,0.4)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full bg-linear-to-br from-violet-100 to-fuchsia-100 text-xs"
            >
              {item.emoji}
            </span>
            {item.label}
          </button>
        ))}
      </div>

      <Dialog
        open={previewFile !== null}
        onOpenChange={(open) => !open && setPreviewFile(null)}
      >
        <DialogContent className="gap-3 rounded-[1.75rem] p-3 sm:max-w-2xl">
          <DialogTitle className="truncate px-1 pr-8 text-sm font-medium">
            {previewFile?.file.name}
          </DialogTitle>
          {previewFile?.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewFile.previewUrl}
              alt={previewFile.file.name}
              className="max-h-[70vh] w-full rounded-2xl bg-muted object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PromptAttachment({
  item,
  onRemove,
  onPreview,
}: {
  item: PromptFile
  /** Omitted while the project is being created, so the file can't be removed. */
  onRemove?: () => void
  onPreview: () => void
}) {
  const { file, previewUrl } = item
  const extension = file.name.split(".").pop()?.toUpperCase() ?? "FILE"

  return (
    <Attachment size="sm" className="max-w-56 rounded-2xl bg-muted/40">
      {previewUrl && (
        <AttachmentTrigger aria-label={`Preview ${file.name}`} onClick={onPreview} />
      )}
      <AttachmentMedia variant={previewUrl ? "image" : "icon"}>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" />
        ) : file.type.startsWith("image/") ? (
          <ImageIcon />
        ) : (
          <FileTextIcon className="text-violet-600" />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{file.name}</AttachmentTitle>
        <AttachmentDescription>
          {extension} · {formatBytes(file.size)}
        </AttachmentDescription>
      </AttachmentContent>
      {onRemove && (
        <AttachmentActions>
          <AttachmentAction aria-label={`Remove ${file.name}`} onClick={onRemove}>
            <XIcon />
          </AttachmentAction>
        </AttachmentActions>
      )}
    </Attachment>
  )
}
