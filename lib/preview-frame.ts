import { PREVIEW_FRAME_URL } from "@/lib/preview-protocol"

const FRAME_HTML = "/preview-runtime/frame.html"
const RUNTIME_SCRIPT = '<script src="/preview-runtime/runtime.js"></script>'

export type PreviewFrameSource = { srcDoc: string } | { src: string }

let source: PreviewFrameSource | null = null
let started = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** The preview document, once the page has loaded it. Null while that's in flight. */
export function getPreviewFrameSource() {
  return source
}

export function subscribePreviewFrameSource(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Loads the preview document from this page and hands it to the sandboxed frame.
 * The frame can't send this page's cookies, so navigating it to the preview URL
 * gets ngrok's warning page instead of the runtime, and the preview stays blank.
 */
export function ensurePreviewFrameSource() {
  if (started) return
  started = true
  loadPreviewFrameDocument()
    .then((srcDoc) => {
      source = { srcDoc }
      emit()
    })
    .catch(() => {
      source = { src: PREVIEW_FRAME_URL }
      emit()
    })
}

async function loadPreviewFrameDocument() {
  const [html, code] = await Promise.all([
    fetch(FRAME_HTML, { headers: { "ngrok-skip-browser-warning": "1" } }).then(readText),
    fetch("/preview-runtime/runtime.js", { headers: { "ngrok-skip-browser-warning": "1" } }).then(readText),
  ])
  if (!html.includes(RUNTIME_SCRIPT)) throw new Error("The preview frame is missing its runtime script.")
  // Minified code can contain "$&" and "</script>", both of which would break the document.
  const inline = code.replace(/<\/script/gi, "<\\/script")
  return html.replace(RUNTIME_SCRIPT, () => `<script>${inline}</script>`)
}

async function readText(response: Response) {
  if (!response.ok) throw new Error(`Couldn't load the preview (${response.status}).`)
  const text = await response.text()
  if (text.includes("ERR_NGROK_6024")) throw new Error("The preview request was intercepted.")
  return text
}
