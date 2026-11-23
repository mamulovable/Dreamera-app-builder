"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ArrowUpIcon,
  BrainIcon,
  ChevronRightIcon,
  EyeIcon,
  FileTextIcon,
  ImageIcon,
  MessageSquarePlusIcon,
  PaperclipIcon,
  RotateCwIcon,
  SparklesIcon,
  SquareDashedMousePointerIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react"

import type { InlineEditor } from "@/hooks/use-inline-editor"
import type { useProjectAgent } from "@/hooks/use-project-agent"
import { parseMessageContent, splitElementMessage, type ChatMessage, type MessageAsset } from "@/lib/agent-protocol"
import { ELEMENT_LABELS } from "@/lib/preview-protocol"
import { ACCEPTED_ASSET_TYPES, isAcceptedAsset, isHtmlWebsite, MAX_ASSET_SIZE, MAX_ASSETS, MAX_PROMPT_LENGTH, type ProjectPlatform } from "@/lib/projects"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { BuildProgress } from "@/components/workspace/build-progress"
import { PlanCard, type PlanCardState } from "@/components/workspace/plan-card"

type Agent = ReturnType<typeof useProjectAgent>

/** A reference file attached to the project's first prompt. */
export type ChatAsset = {
  id: string
  fileName: string
  contentType: string
  url: string | null
}

// How close to the bottom (px) still counts as "following" the conversation.
const FOLLOW_THRESHOLD = 120

export type ChatPromptFile = {
  id: string
  file: File
  previewUrl?: string
}

export function ChatPanel({
  agent,
  assets,
  editor,
  platform,
  projectId,
}: {
  agent: Agent
  assets: ChatAsset[]
  editor: InlineEditor
  platform: ProjectPlatform
  projectId: string
}) {
  const [draft, setDraft] = React.useState("")
  const [files, setFiles] = React.useState<ChatPromptFile[]>([])
  const [isUploading, setIsUploading] = React.useState(false)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [previewImage, setPreviewImage] = React.useState<{ fileName: string; url: string } | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [newSessionOpen, setNewSessionOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const dragDepth = React.useRef(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const following = React.useRef(true)
  const { messages, status, busy, activity, streamingText, reasoning, error, screens, send, startNewSession, sessionRestarted } = agent

  const firstUserId = sessionRestarted ? undefined : messages.find((m) => m.role === "user")?.id
  const latestPlanId = messages.findLast((m) => m.plan)?.id
  // A new session archives the message that held the plan's card, and the plan can still be waiting for confirmation.
  const waitingPlan = (status === "planning" || status === "failed") && !latestPlanId ? agent.plan : null
  const canRetry = !editor.readOnly && (status === "building" || messages.at(-1)?.role === "user")
  const htmlSite = isHtmlWebsite(platform)
  const confirmPlan = editor.readOnly
    ? undefined
    : () => {
        following.current = true
        void send({ action: "confirm" })
      }
  const showBuild = screens.length > 0 && status === "building"
  const inputLocked = busy || status === "building" || isUploading
  const attachment = editor.attached ? editor.selection : null
  const attachmentLabel = attachment && (ELEMENT_LABELS[attachment.type] ?? attachment.type)

  // Revoke object URLs on unmount.
  const filesRef = React.useRef(files)
  React.useEffect(() => {
    filesRef.current = files
  }, [files])
  React.useEffect(
    () => () => {
      filesRef.current.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl))
    },
    []
  )

  // Keep the newest output in view while the agent streams, unless the person scrolled up.
  React.useEffect(() => {
    const el = scrollRef.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [messages, streamingText, reasoning, activity, screens, error])

  function planState(message: ChatMessage): PlanCardState {
    if (message.id !== latestPlanId) return "superseded"
    if (status !== "planning" && status !== "failed") return "confirmed"
    return "pending"
  }

  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming)
    if (list.length === 0) return

    const unsupported = list.filter((f) => !isAcceptedAsset(f.name, f.type))
    const tooLarge = list.filter((f) => f.size > MAX_ASSET_SIZE)
    const valid = list.filter((f) => f.size <= MAX_ASSET_SIZE && isAcceptedAsset(f.name, f.type))
    const room = MAX_ASSETS - files.length
    const accepted = valid.slice(0, Math.max(room, 0))

    if (unsupported.length > 0) {
      setFileError("Attach images, PDFs, or text files (.txt, .md, .json, .csv).")
    } else if (tooLarge.length > 0) {
      setFileError("Files must be under 10 MB.")
    } else if (valid.length > accepted.length) {
      setFileError(`You can attach up to ${MAX_ASSETS} files.`)
    } else {
      setFileError(null)
    }

    setFiles((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      })),
    ])
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
    setFileError(null)
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(e.clipboardData.files)
    if (pasted.length > 0) {
      e.preventDefault()
      if (inputLocked) return
      addFiles(pasted)
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current++
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current--
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragging(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (inputLocked) return
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files)
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    const content = draft.trim()
    if ((!content && files.length === 0) || inputLocked) return
    following.current = true
    setFileError(null)

    let uploadedAssets: MessageAsset[] = []
    if (files.length > 0) {
      setIsUploading(true)
      try {
        const formData = new FormData()
        files.forEach((f) => formData.append("files", f.file))
        const res = await fetch(`/api/projects/${projectId}/assets`, {
          method: "POST",
          body: formData,
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(data?.error ?? "Couldn't upload attached files.")
        }
        uploadedAssets = (data.assets as MessageAsset[]) ?? []
      } catch (err) {
        setIsUploading(false)
        setFileError(err instanceof Error ? err.message : "Couldn't upload attached files.")
        return
      }
      setIsUploading(false)
    }

    const promptText = content || (uploadedAssets.length > 0 ? "Please review the attached reference image(s) and update the app." : "")
    setDraft("")
    const currentFiles = [...files]
    setFiles([])

    // Put the text and files back if the agent didn't take it.
    if (!(await editor.sendMessage(promptText, uploadedAssets).catch(() => false))) {
      setDraft((d) => d || promptText)
      setFiles(currentFiles)
    }
  }

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <span className="flex size-6 items-center justify-center rounded-lg bg-brand text-white">
          <SparklesIcon className="size-3.5" />
        </span>
        <h2 className="text-sm font-semibold">Dreamera</h2>
        <div className="ml-auto flex items-center gap-2">
          {busy && (
            <span className="inline-flex items-center gap-1.5 text-xs text-brand-dark">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              Working
            </span>
          )}
          {!editor.readOnly && <AlertDialog open={newSessionOpen} onOpenChange={setNewSessionOpen}>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={inputLocked || messages.length === 0}
                  className="h-7 rounded-full px-2 text-xs text-muted-foreground hover:bg-brand/10 hover:text-brand-dark"
                />
              }
            >
              <MessageSquarePlusIcon />
              New session
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start a new session?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears the chat, and the agent forgets the conversation. Your app, screens, and plan stay as they are.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    following.current = true
                    setNewSessionOpen(false)
                    void startNewSession()
                  }}
                >
                  Start new session
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD
        }}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <ol aria-live="polite" aria-busy={busy} className="space-y-5 px-4 py-5">
          {messages.length === 0 && !busy && (
            <li className="text-center text-sm text-muted-foreground">
              New session. Tell the agent what to do next.
            </li>
          )}

          {waitingPlan && (
            <li>
              <PlanCard
                screens={screens}
                plan={waitingPlan}
                state="pending"
                disabled={busy}
                onConfirm={confirmPlan}
                unit={htmlSite ? "page" : "screen"}
              />
            </li>
          )}

          {messages.map((message) => (
            <li
              key={message.id}
              className={cn("flex flex-wrap gap-2.5", message.role === "user" && "justify-end")}
            >
              {message.role === "assistant" && <AgentAvatar />}
              {message.role === "user" ? (
                <UserMessage content={message.content} onPreviewImage={setPreviewImage} />
              ) : (
                <div className="min-w-0 flex-1 space-y-3 pt-1">
                  <span className="sr-only">Agent: </span>
                  <MessageText text={message.content} />
                  {message.plan && (
                    <PlanCard
                      screens={screens}
                      plan={message.plan}
                      state={planState(message)}
                      disabled={busy}
                      onConfirm={confirmPlan}
                      unit={htmlSite ? "page" : "screen"}
                    />
                  )}
                </div>
              )}
              {message.id === firstUserId && assets.length > 0 && parseMessageContent(message.content).assets.length === 0 && (
                <ul aria-label="Attached files" className="flex w-full flex-wrap justify-end gap-1.5">
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <a
                        href={asset.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="flex max-w-44 items-center gap-1.5 rounded-xl border border-border/60 bg-muted/40 p-1 pr-2.5 text-xs text-muted-foreground transition-colors hover:border-brand/25 hover:text-brand-dark"
                      >
                        {asset.url && asset.contentType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.url} alt="" className="size-7 rounded-lg object-cover" />
                        ) : (
                          <span className="flex size-7 items-center justify-center rounded-lg bg-white">
                            <FileTextIcon className="size-3.5 text-brand" />
                          </span>
                        )}
                        <span className="truncate">{asset.fileName}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}

          {(busy || streamingText || reasoning || showBuild) && (
            <li className="flex gap-2.5">
              <AgentAvatar />
              <div className="min-w-0 flex-1 space-y-3 pt-1">
                {reasoning && <Reasoning text={reasoning} active={busy && !streamingText} />}
                {streamingText && <MessageText text={streamingText} streaming={busy} />}
                {showBuild && <BuildProgress screens={screens} />}
                {busy && (activity || !streamingText) && (
                  <ActivityLine label={activity ?? "Working…"} />
                )}
              </div>
            </li>
          )}

          {error && (
            <li role="alert" className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <p>{error}</p>
                {canRetry && !busy && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void send({ action: "start" })}
                    className="h-7 rounded-full border-red-200 bg-white text-red-800 hover:bg-red-100"
                  >
                    <RotateCwIcon />
                    Try again
                  </Button>
                )}
              </div>
            </li>
          )}
        </ol>
      </div>

      {editor.readOnly ? (
        <p className="m-3 flex shrink-0 items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <EyeIcon className="size-3.5 shrink-0" />
          This project was shared with you to view, so only its owner can ask the agent for changes.
        </p>
      ) : (
      <form
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="relative shrink-0 p-3"
      >
        <div
          className={cn(
            "rounded-3xl bg-linear-to-br from-brand/40 via-white to-brand-accent/40 p-px shadow-[0_12px_32px_-16px_rgba(76,29,149,0.35)] transition-colors focus-within:from-brand focus-within:to-brand-accent",
            isDragging && "from-brand to-brand ring-2 ring-brand/50"
          )}
        >
          <div className="relative rounded-[calc(1.5rem-1px)] bg-white p-2">
            {isDragging && (
              <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-brand/40 bg-brand/5 text-brand-dark backdrop-blur-xs">
                <UploadCloudIcon className="size-6 text-brand" />
                <p className="text-xs font-medium">Drop images or files to attach</p>
              </div>
            )}
            {attachment && (
              <div className="mb-1 flex max-w-full items-center gap-1.5 self-start">
                <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-brand/25 bg-brand/5 py-0.5 pr-0.5 pl-2 text-xs text-brand-dark">
                  <SquareDashedMousePointerIcon className="size-3.5 shrink-0" />
                  <span className="font-medium">{attachmentLabel}</span>
                  {attachment.label && <span className="max-w-32 truncate text-brand-dark/70">{attachment.label}</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${attachmentLabel} from this message`}
                    onClick={editor.detach}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-brand/15"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              </div>
            )}
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 px-0.5">
                {files.map((item) => (
                  <span
                    key={item.id}
                    className="flex items-center gap-1.5 rounded-xl border border-brand/20 bg-brand/5 p-1 pr-1.5 text-xs text-brand-dark"
                  >
                    {item.previewUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewImage({ fileName: item.file.name, url: item.previewUrl! })}
                        className="size-7 overflow-hidden rounded-lg border border-brand/15 bg-white"
                        aria-label={`Preview ${item.file.name}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.previewUrl} alt="" className="size-full object-cover" />
                      </button>
                    ) : (
                      <span className="flex size-7 items-center justify-center rounded-lg bg-white">
                        <FileTextIcon className="size-3.5 text-brand" />
                      </span>
                    )}
                    <span className="max-w-28 truncate font-medium">{item.file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => removeFile(item.id)}
                      disabled={isUploading}
                      className="flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-brand/15"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
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
            <label htmlFor="chat-prompt" className="sr-only">
              Tell Dreamera what you want to change
            </label>
            <textarea
              id="chat-prompt"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
              onPaste={handlePaste}
              maxLength={MAX_PROMPT_LENGTH}
              rows={2}
              disabled={status === "building"}
              placeholder={
                status === "building"
                  ? htmlSite
                    ? "Building your pages…"
                    : "Building your screens…"
                  : attachment
                    ? `Ask for a change to this ${attachmentLabel?.toLowerCase()}…`
                    : agent.plan
                    ? htmlSite
                      ? "Ask for changes… e.g. Add a contact page"
                      : "Ask for changes… e.g. Add a settings screen"
                    : "Message the agent…"
              }
              className="field-sizing-content block max-h-40 min-h-12 w-full resize-none bg-transparent px-2 pt-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
            />
            {fileError && (
              <p role="alert" className="px-2 pt-1 pb-1 text-xs text-red-600">
                {fileError}
              </p>
            )}
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach file"
                disabled={inputLocked || files.length >= MAX_ASSETS}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "relative rounded-full text-muted-foreground hover:bg-brand/10 hover:text-brand-dark",
                  files.length > 0 && "bg-brand/10 text-brand-dark"
                )}
              >
                <PaperclipIcon className="size-4" />
                {files.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                    {files.length}
                  </span>
                )}
              </Button>
              <Button
                type="submit"
                size="icon"
                disabled={(!draft.trim() && files.length === 0) || inputLocked}
                aria-label={busy || isUploading ? "The agent is working" : "Send message"}
                className="rounded-full bg-brand text-white shadow-md shadow-brand/30 hover:opacity-95 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
              >
                {busy || isUploading ? <Spinner className="text-current" /> : <ArrowUpIcon />}
              </Button>
            </div>
          </div>
        </div>
      </form>
      )}

      <Dialog
        open={previewImage !== null}
        onOpenChange={(open) => !open && setPreviewImage(null)}
      >
        <DialogContent className="gap-3 rounded-[1.75rem] p-3 sm:max-w-2xl">
          <DialogTitle className="truncate px-1 pr-8 text-sm font-medium">
            {previewImage?.fileName}
          </DialogTitle>
          {previewImage?.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewImage.url}
              alt={previewImage.fileName}
              className="max-h-[70vh] w-full rounded-2xl bg-muted object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function UserMessage({
  content,
  onPreviewImage,
}: {
  content: string
  onPreviewImage?: (asset: { fileName: string; url: string }) => void
}) {
  const { text, element, assets } = parseMessageContent(content)
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1.5">
      {element && (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand/25 bg-brand/5 px-2 py-0.5 text-[11px] text-brand-dark">
          <SquareDashedMousePointerIcon className="size-3 shrink-0" />
          <span className="truncate">
            {element.label} in {element.screen}
          </span>
        </span>
      )}
      {assets.length > 0 && (
        <ul aria-label="Attached files" className="flex w-full flex-wrap justify-end gap-1.5">
          {assets.map((asset) => (
            <li key={asset.id || asset.fileName}>
              {asset.url && asset.contentType.startsWith("image/") ? (
                <button
                  type="button"
                  onClick={() => onPreviewImage?.({ fileName: asset.fileName, url: asset.url! })}
                  className="group relative flex size-16 overflow-hidden rounded-xl border border-brand/20 bg-muted transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label={`View ${asset.fileName} full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt={asset.fileName} className="size-full object-cover" />
                </button>
              ) : (
                <a
                  href={asset.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex max-w-44 items-center gap-1.5 rounded-xl border border-border/60 bg-muted/40 p-1 pr-2.5 text-xs text-muted-foreground transition-colors hover:border-brand/25 hover:text-brand-dark"
                >
                  <span className="flex size-7 items-center justify-center rounded-lg bg-white">
                    <FileTextIcon className="size-3.5 text-brand" />
                  </span>
                  <span className="truncate">{asset.fileName}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {text ? (
        <p className="rounded-2xl rounded-br-md bg-linear-to-br from-brand to-brand-dark px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white shadow-sm shadow-brand/20">
          <span className="sr-only">You: </span>
          {text}
        </p>
      ) : null}
    </div>
  )
}

function AgentAvatar() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-brand/15 to-brand-accent/15 text-brand-dark"
    >
      <SparklesIcon className="size-3.5" />
    </span>
  )
}

/** What the agent is doing right now, with a shimmer so it reads as live. */
function ActivityLine({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm">
      <Spinner className="size-3.5 text-brand" aria-hidden />
      <span className="animate-shimmer bg-linear-to-r from-neutral-500 via-brand to-neutral-500 bg-size-[200%_auto] bg-clip-text text-transparent [animation-duration:2.5s]">
        {label}
      </span>
    </p>
  )
}

/** The model's thinking, when it shares it. Open while it thinks, collapsible afterwards. */
function Reasoning({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = React.useState(true)
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      >
        <BrainIcon className="size-3.5" />
        {active ? "Thinking…" : "Thought process"}
        <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <p className="mt-1.5 max-h-40 overflow-y-auto border-l-2 border-brand/25 pl-2.5 leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      )}
    </div>
  )
}

/** Plain-text replies, with "- " lines shown as bullet lists and **bold** spans. */
function MessageText({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-foreground">
      {blocks.map((block, i) => {
        const caret = streaming && i === blocks.length - 1 ? <StreamingCaret /> : null
        const lines = block.split("\n")
        if (lines.every((line) => /^\s*[-*•] /.test(line))) {
          return (
            <ul key={i} className="space-y-1">
              {lines.map((line, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-brand" />
                  <span>
                    <InlineText text={line.replace(/^\s*[-*•] /, "")} />
                    {j === lines.length - 1 && caret}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            <InlineText text={block} />
            {caret}
          </p>
        )
      })}
    </div>
  )
}

function InlineText({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}

function StreamingCaret() {
  return <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-brand align-text-bottom" />
}
