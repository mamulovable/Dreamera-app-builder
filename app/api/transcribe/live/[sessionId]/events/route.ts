import { getLiveTranscribeSession, subscribeLiveTranscribe } from "@/lib/ai/live-transcribe-sessions"
import { getCurrentUser } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-sent events for a live transcription session (partial + final text).
 */
export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return new Response("Please sign in to use voice dictation.", { status: 401 })

  const { sessionId } = await context.params
  if (!getLiveTranscribeSession(sessionId, user.id)) {
    return new Response("That voice session isn't active anymore.", { status: 404 })
  }

  const encoder = new TextEncoder()

  let unsubscribe = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      unsubscribe = subscribeLiveTranscribe(sessionId, user.id, (event) => {
        send(event)
        if (event.type === "closed" || event.type === "error") {
          try {
            controller.close()
          } catch {
            // ignore
          }
        }
      })

      // Keepalive comments so proxies don't idle-close the stream.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          clearInterval(ping)
        }
      }, 15_000)

      const originalUnsubscribe = unsubscribe
      unsubscribe = () => {
        clearInterval(ping)
        originalUnsubscribe()
      }
    },
    cancel() {
      unsubscribe()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
