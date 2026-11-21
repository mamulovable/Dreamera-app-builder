import { AsyncLocalStorage } from "node:async_hooks"

export type BuilderCallKind = "planner" | "screen" | "component" | "foundation" | "data" | "page" | "build"

export type BuilderCallScope = {
  projectId: string
  userId: number
  kind: BuilderCallKind
  label: string
}

const storage = new AsyncLocalStorage<BuilderCallScope>()

export function builderCallScope() {
  return storage.getStore() ?? null
}

/** Every model call inside `fn` is logged against this project. */
export function withBuilderCall<T>(scope: BuilderCallScope, fn: () => Promise<T>) {
  return storage.run(scope, fn)
}

/** Names the next model call. A screen rewrite keeps the screen's name. */
export function noteBuilderCall(kind: BuilderCallKind, label: string) {
  const scope = storage.getStore()
  if (!scope) return
  scope.kind = kind
  scope.label = label
}
