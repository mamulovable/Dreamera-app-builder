"use client"

import * as React from "react"

import type { useProjectAgent } from "@/hooks/use-project-agent"
import { componentFilePath, type AppPlan, type ProjectScreen } from "@/lib/agent-protocol"
import { useAuth } from "@/lib/auth-client"
import { isUpgradeReason } from "@/lib/plans"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"
import type { ElementInfo } from "@/lib/element-source"
import { ELEMENT_LABELS, type ElementEdit, type ElementEdits, type ElementRect, type InspectedElement } from "@/lib/preview-protocol"

type Agent = ReturnType<typeof useProjectAgent>
type ElementSource = typeof import("@/lib/element-source")

/**
 * A file with edits made by hand. The frames keep running `base`, which their
 * elements' line numbers refer to, with the edits on top of it. Each save writes
 * all the edits into `base` again.
 */
type EditedFile = {
  base: string
  /** The code with the edits written in, which the agent's state also has. */
  current: string
  /** What the server has. */
  saved: string
  edits: ElementEdits
}

export type EditorSelection = InspectedElement & {
  file: string
  line: number
  /** Null until the parser has loaded. */
  info: ElementInfo | null
  /** Whether this file is one the person can save to. */
  saveable: boolean
}

/** A new image for the selected element, from a file the person picked or from the AI. */
export type ImageRequest = { action: "upload"; file: File } | { action: "generate"; prompt: string } | { action: "transform"; prompt: string }

const SAVE_DELAY_MS = 400

/** The url an element's image has right now, or undefined if it comes from the app's data. */
function imageUri(selection: EditorSelection, edit: ElementEdit | undefined) {
  return (edit?.props?.source as { uri?: string } | undefined)?.uri ?? selection.info?.imageUri
}

function imageRequestInit(request: ImageRequest, sourceUrl: string | undefined): RequestInit {
  if (request.action === "upload") {
    const body = new FormData()
    body.set("file", request.file)
    return { method: "POST", body }
  }
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: request.action, prompt: request.prompt, sourceUrl }),
  }
}

function parseLocation(source: string) {
  const match = source.match(/^(.+):(\d+):\w+$/)
  return match ? { file: match[1], line: Number(match[2]) } : { file: "", line: 1 }
}

function mergeEdit(current: ElementEdit | undefined, patch: ElementEdit): ElementEdit {
  return {
    ...current,
    ...patch,
    style: patch.style ? { ...current?.style, ...patch.style } : current?.style,
    props: patch.props ? { ...current?.props, ...patch.props } : current?.props,
  }
}

/** Edit mode: what's selected, and the edits made by hand as they go to the frames and then to the server. */
export function useInlineEditor(projectId: string, agent: Agent, imageTools: boolean, readOnly = false) {
  const { plan, screens, busy, status, send, setFileCode } = agent
  const locked = readOnly || busy || status === "building"
  const openUpgrade = useUpgradeDialog()
  const { refresh: refreshAccount } = useAuth()

  const [editingScreenId, setEditingScreenId] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<EditorSelection | null>(null)
  const [attached, setAttached] = React.useState(false)
  const [advanced, setAdvanced] = React.useState(false)
  const [storedFiles, setStoredFiles] = React.useState<Record<string, EditedFile>>({})
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [selectParentSignal, setSelectParentSignal] = React.useState(0)
  const [clearSelectionSignal, setClearSelectionSignal] = React.useState(0)
  // By element, since an image keeps working after the person selects something else.
  const [imageJobs, setImageJobs] = React.useState<Record<string, ImageRequest["action"]>>({})
  const [imageErrors, setImageErrors] = React.useState<Record<string, string>>({})

  const fileCode = React.useCallback(
    (path: string) =>
      screens.find((s) => s.filePath === path)?.code ??
      plan?.components?.find((c) => componentFilePath(c.name) === path)?.code ??
      null,
    [plan?.components, screens]
  )

  // Once the agent changes a file, its code is the truth and the frames run that instead.
  const files = React.useMemo(() => {
    const entries = Object.entries(storedFiles).filter(([path, file]) => fileCode(path) === file.current)
    return entries.length === Object.keys(storedFiles).length ? storedFiles : Object.fromEntries(entries)
  }, [fileCode, storedFiles])

  const filesRef = React.useRef(files)
  const sourceRef = React.useRef<ElementSource | null>(null)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveQueue = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const lockedRef = React.useRef(locked)
  const selectionRef = React.useRef(selection)
  const fileCodeRef = React.useRef(fileCode)
  const imageJobsRef = React.useRef(imageJobs)
  React.useEffect(() => {
    filesRef.current = files
    lockedRef.current = locked
    selectionRef.current = selection
    fileCodeRef.current = fileCode
    imageJobsRef.current = imageJobs
    if (files !== storedFiles) setStoredFiles(files)
  })

  const loadSource = React.useCallback(async () => {
    sourceRef.current ??= await import("@/lib/element-source")
    return sourceRef.current
  }, [])

  /** Writes every file's edits into its code and saves the ones that changed. */
  const saveNow = React.useCallback(async () => {
    const source = await loadSource()
    let ok = true
    for (const [path, file] of Object.entries(filesRef.current)) {
      let current = file.current
      try {
        current = source.applyElementEdits(file.base, file.edits)
      } catch {
        setSaveError("Couldn't write your edit into this file. Use Edit with AI instead.")
        ok = false
        continue
      }
      if (current !== file.current) {
        const next = { ...filesRef.current, [path]: { ...file, current } }
        filesRef.current = next
        setStoredFiles((stored) => (stored[path] ? { ...stored, [path]: { ...stored[path], current } } : stored))
        setFileCode(path, current)
      }
      if (current === file.saved) continue
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, code: current, previous: file.saved }),
      }).catch(() => null)
      if (!response?.ok) {
        const body = await response?.json().catch(() => null)
        setSaveError(body?.error ?? (response ? "The server couldn't save your edit. Please try again." : "Couldn't reach the server to save your edit. Check your connection."))
        ok = false
        continue
      }
      setSaveError(null)
      const saved = current
      setStoredFiles((stored) => (stored[path] ? { ...stored, [path]: { ...stored[path], saved } } : stored))
      if (filesRef.current[path]) filesRef.current = { ...filesRef.current, [path]: { ...filesRef.current[path], saved } }
    }
    return ok
  }, [loadSource, projectId, setFileCode])

  /** Saves in order, so a newer edit can't arrive before an older one. */
  const flush = React.useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    setSaving(true)
    saveQueue.current = saveQueue.current.then(saveNow, saveNow).finally(() => setSaving(false))
    return saveQueue.current
  }, [saveNow])

  const scheduleSave = React.useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }, [flush])

  // An edit made just before leaving the page still has to be saved.
  React.useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const unsaved = Object.values(filesRef.current).some((file) => file.current !== file.saved)
      const imageComing = Object.keys(imageJobsRef.current).length > 0
      if (saveTimer.current === undefined && !unsaved && !imageComing) return
      void flush()
      event.preventDefault()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [flush])

  const exit = React.useCallback(() => {
    setEditingScreenId(null)
    setSelection(null)
    setAttached(false)
    setAdvanced(false)
    // Also tries again if the last save failed, rather than leaving the edit unsaved.
    if (saveTimer.current !== undefined || Object.values(filesRef.current).some((file) => file.current !== file.saved)) void flush()
  }, [flush])

  const enter = React.useCallback(
    (screenId: string) => {
      setSelection(null)
      setAttached(false)
      setEditingScreenId(screenId)
      void loadSource()
    },
    [loadSource]
  )

  // Editing stops while the agent works on the files. What couldn't be saved goes once it's done.
  React.useEffect(() => {
    if (locked) {
      setEditingScreenId(null)
      setSelection(null)
      setAttached(false)
      setAdvanced(false)
    } else if (saveError && Object.values(filesRef.current).some((file) => file.current !== file.saved)) {
      void flush()
    }
    // Only when the lock changes: a failed save shouldn't retry on its own in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked])

  const handleSelected = React.useCallback(
    (element: InspectedElement | null) => {
      if (!element) {
        setSelection(null)
        setAttached(false)
        return
      }
      const { file, line } = parseLocation(element.source)
      const code = filesRef.current[file]?.base ?? fileCode(file)
      const next: EditorSelection = { ...element, file, line, info: null, saveable: code !== null }
      setSelection(next)
      setAttached(true)
      if (code === null) return
      void loadSource().then((source) => {
        const info = source.inspectElement(code, element.source)
        setSelection((current) => (current?.source === element.source ? { ...current, info } : current))
      })
    },
    [fileCode, loadSource]
  )

  const handleMoved = React.useCallback((rect: ElementRect) => {
    setSelection((current) => current && { ...current, rect })
  }, [])

  const handleChanged = React.useCallback((change: Pick<InspectedElement, "computed" | "label" | "instances">) => {
    setSelection((current) => current && { ...current, ...change })
  }, [])

  /** Shows the change straight away, and saves it shortly after. */
  const updateElement = React.useCallback(
    (target: EditorSelection, patch: ElementEdit) => {
      if (!target.saveable || target.info?.editable === false) return
      const code = fileCodeRef.current(target.file)
      if (code === null) return
      setSaveError(null)
      setStoredFiles((stored) => {
        const file = stored[target.file] ?? { base: code, current: code, saved: code, edits: {} }
        return {
          ...stored,
          [target.file]: { ...file, edits: { ...file.edits, [target.source]: mergeEdit(file.edits[target.source], patch) } },
        }
      })
      scheduleSave()
    },
    [scheduleSave]
  )

  const updateSelected = React.useCallback(
    (patch: ElementEdit) => {
      if (selectionRef.current) updateElement(selectionRef.current, patch)
    },
    [updateElement]
  )

  /**
   * Gets a new image for the selected element and puts it in like any other edit. This
   * can take a minute, so the result goes to the element this started on, whatever's selected by then.
   */
  const changeImage = React.useCallback(
    async (request: ImageRequest) => {
      const target = selectionRef.current
      if (!target || !target.saveable || target.info?.editable === false || imageJobsRef.current[target.source]) return false
      const { source, file: path } = target
      const baseCode = () => filesRef.current[path]?.base ?? fileCodeRef.current(path)
      const startedOn = baseCode()
      imageJobsRef.current = { ...imageJobsRef.current, [source]: request.action }
      setImageJobs((jobs) => ({ ...jobs, [source]: request.action }))
      setImageErrors(({ [source]: _cleared, ...others }) => others)
      const finish = () => {
        const { [source]: _done, ...others } = imageJobsRef.current
        imageJobsRef.current = others
        setImageJobs(others)
      }
      try {
        const response = await fetch(`/api/projects/${projectId}/images`, imageRequestInit(request, imageUri(target, filesRef.current[path]?.edits[source])))
        const body = await response.json().catch(() => null)
        if (isUpgradeReason(body?.code)) openUpgrade(body.code)
        if (!response.ok || typeof body?.url !== "string") throw new Error(body?.error ?? "Couldn't finish this image. Please try again.")
        void refreshAccount()
        // An element is known by its line, so in code that changed this could land on another one.
        if (lockedRef.current || baseCode() !== startedOn) throw new Error("This screen changed while your image was being made. Please try again.")
        updateElement(target, { props: { source: { uri: body.url } } })
        return true
      } catch (cause) {
        const message = cause instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : (cause as Error).message
        setImageErrors((errors) => ({ ...errors, [source]: message }))
        return false
      } finally {
        finish()
      }
    },
    [openUpgrade, projectId, refreshAccount, updateElement]
  )

  const resetSelected = React.useCallback(() => {
    const current = selectionRef.current
    if (!current) return
    setStoredFiles((stored) => {
      const file = stored[current.file]
      if (!file) return stored
      const { [current.source]: _removed, ...edits } = file.edits
      return { ...stored, [current.file]: { ...file, edits } }
    })
    scheduleSave()
  }, [scheduleSave])

  /** Saves what's waiting, then sends the message with the selected element if it's attached, or if `aboutSelection`. */
  const sendMessage = React.useCallback(
    async (content: string, aboutSelection = false) => {
      await flush()
      const current = aboutSelection || attachedRef.current ? selectionRef.current : null
      if (!current) return send({ action: "message", content })
      const file = filesRef.current[current.file]
      const code = file?.base ?? fileCode(current.file) ?? ""
      // The file and line still lead the agent there if the code can't be read here.
      const { line, snippet } = await loadSource()
        .then((source) => source.elementInCurrentCode(code, file?.edits ?? {}, current.source))
        .catch(() => ({ line: current.line, snippet: "" }))
      const screen = screens.find((s) => s.filePath === current.file)?.name ?? current.file.replace(/^components\/|\.tsx$/g, "")
      const sent = await send({
        action: "message",
        content,
        element: { file: current.file, line, label: ELEMENT_LABELS[current.type] ?? current.type, screen, snippet },
      })
      if (sent) setAttached(false)
      return sent
    },
    [fileCode, flush, loadSource, screens, send]
  )

  const attachedRef = React.useRef(attached)
  React.useEffect(() => {
    attachedRef.current = attached
  })

  const edits = React.useMemo(() => {
    const all: ElementEdits = {}
    for (const file of Object.values(files)) Object.assign(all, file.edits)
    return all
  }, [files])

  // The frames run the code their elements were stamped from, so an edit doesn't restart them.
  const runningScreens = React.useMemo<ProjectScreen[]>(
    () => screens.map((s) => (files[s.filePath] ? { ...s, code: files[s.filePath].base } : s)),
    [files, screens]
  )
  const runningPlan = React.useMemo<AppPlan | null>(() => {
    if (!plan?.components) return plan
    return {
      ...plan,
      components: plan.components.map((c) => {
        const file = files[componentFilePath(c.name)]
        return file ? { ...c, code: file.base } : c
      }),
    }
  }, [files, plan])

  return {
    locked,
    readOnly,
    editingScreenId,
    selection,
    attached,
    advanced,
    setAdvanced,
    saving,
    saveError,
    selectParentSignal,
    clearSelectionSignal,
    edits,
    selectedEdit: selection ? files[selection.file]?.edits[selection.source] : undefined,
    selectedImageUri: selection ? imageUri(selection, files[selection.file]?.edits[selection.source]) : undefined,
    selectedImageJob: selection ? imageJobs[selection.source] : undefined,
    selectedImageError: selection ? imageErrors[selection.source] : undefined,
    imageTools,
    changeImage,
    runningPlan,
    runningScreens,
    enter,
    exit,
    handleSelected,
    handleMoved,
    handleChanged,
    updateSelected,
    resetSelected,
    retrySave: flush,
    sendMessage,
    selectParent: React.useCallback(() => setSelectParentSignal((n) => n + 1), []),
    clearSelection: React.useCallback(() => {
      setClearSelectionSignal((n) => n + 1)
      setSelection(null)
      setAttached(false)
    }, []),
    detach: React.useCallback(() => setAttached(false), []),
  }
}

export type InlineEditor = ReturnType<typeof useInlineEditor>
