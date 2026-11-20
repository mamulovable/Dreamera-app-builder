"use client"

import * as React from "react"

import type { PreviewFile } from "@/lib/preview-protocol"
import { cn } from "@/lib/utils"

export type HtmlPage = { path: string; code: string }

/** Turns a clicked link into one of this site's filenames. */
export function htmlPageFile(href: string) {
  const bare = href.split("#")[0].split("?")[0].replace(/^\.\//, "")
  const name = bare.split("/").filter(Boolean).pop() ?? "index.html"
  if (name === "" || bare.endsWith("/")) return "index.html"
  return name.includes(".") ? name : `${name}.html`
}

function documentFor(html: string, css: string, js: string) {
  const style = css.replace(/<\/style/gi, "<\\/style")
  const script = js.replace(/<\/script/gi, "<\\/script")
  const withFiles = html
    .replace(/<link\b[^>]*href=["']styles\.css["'][^>]*>/i, `<style>${style}</style>`)
    .replace(/<script\b[^>]*src=["']site\.js["'][^>]*>\s*<\/script>/i, `<script>${script}</script>`)
  const shim = `<script>
document.addEventListener("click", function (event) {
  var node = event.target
  var link = node && node.closest ? node.closest("a") : null
  if (!link) return
  var href = link.getAttribute("href")
  if (!href || href.charAt(0) === "#" || /^(https?:|mailto:|tel:)/i.test(href)) return
  event.preventDefault()
  parent.postMessage({ source: "appforge-html", href: href }, "*")
}, true)
</script>`
  return withFiles.replace(/<\/body>/i, `${shim}</body>`)
}

/**
 * Shows one HTML page with its shared CSS and script inlined. The sandbox cannot
 * fetch sibling files, and links are handed back to the parent as filenames.
 */
export function HtmlFrame({
  pages,
  css,
  js,
  page,
  interactive = true,
  title,
  reloadSignal = 0,
  className,
  onNavigate,
}: {
  pages?: HtmlPage[]
  css: string
  js: string
  /** One page, when this frame does not switch pages itself. */
  page?: string
  interactive?: boolean
  title: string
  reloadSignal?: number
  className?: string
  onNavigate?: (path: string) => void
}) {
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const list = pages ?? (page ? [{ path: "page.html", code: page }] : [])
  const listRef = React.useRef(list)
  listRef.current = list
  const names = list.map((entry) => entry.path).join("|")
  const [path, setPath] = React.useState(list.find((entry) => entry.path === "index.html")?.path ?? list[0]?.path ?? "")
  const current = list.find((entry) => entry.path === path) ?? list[0]

  React.useEffect(() => {
    const available = listRef.current
    if (!available.some((entry) => entry.path === path)) {
      setPath(available.find((entry) => entry.path === "index.html")?.path ?? available[0]?.path ?? "")
    }
  }, [names, path])

  React.useEffect(() => {
    if (!interactive) return
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { source?: string; href?: string } | null
      if (data?.source !== "appforge-html" || typeof data.href !== "string") return
      const next = htmlPageFile(data.href)
      if (onNavigate) onNavigate(next)
      if (listRef.current.some((entry) => entry.path === next)) setPath(next)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [interactive, onNavigate])

  if (!current) return null

  return (
    <iframe
      ref={frameRef}
      key={`${current.path}:${reloadSignal}`}
      title={title}
      sandbox="allow-scripts allow-popups"
      srcDoc={documentFor(current.code, css, js)}
      className={cn("size-full border-0 bg-white", !interactive && "pointer-events-none", className)}
    />
  )
}

export function htmlFiles(files: PreviewFile[]) {
  return {
    css: files.find((file) => file.path === "styles.css")?.code ?? "",
    js: files.find((file) => file.path === "site.js")?.code ?? "",
    pages: files.filter((file) => file.path.endsWith(".html")).map((file) => ({ path: file.path, code: file.code })),
  }
}
