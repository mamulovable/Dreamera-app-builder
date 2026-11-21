/** Which AI jobs this server can run, and whether this project is allowed to use them. */
export type AppAiAvailability = {
  enabled: boolean
  text: boolean
  /** Speech to text. */
  voice: boolean
  /** Text to speech. */
  speech: boolean
  vision: boolean
}

export type AiTask = "text" | "transcribe" | "speech" | "vision"

export type AiTurn = { role: "user" | "assistant"; content: string }
