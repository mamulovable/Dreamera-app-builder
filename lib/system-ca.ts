import * as tls from "node:tls"

type CaStore = "default" | "system"

/** Present on Node 22.15+, 23.10+, and 24+. @types/node 20 does not declare them. */
type TlsWithSystemCa = typeof tls & {
  getCACertificates?: (type?: CaStore) => string[]
  setDefaultCACertificates?: (certs: readonly string[]) => void
}

const tlsCa = tls as TlsWithSystemCa

let applied = false

/** Trust the operating-system certificate store as well as Node's built-in roots. */
export function useSystemCertificates() {
  if (applied) return
  applied = true
  const getCACertificates = tlsCa.getCACertificates
  const setDefaultCACertificates = tlsCa.setDefaultCACertificates
  if (!getCACertificates || !setDefaultCACertificates) return
  try {
    const system = getCACertificates("system")
    if (system.length === 0) return
    setDefaultCACertificates([...getCACertificates("default"), ...system])
  } catch {
    // Keep Node's built-in certificates when the system store cannot be read.
  }
}

useSystemCertificates()
