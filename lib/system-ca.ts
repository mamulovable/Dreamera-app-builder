import { getCACertificates, setDefaultCACertificates } from "node:tls"

let applied = false

/** Trust the operating-system certificate store as well as Node's built-in roots. */
export function useSystemCertificates() {
  if (applied) return
  applied = true
  try {
    const system = getCACertificates("system")
    if (system.length === 0) return
    setDefaultCACertificates([...getCACertificates("default"), ...system])
  } catch {
    // Keep Node's built-in certificates when the system store cannot be read.
  }
}

useSystemCertificates()
