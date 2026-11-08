import { NextResponse } from "next/server"

import { signUpWithEmail } from "@/lib/cloudhike-auth"
import { authErrorResponse, readAuthBody } from "@/lib/auth-route"
import { ensureUser, setSessionCookie, toSessionUser } from "@/lib/session"

export async function POST(request: Request) {
  const parsed = await readAuthBody(request, "sign-up")
  if ("response" in parsed) return parsed.response

  try {
    const { token, user: authUser } = await signUpWithEmail(parsed.fields)
    const user = await ensureUser(authUser)
    await setSessionCookie(token)
    return NextResponse.json({ user: toSessionUser(user, authUser) })
  } catch (error) {
    return authErrorResponse(error)
  }
}
