import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { isSocialProvider } from "@/lib/social-auth"
import { OAUTH_STATE_COOKIE } from "@/lib/session"

// Starts GitHub / Google sign-in. CloudHike returns the browser to /auth/callback
// with the session token in the URL fragment.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const authUrl = process.env.AUTH_URL
  if (!isSocialProvider(provider) || !authUrl) {
    return NextResponse.redirect(new URL("/auth/callback#error=unsupported_provider", request.url))
  }

  // Ties the callback to this browser so a token can't be planted from elsewhere.
  const state = randomBytes(16).toString("hex")
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const returnTo = new URL("/auth/callback", origin)
  returnTo.searchParams.set("state", state)

  const target = new URL(`${authUrl.replace(/\/$/, "")}/social/${provider}`)
  target.searchParams.set("to", returnTo.toString())

  const response = NextResponse.redirect(target)
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  })
  return response
}
