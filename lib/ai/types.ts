/** Which AI jobs this server can run, and whether this project is allowed to use them. */
export type AppAiAvailability = {
  enabled: boolean
  text: boolean
  voice: boolean
  vision: boolean
}

export type AiTask = "text" | "transcribe" | "vision"

export type AiTurn = { role: "user" | "assistant"; content: string }
