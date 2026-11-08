"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ChevronRightIcon,
  Code2Icon,
  ExternalLinkIcon,
  FileCodeIcon,
  FileJsonIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeIcon,
  Loader2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  SmartphoneIcon,
  SparklesIcon,
} from "lucide-react"

import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import type { WebPublishState } from "@/hooks/use-web-publish"
import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import type { ElementEdits, PreviewFile, PreviewProject } from "@/lib/preview-protocol"
import { resetPreviewStorage } from "@/lib/preview-storage"
import { WEB_PUBLISH_LABELS, isWebPublishActive } from "@/lib/publish-protocol"
import { activeTheme } from "@/lib/themes"
import { buildFileTree, languageForPath, type FileNode } from "@/lib/workspace-data"
import { cn } from "@/lib/utils"
import { AppFrame } from "@/components/workspace/app-frame"
import { CopyLinkButton, ExpoQrPopover } from "@/components/workspace/expo-qr-popover"
import { Button } from "@/components/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function PreviewPanel({
  projectId,
  plan,
  screens,
  app,
  appFiles,
  syncing,
  edits,
  webPublish,
  onOpenPublish,
}: {
  projectId: string
  plan: AppPlan | null
  screens: ProjectScreen[]
  /** The app as built so far. */
  app: PreviewProject
  /** The generated files besides the screens. */
  appFiles: PreviewFile[]
  /** True while the agent is working on the screens. */
  syncing: boolean
  /** Edits made by hand, shown on top of the running code. */
  edits: ElementEdits
  webPublish: WebPublishState
  onOpenPublish: () => void
}) {
  const [reloadSignal, setReloadSignal] = React.useState(0)
  const hasApp = screens.some((s) => s.status === "done")

  return (
    <Tabs defaultValue="preview" className="@container flex h-full min-h-0 gap-0 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <TabsList className="h-8 rounded-full bg-muted/70 p-0.5">
          <TabsTrigger value="preview" className="rounded-full px-3 data-active:text-violet-700">
            <SmartphoneIcon />
            App Preview
          </TabsTrigger>
          <TabsTrigger value="code" className="rounded-full px-3 data-active:text-violet-700">
            <Code2Icon />
            Code
          </TabsTrigger>
        </TabsList>
        {hasApp && (
          <div className="flex items-center gap-1">
            <ExpoQrPopover plan={plan} screens={screens} />
            <PreviewAction label="Reset app data" onClick={() => resetPreviewStorage(projectId)}>
              <RotateCcwIcon />
            </PreviewAction>
            <PreviewAction label="Reload preview" onClick={() => setReloadSignal((n) => n + 1)}>
              <RotateCwIcon />
            </PreviewAction>
          </div>
        )}
      </div>

      {/* Stays mounted, so looking at the code doesn't lose your place in the app. */}
      <TabsContent value="preview" keepMounted className="min-h-0 data-hidden:hidden">
        <AppPreview
          projectId={projectId}
          app={hasApp ? app : null}
          plan={plan}
          syncing={syncing}
          reloadSignal={reloadSignal}
          edits={edits}
          webPublish={webPublish}
          onOpenPublish={onOpenPublish}
        />
      </TabsContent>
      <TabsContent value="code" className="min-h-0">
        <CodeView screens={screens} appFiles={appFiles} />
      </TabsContent>
    </Tabs>
  )
}

function PreviewAction({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className="rounded-full text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function AppPreview({
  projectId,
  app,
  plan,
  syncing,
  reloadSignal,
  edits,
  webPublish,
  onOpenPublish,
}: {
  projectId: string
  app: PreviewProject | null
  plan: AppPlan | null
  syncing: boolean
  reloadSignal: number
  edits: ElementEdits
  webPublish: WebPublishState
  onOpenPublish: () => void
}) {
  return (
    <div className="flex h-full flex-col gap-3 bg-linear-to-b from-violet-50/60 to-white p-4">
      <WebsiteBar webPublish={webPublish} onOpenPublish={onOpenPublish} />
      {/* The phone takes all the room there is, keeping its shape in a tall or a wide panel. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]">
        <div className="relative aspect-[9/19] w-[min(100cqw,calc(100cqh*9/19))]">
          <div
            aria-hidden
            className="absolute -inset-6 rounded-full bg-linear-to-br from-indigo-300/30 via-fuchsia-300/25 to-violet-300/30 blur-3xl"
          />
          <div className="relative size-full overflow-hidden rounded-[2.75rem] border-[8px] border-neutral-900 bg-white shadow-[0_32px_64px_-24px_rgba(76,29,149,0.45)]">
            {app ? (
              <AppFrame
                projectId={projectId}
                project={app}
                theme={activeTheme(plan?.themePackage)}
                route="/"
                interactive
                title={`${plan?.appName ?? "App"} preview`}
                syncing={syncing}
                reloadSignal={reloadSignal}
                edits={edits}
              />
            ) : (
              <>
                <div className="absolute top-2 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full bg-neutral-900" />
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
                    <SparklesIcon className="size-5" />
                  </span>
                  <p className="text-sm font-medium">Your app preview will appear here</p>
                  <p className="text-xs text-muted-foreground">
                    Once the agent builds your screens, you can tap through them live.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The app's website: where it's live, and how an update is going. Empty until its first publish. */
function WebsiteBar({ webPublish, onOpenPublish }: { webPublish: WebPublishState; onOpenPublish: () => void }) {
  const { web, starting, active } = webPublish
  if (!web && !starting) return null

  const failed = !active && web?.status === "failed"
  const url = web?.url
  const step = starting || !web || !isWebPublishActive(web.status) ? "uploading" : web.status

  return (
    <div className="relative z-10 flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-border/60 bg-white py-1 pr-1 pl-3 shadow-xs">
      {active ? (
        <Loader2Icon aria-hidden className="size-3.5 shrink-0 animate-spin text-violet-600" />
      ) : failed ? (
        <AlertCircleIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <GlobeIcon aria-hidden className="size-3.5 shrink-0 text-emerald-600" />
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          className="min-w-0 flex-1 truncate text-xs font-medium hover:text-violet-700 hover:underline"
        >
          {url.replace(/^https:\/\//, "").replace(/\/$/, "")}
        </a>
      ) : (
        <span role="status" className="min-w-0 flex-1 truncate text-xs font-medium">
          {failed ? "Publishing failed" : `${WEB_PUBLISH_LABELS[step]}…`}
        </span>
      )}
      {url && (active || failed) && (
        <button
          type="button"
          onClick={onOpenPublish}
          className={cn("shrink-0 text-xs hover:underline", failed ? "text-destructive" : "text-muted-foreground")}
        >
          {failed ? "Update failed" : "Updating…"}
        </button>
      )}
      {!url && failed && (
        <Button variant="ghost" size="sm" className="rounded-full text-xs text-muted-foreground" onClick={onOpenPublish}>
          View
        </Button>
      )}
      {url && (
        <>
          <CopyLinkButton url={url} />
          <PreviewAction label="Open website" render={<a href={url} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <ExternalLinkIcon />
          </PreviewAction>
        </>
      )}
    </div>
  )
}

function CodeView({ screens, appFiles }: { screens: ProjectScreen[]; appFiles: PreviewFile[] }) {
  const files = [
    ...screens.filter((s) => s.code !== null),
    ...appFiles.map((file) => ({ filePath: file.path, code: file.code })),
  ]
  const generating = screens.find((s) => s.status === "generating")
  const [chosenPath, setChosenPath] = React.useState<string | null>(null)
  // Show the file the person picked; until they pick one, follow the file being written.
  const activePath =
    (files.some((f) => f.filePath === chosenPath) ? chosenPath : null) ??
    generating?.filePath ??
    files[0]?.filePath
  const active = files.find((f) => f.filePath === activePath)

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
          <Code2Icon className="size-5" />
        </span>
        <p className="text-sm font-medium">No code yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {generating
            ? `The agent is designing ${generating.name}. Its code appears here as it's written.`
            : "Once you confirm the plan, each screen's code streams in here as the agent writes it."}
        </p>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(140px,38%)_1fr]">
      <nav aria-label="Project files" className="min-h-0 overflow-y-auto border-r border-border/60 bg-neutral-50/70 py-2">
        <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Files
        </p>
        <FileTree
          nodes={buildFileTree(files.map((f) => f.filePath))}
          depth={0}
          activePath={active.filePath}
          writingPath={generating?.filePath}
          onSelect={setChosenPath}
        />
      </nav>
      <CodeFile path={active.filePath} code={active.code ?? ""} />
    </div>
  )
}

function FileTree({
  nodes,
  depth,
  activePath,
  writingPath,
  onSelect,
}: {
  nodes: FileNode[]
  depth: number
  activePath: string
  writingPath?: string
  onSelect: (path: string) => void
}) {
  return (
    <ul role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderItem
            key={node.name}
            node={node}
            depth={depth}
            activePath={activePath}
            writingPath={writingPath}
            onSelect={onSelect}
          />
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === activePath}>
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              style={{ paddingLeft: 12 + depth * 12 + 16 }}
              className={cn(
                "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors",
                node.path === activePath
                  ? "bg-violet-500/10 font-medium text-violet-700"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {node.name.endsWith(".json") ? (
                <FileJsonIcon className="size-3.5 shrink-0 text-amber-500" />
              ) : (
                <FileCodeIcon className="size-3.5 shrink-0 text-sky-500" />
              )}
              <span className="truncate">{node.name}</span>
              {node.path === writingPath && (
                <span aria-label="Being written" className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-violet-500" />
              )}
            </button>
          </li>
        )
      )}
    </ul>
  )
}

function FolderItem({
  node,
  depth,
  activePath,
  writingPath,
  onSelect,
}: {
  node: Extract<FileNode, { type: "folder" }>
  depth: number
  activePath: string
  writingPath?: string
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = React.useState(true)
  const Icon = open ? FolderOpenIcon : FolderIcon

  return (
    <li role="treeitem" aria-expanded={open} aria-selected={false}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: 12 + depth * 12 }}
        className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-foreground/80 transition-colors hover:bg-muted"
      >
        <ChevronRightIcon className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Icon className="size-3.5 shrink-0 text-violet-500" />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <FileTree
          nodes={node.children}
          depth={depth + 1}
          activePath={activePath}
          writingPath={writingPath}
          onSelect={onSelect}
        />
      )}
    </li>
  )
}

function CodeFile({ path, code }: { path: string; code: string }) {
  const lines = useHighlightedCode(code, languageForPath(path))

  return (
    <CodeBlock size="sm" className="h-full min-h-0 rounded-none border-0">
      <CodeBlockHeader className="border-b border-border/60 pb-2">
        <CodeBlockTitle className="font-mono">{path}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers className="flex-1">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
