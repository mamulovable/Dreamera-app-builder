import "@/lib/system-ca"

// Server-only client for CloudHike Auth. Never import this from client components.

export type AuthUser = {
  id: string
  name: string
  email: string
  image?: string | null
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
  }
}

function authUrl(path: string) {
  const base = process.env.AUTH_URL
  if (!base) throw new AuthError("Authentication is not configured.", 500)
  return `${base.replace(/\/$/, "")}${path}`
}

async function authFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const res = await fetch(authUrl(path), {
    method: init.method ?? "GET",
    headers: {
      "x-api-key": process.env.AUTH_PUBLISHABLE_KEY ?? "",
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new AuthError(
      data?.message ?? "Authentication request failed.",
      res.status,
      data?.code
    )
  }
  return data as T
}

type AuthResult = { token: string; user: AuthUser }

export function signUpWithEmail(input: {
  name: string
  email: string
  password: string
}) {
  return authFetch<AuthResult>("/sign-up/email", { method: "POST", body: input })
}

export function signInWithEmail(input: { email: string; password: string }) {
  return authFetch<AuthResult>("/sign-in/email", { method: "POST", body: input })
}

export async function getAuthSession(token: string) {
  const data = await authFetch<{ user: AuthUser } | null>("/get-session", { token })
  return data?.user ? data : null
}

export function signOutSession(token: string) {
  return authFetch<unknown>("/sign-out", { method: "POST", body: {}, token })
}
