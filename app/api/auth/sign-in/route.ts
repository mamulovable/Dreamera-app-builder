import { NextResponse } from "next/server"

import { signInWithEmail } from "@/lib/cloudhike-auth"
import { authErrorResponse, readAuthBody } from "@/lib/auth-route"
import { ensureUser, setSessionCookie, toSessionUser } from "@/lib/session"

export async function POST(request: Request) {
  const parsed = await readAuthBody(request, "sign-in")
  if ("response" in parsed) return parsed.response

  try {
    const { email, password } = parsed.fields
    const { token, user: authUser } = await signInWithEmail({ email, password })
    const user = await ensureUser(authUser)
    await setSessionCookie(token)
    return NextResponse.json({ user: toSessionUser(user, authUser) })
  } catch (error) {
    return authErrorResponse(error)
  }
}
