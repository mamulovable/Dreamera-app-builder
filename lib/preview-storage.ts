// The data of the apps being previewed, kept in this browser's localStorage. All
// of a project's preview frames share it, like one app on one phone.

import type { PreviewStorage } from "@/lib/preview-protocol"

type Listener = (storage: PreviewStorage, source: unknown) => void

const listeners = new Map<string, Set<Listener>>()

const storageKey = (projectId: string) => `appforge:preview:${projectId}`

export function readPreviewStorage(projectId: string): PreviewStorage {
  try {
    return JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "{}") as PreviewStorage
  } catch {
    return {}
  }
}

const DEVICE_KEY = "app:backend:device"

function newDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * The project's storage, with the install id a cloud backend knows this "phone" by.
 * It's made here so all of a project's frames get the same one, instead of each
 * asking for its own at the same moment.
 */
export function ensurePreviewDevice(projectId: string) {
  const storage = readPreviewStorage(projectId)
  if (storage[DEVICE_KEY]) return storage
  storage[DEVICE_KEY] = newDeviceId()
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(storage))
  } catch (error) {
    console.warn("Couldn't save the preview's data", error)
  }
  return storage
}

function save(projectId: string, storage: PreviewStorage, source: unknown) {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(storage))
  } catch (error) {
    // Full or blocked: the running app keeps its copy until it's reloaded.
    console.warn("Couldn't save the preview's data", error)
  }
  listeners.get(projectId)?.forEach((listener) => listener(storage, source))
}

/** Saves one key from a frame. `source` is that frame, which already has the change. */
export function writePreviewStorage(projectId: string, key: string, value: string | null, source: unknown) {
  const storage = readPreviewStorage(projectId)
  if (value === null) delete storage[key]
  else storage[key] = value
  save(projectId, storage, source)
}

/** Back to how a new install starts: the sample data, or on a cloud backend, a new install with no records. */
export function resetPreviewStorage(projectId: string) {
  save(projectId, { [DEVICE_KEY]: newDeviceId() }, null)
}

export function subscribePreviewStorage(projectId: string, listener: Listener) {
  const set = listeners.get(projectId) ?? new Set<Listener>()
  listeners.set(projectId, set)
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}
