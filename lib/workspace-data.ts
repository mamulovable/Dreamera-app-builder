// Shared shapes and helpers for the workspace canvas and code view.

export type CanvasScreen = {
  id: string
  name: string
  /** Position on the canvas, in canvas pixels. */
  x: number
  y: number
  /** Which wireframe to draw inside the phone frame. */
  layout: "home" | "list" | "detail" | "profile"
}

export const SCREEN_WIDTH = 240
export const SCREEN_HEIGHT = 500

/** Horizontal space between screens laid out in a row. */
export const SCREEN_GAP = 60

export type FileNode =
  | { type: "folder"; name: string; children: FileNode[] }
  | { type: "file"; name: string; path: string }

/** Folders first, then files, each sorted by name. */
export function buildFileTree(paths: string[]): FileNode[] {
  type Folder = Map<string, Folder | string>
  const root: Folder = new Map()
  for (const path of paths) {
    const parts = path.split("/")
    let folder = root
    parts.slice(0, -1).forEach((part) => {
      if (!(folder.get(part) instanceof Map)) folder.set(part, new Map())
      folder = folder.get(part) as Folder
    })
    folder.set(parts.at(-1)!, path)
  }

  const toNodes = (folder: Folder): FileNode[] =>
    [...folder.entries()]
      .map(([name, value]): FileNode =>
        typeof value === "string"
          ? { type: "file", name, path: value }
          : { type: "folder", name, children: toNodes(value) }
      )
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1))
  return toNodes(root)
}

export function languageForPath(path: string) {
  const extension = path.split(".").pop() ?? ""
  return ({ tsx: "tsx", ts: "typescript", json: "json", js: "javascript" } as Record<string, string>)[extension] ?? "text"
}
