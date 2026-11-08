// Shared by the sign-in dialog and the auth API routes.

export type AuthMode = "sign-in" | "sign-up"

export type AuthFields = {
  name: string
  email: string
  password: string
}

export type FieldErrors = Partial<Record<keyof AuthFields, string>>

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeAuthFields(input: Partial<Record<keyof AuthFields, unknown>>): AuthFields {
  return {
    name: typeof input.name === "string" ? input.name.trim() : "",
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : "",
    password: typeof input.password === "string" ? input.password : "",
  }
}

export function validateAuthFields(mode: AuthMode, fields: AuthFields): FieldErrors {
  const errors: FieldErrors = {}

  if (mode === "sign-up") {
    if (!fields.name) errors.name = "Enter your name."
    else if (fields.name.length > 100) errors.name = "Name must be 100 characters or fewer."
  }

  if (!fields.email) errors.email = "Enter your email address."
  else if (!EMAIL_PATTERN.test(fields.email) || fields.email.length > 254)
    errors.email = "Enter a valid email address."

  if (!fields.password) errors.password = "Enter your password."
  else if (mode === "sign-up" && fields.password.length < PASSWORD_MIN)
    errors.password = `Password must be at least ${PASSWORD_MIN} characters.`
  else if (fields.password.length > PASSWORD_MAX)
    errors.password = `Password must be ${PASSWORD_MAX} characters or fewer.`

  return errors
}
