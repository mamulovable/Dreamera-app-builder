import { NextResponse } from "next/server"

import { AuthError } from "@/lib/cloudhike-auth"
import {
  normalizeAuthFields,
  validateAuthFields,
  type AuthFields,
  type AuthMode,
} from "@/lib/auth-validation"

const FRIENDLY_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Incorrect email or password.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Try signing in.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Try signing in.",
  PASSWORD_TOO_SHORT: "Password is too short.",
  PASSWORD_TOO_LONG: "Password is too long.",
  INVALID_EMAIL: "Enter a valid email address.",
}

export async function readAuthBody(
  request: Request,
  mode: AuthMode
): Promise<{ fields: AuthFields } | { response: NextResponse }> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return { response: NextResponse.json({ error: "Invalid request." }, { status: 400 }) }
  }

  const fields = normalizeAuthFields(body)
  const fieldErrors = validateAuthFields(mode, fields)
  if (Object.keys(fieldErrors).length > 0) {
    return {
      response: NextResponse.json(
        { error: "Please fix the highlighted fields.", fieldErrors },
        { status: 400 }
      ),
    }
  }
  return { fields }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError && error.status < 500) {
    const message =
      (error.code && FRIENDLY_ERRORS[error.code]) ||
      (error.status === 429
        ? "Too many attempts. Please wait a moment and try again."
        : error.message)
    return NextResponse.json({ error: message }, { status: error.status })
  }

  console.error("Auth request failed", error)
  return NextResponse.json(
    { error: "Something went wrong on our side. Please try again." },
    { status: 500 }
  )
}
