// Shared by the social sign-in routes, the callback page, and the composer.

export const SOCIAL_PROVIDERS = ["google", "github"] as const
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number]

export function isSocialProvider(value: string): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value)
}

/** Where the composer parks an unsent prompt while the browser visits the provider. */
export const PENDING_PROMPT_KEY = "appforge:pending-prompt"
