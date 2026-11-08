"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ArrowUpIcon,
  BrainIcon,
  ChevronRightIcon,
  EyeIcon,
  FileTextIcon,
  MessageSquarePlusIcon,
  PaperclipIcon,
  RotateCwIcon,
  SparklesIcon,
  SquareDashedMousePointerIcon,
  XIcon,
} from "lucide-react"

import type { InlineEditor } from "@/hooks/use-inline-editor"
import type { useProjectAgent } from "@/hooks/use-project-agent"
import { splitElementMessage, type ChatMessage } from "@/lib/agent-protocol"
import { ELEMENT_LABELS } from "@/lib/preview-protocol"
import { MAX_PROMPT_LENGTH } from "@/lib/projects"
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

export function ChatPanel({ agent, assets, editor }: { agent: Agent; assets: ChatAsset[]; editor: InlineEditor }) {
  const [draft, setDraft] = React.useState("")
  const [newSessionOpen, setNewSessionOpen] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const following = React.useRef(true)
  const { messages, status, busy, activity, streamingText, reasoning, error, screens, send, startNewSession, sessionRestarted } = agent

  const firstUserId = sessionRestarted ? undefined : messages.find((m) => m.role === "user")?.id
  const latestPlanId = messages.findLast((m) => m.plan)?.id
  // A new session archives the message that held the plan's card, and the plan can still be waiting for confirmation.
  const waitingPlan = (status === "planning" || status === "failed") && !latestPlanId ? agent.plan : null
  const canRetry = !editor.readOnly && (status === "building" || messages.at(-1)?.role === "user")
  const confirmPlan = editor.readOnly
    ? undefined
    : () => {
        following.current = true
        void send({ action: "confirm" })
      }
  const showBuild = screens.length > 0 && status === "building"
  const inputLocked = busy || status === "building"
  const attachment = editor.attached ? editor.selection : null
  const attachmentLabel = attachment && (ELEMENT_LABELS[attachment.type] ?? attachment.type)

  // Keep the newest output in view while the agent streams, unless the person scrolled up.
  React.useEffect(() => {
    const el = scrollRef.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [messages, streamingText, reasoning, activity, screens, error])

  function planState(message: ChatMessage): PlanCardState {
    if (message.id !== latestPlanId) return "superseded"
    return status === "planning" || status === "failed" ? "pending" : "confirmed"
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    const content = draft.trim()
    if (!content || inputLocked) return
    following.current = true
    setDraft("")
    // Put the text back if the agent didn't take it.
    if (!(await editor.sendMessage(content).catch(() => false))) setDraft((d) => d || content)
  }

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <span className="flex size-6 items-center justify-center rounded-lg bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white">
          <SparklesIcon className="size-3.5" />
        </span>
        <h2 className="text-sm font-semibold">AppForge Agent</h2>
        <div className="ml-auto flex items-center gap-2">
          {busy && (
            <span className="inline-flex items-center gap-1.5 text-xs text-violet-700">
              <span className="size-1.5 animate-pulse rounded-full bg-violet-500" />
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
                  className="h-7 rounded-full px-2 text-xs text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
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
                <UserMessage content={message.content} />
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
                    />
                  )}
                </div>
              )}
              {message.id === firstUserId && assets.length > 0 && (
                <ul aria-label="Attached files" className="flex w-full flex-wrap justify-end gap-1.5">
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <a
                        href={asset.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="flex max-w-44 items-center gap-1.5 rounded-xl border border-border/60 bg-muted/40 p-1 pr-2.5 text-xs text-muted-foreground transition-colors hover:border-violet-200 hover:text-violet-700"
                      >
                        {asset.url && asset.contentType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.url} alt="" className="size-7 rounded-lg object-cover" />
                        ) : (
                          <span className="flex size-7 items-center justify-center rounded-lg bg-white">
                            <FileTextIcon className="size-3.5 text-violet-600" />
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
      <form onSubmit={handleSubmit} className="shrink-0 p-3">
        <div className="rounded-3xl bg-linear-to-br from-indigo-300/70 via-white to-fuchsia-300/70 p-px shadow-[0_12px_32px_-16px_rgba(76,29,149,0.35)] transition-colors focus-within:from-indigo-400 focus-within:to-fuchsia-400">
          <div className="rounded-[calc(1.5rem-1px)] bg-white p-2">
            {attachment && (
              <div className="mb-1 flex max-w-full items-center gap-1.5 self-start">
                <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 py-0.5 pr-0.5 pl-2 text-xs text-violet-800">
                  <SquareDashedMousePointerIcon className="size-3.5 shrink-0" />
                  <span className="font-medium">{attachmentLabel}</span>
                  {attachment.label && <span className="max-w-32 truncate text-violet-700/70">{attachment.label}</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${attachmentLabel} from this message`}
                    onClick={editor.detach}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-violet-500/15"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              </div>
            )}
            <label htmlFor="chat-prompt" className="sr-only">
              Message the AppForge agent
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
              maxLength={MAX_PROMPT_LENGTH}
              rows={2}
              disabled={status === "building"}
              placeholder={
                status === "building"
                  ? "Building your screens…"
                  : attachment
                    ? `Ask for a change to this ${attachmentLabel?.toLowerCase()}…`
                    : agent.plan
                    ? "Ask for changes… e.g. Add a settings screen"
                    : "Message the agent…"
              }
              className="field-sizing-content block max-h-40 min-h-12 w-full resize-none bg-transparent px-2 pt-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach file"
                className="rounded-full text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
              >
                <PaperclipIcon />
              </Button>
              <Button
                type="submit"
                size="icon"
                disabled={!draft.trim() || inputLocked}
                aria-label={busy ? "The agent is working" : "Send message"}
                className="rounded-full bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30 hover:opacity-95 disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none"
              >
                {busy ? <Spinner className="text-current" /> : <ArrowUpIcon />}
              </Button>
            </div>
          </div>
        </div>
      </form>
      )}
    </section>
  )
}

function UserMessage({ content }: { content: string }) {
  const { text, element } = splitElementMessage(content)
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1">
      {element && (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800">
          <SquareDashedMousePointerIcon className="size-3 shrink-0" />
          <span className="truncate">
            {element.label} in {element.screen}
          </span>
        </span>
      )}
      <p className="rounded-2xl rounded-br-md bg-linear-to-br from-indigo-500 to-violet-500 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white shadow-sm shadow-violet-500/20">
        <span className="sr-only">You: </span>
        {text}
      </p>
    </div>
  )
}

function AgentAvatar() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-700"
    >
      <SparklesIcon className="size-3.5" />
    </span>
  )
}

/** What the agent is doing right now, with a shimmer so it reads as live. */
function ActivityLine({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm">
      <Spinner className="size-3.5 text-violet-600" aria-hidden />
      <span className="animate-shimmer bg-linear-to-r from-neutral-500 via-violet-600 to-neutral-500 bg-size-[200%_auto] bg-clip-text text-transparent [animation-duration:2.5s]">
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
        <p className="mt-1.5 max-h-40 overflow-y-auto border-l-2 border-violet-200 pl-2.5 leading-relaxed whitespace-pre-wrap">
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
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-violet-400" />
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
  return <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-violet-500 align-text-bottom" />
}
