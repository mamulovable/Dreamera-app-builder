"use client"

import * as React from "react"
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react"

import { useAuth, type SessionUser } from "@/lib/auth-client"
import {
  PASSWORD_MIN,
  normalizeAuthFields,
  validateAuthFields,
  type AuthMode,
  type FieldErrors,
} from "@/lib/auth-validation"
import { type SocialProvider } from "@/lib/social-auth"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Logo } from "@/components/home/logo"

type OpenSignInOptions = {
  /** Shown under the title, e.g. to explain why sign-in is needed. */
  reason?: string
  /** Runs once after the user signs in or signs up from this dialog. */
  onSuccess?: (user: SessionUser) => void
  /** Runs just before the browser leaves for Google / GitHub sign-in. */
  onSocialRedirect?: () => void
}

type SignInDialogContextValue = {
  openSignIn: (mode?: AuthMode, options?: OpenSignInOptions) => void
}

const SignInDialogContext = React.createContext<SignInDialogContextValue | null>(
  null
)

export function useSignInDialog() {
  const ctx = React.useContext(SignInDialogContext)
  if (!ctx) {
    throw new Error("useSignInDialog must be used within SignInDialogProvider")
  }
  return ctx
}

export function SignInDialogProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<AuthMode>("sign-in")
  const [reason, setReason] = React.useState<string | undefined>()
  // Bumped on every open so the form starts fresh.
  const [formKey, setFormKey] = React.useState(0)
  const onSuccessRef = React.useRef<OpenSignInOptions["onSuccess"]>(undefined)
  const onSocialRedirectRef =
    React.useRef<OpenSignInOptions["onSocialRedirect"]>(undefined)

  const openSignIn = React.useCallback(
    (nextMode: AuthMode = "sign-in", options: OpenSignInOptions = {}) => {
      onSuccessRef.current = options.onSuccess
      onSocialRedirectRef.current = options.onSocialRedirect
      setReason(options.reason)
      setMode(nextMode)
      setFormKey((key) => key + 1)
      setOpen(true)
    },
    []
  )

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next)
    // Dismissed without signing in: forget the pending action.
    if (!next) {
      onSuccessRef.current = undefined
      onSocialRedirectRef.current = undefined
    }
  }, [])

  const handleSuccess = React.useCallback((user: SessionUser) => {
    const callback = onSuccessRef.current
    onSuccessRef.current = undefined
    setOpen(false)
    callback?.(user)
  }, [])

  const handleSocialRedirect = React.useCallback(() => {
    onSocialRedirectRef.current?.()
  }, [])

  const value = React.useMemo(() => ({ openSignIn }), [openSignIn])

  return (
    <SignInDialogContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="gap-6 p-6 sm:max-w-md">
          <SignInForm
            key={formKey}
            mode={mode}
            reason={reason}
            onModeChange={setMode}
            onSuccess={handleSuccess}
            onSocialRedirect={handleSocialRedirect}
          />
        </DialogContent>
      </Dialog>
    </SignInDialogContext.Provider>
  )
}

function SignInForm({
  mode,
  reason,
  onModeChange,
  onSuccess,
  onSocialRedirect,
}: {
  mode: AuthMode
  reason?: string
  onModeChange: (mode: AuthMode) => void
  onSuccess: (user: SessionUser) => void
  onSocialRedirect: () => void
}) {
  const { authenticate } = useAuth()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [showPassword, setShowPassword] = React.useState(false)
  const [socialPending, setSocialPending] = React.useState<SocialProvider | null>(null)
  const formRef = React.useRef<HTMLFormElement>(null)
  const isSignUp = mode === "sign-up"

  function focusFirstInvalid(errors: FieldErrors) {
    const first = (["name", "email", "password"] as const).find((f) => errors[f])
    if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const form = new FormData(event.currentTarget)
    const fields = normalizeAuthFields({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    })

    const errors = validateAuthFields(mode, fields)
    setFieldErrors(errors)
    setError(null)
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(errors)
      return
    }

    setPending(true)
    const result = await authenticate(mode, fields)
    if (result.user) {
      onSuccess(result.user)
      return
    }
    setPending(false)
    setError(result.error)
    if (result.fieldErrors) {
      setFieldErrors(result.fieldErrors)
      focusFirstInvalid(result.fieldErrors)
    }
  }

  function signInWith(provider: SocialProvider) {
    if (pending || socialPending) return
    setSocialPending(provider)
    setError(null)
    onSocialRedirect()
    window.location.assign(`/api/auth/social/${provider}`)
  }

  function clearFieldError(field: keyof FieldErrors) {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function switchMode() {
    setError(null)
    setFieldErrors({})
    onModeChange(isSignUp ? "sign-in" : "sign-up")
  }

  return (
    <>
      <DialogHeader className="items-center gap-3 text-center">
        <Logo showText={false} className="size-10" />
        <div className="space-y-1">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {isSignUp ? "Create your account" : "Welcome back"}
          </DialogTitle>
          <DialogDescription>
            {reason ??
              (isSignUp
                ? "Start turning your ideas into mobile apps — with 100 free credits."
                : "Sign in to continue building with AppForge.")}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="grid gap-2 sm:grid-cols-2">
        <SocialButton
          provider="google"
          label="Google"
          pending={socialPending === "google"}
          disabled={pending || socialPending !== null}
          onClick={() => signInWith("google")}
        />
        <SocialButton
          provider="github"
          label="GitHub"
          pending={socialPending === "github"}
          disabled={pending || socialPending !== null}
          onClick={() => signInWith("github")}
        />
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or continue with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid gap-4">
        <fieldset disabled={pending || socialPending !== null} className="grid gap-4">
          {isSignUp && (
            <FormField id="name" label="Name" error={fieldErrors.name}>
              <Input
                id="name"
                name="name"
                placeholder="Jane Doe"
                autoComplete="name"
                maxLength={100}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? "name-error" : undefined}
                onChange={() => clearFieldError("name")}
                className="h-10"
              />
            </FormField>
          )}
          <FormField id="email" label="Email" error={fieldErrors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              onChange={() => clearFieldError("email")}
              className="h-10"
            />
          </FormField>
          <FormField
            id="password"
            label="Password"
            error={fieldErrors.password}
            hint={isSignUp ? `At least ${PASSWORD_MIN} characters.` : undefined}
          >
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={
                  fieldErrors.password
                    ? "password-error"
                    : isSignUp
                      ? "password-hint"
                      : undefined
                }
                onChange={() => clearFieldError("password")}
                className="h-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
          </FormField>
        </fieldset>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="h-10"
          disabled={pending || socialPending !== null}
        >
          {pending && <Loader2Icon className="animate-spin" />}
          {pending
            ? isSignUp
              ? "Creating account…"
              : "Signing in…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? "Already have an account?" : "New to AppForge?"}{" "}
        <button
          type="button"
          onClick={switchMode}
          disabled={pending || socialPending !== null}
          className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </button>
      </p>
    </>
  )
}

function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

function SocialButton({
  provider,
  label,
  pending,
  disabled,
  onClick,
}: {
  provider: SocialProvider
  label: string
  pending: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="h-10"
      disabled={disabled}
      onClick={onClick}
    >
      {pending ? (
        <Loader2Icon className="animate-spin" />
      ) : provider === "google" ? (
        <GoogleIcon />
      ) : (
        <GitHubIcon />
      )}
      {label}
    </Button>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}
