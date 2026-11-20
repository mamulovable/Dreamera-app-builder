import type { AppAiAvailability } from "@/lib/ai/types"
import { AI_DAILY_CREDIT_CAP, AI_TEXT_CREDITS, AI_VISION_CREDITS, AI_VOICE_CREDITS } from "@/lib/plans"

/**
 * The only AI API the screen builder is allowed to use. It is the contract for
 * lib/ai.ts. Groq runs every job on the server: text is openai/gpt-oss-120b,
 * voice is whisper-large-v3, photos are qwen/qwen3.8-27b. A screen that calls Groq itself is wrong.
 */
export const AI_BUILDER_RULES = `# AI in the app
The app's AI is three functions in "@/lib/ai". They are the whole API. There is no model argument, no API key, and no provider URL. The server chooses the provider.
- Text, chat, rewrite, summary, or an answer to words: \`askAi(prompt, history?)\` returns \`Promise<string>\`. \`prompt\` is the new message. \`history\` is optional earlier turns, oldest first, each \`{ role: "user" | "assistant", content: string }\`. Do not put \`prompt\` in \`history\` again. Do not use role \`"system"\`.
- A voice note: \`useVoiceNote()\` returns \`{ recording, start, stop }\`. \`start()\` asks for the microphone and begins recording. \`stop()\` returns a file uri string. Then \`transcribeAudio(uri)\` returns \`Promise<string>\` of the spoken words. If the person should also get an answer, pass that string to \`askAi\`. Do not import "expo-audio" or "expo-av". Do not call Groq or Whisper yourself.
- A photo: \`analyzeImage(uri, question)\` returns \`Promise<string>\`. \`uri\` is a local image from \`expo-image-picker\` (\`assets[0].uri\`). \`question\` is what to ask about that picture. Do not send the picture to \`askAi\`. Do not call Groq yourself.
- Import them with \`import { askAi, analyzeImage, transcribeAudio, useVoiceNote } from "@/lib/ai"\`. Import only the ones this screen uses.
- Each function throws an \`Error\` whose \`message\` is safe to show. Wrap the call in try/catch and show \`error.message\` inline. Show a busy state while the promise is running, and ignore a second press until it finishes.
- Keep a voice note under a minute. Keep a question under a few sentences. \`askAi\` history is at most 12 turns.
- Use these only when this screen's purpose or the requested change asks for a reply, a transcription, or an answer about a photo. Otherwise do not import "@/lib/ai".
- Never fetch api.openai.com, api.groq.com, or generativelanguage.googleapis.com. Never write an API key, a model name, or an Authorization header. Never read process.env.

A voice question, written this way and no other way:
\`const voice = useVoiceNote()\`
\`await voice.start()\`
\`const uri = await voice.stop()\`
\`const heard = await transcribeAudio(uri)\`
\`const reply = await askAi(heard, history)\`

A photo question, written this way and no other way:
\`const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 })\`
\`if (picked.canceled || !picked.assets?.[0]) return\`
\`const answer = await analyzeImage(picked.assets[0].uri, "What is in this photo?")\`

A text reply, written this way and no other way:
\`const reply = await askAi(draft)\``

export function aiPlannerSection(ai: AppAiAvailability) {
  const jobs = [
    ai.text ? `text replies (${AI_TEXT_CREDITS} credit, Groq on the server)` : "text replies are not set up on this server",
    ai.voice ? `voice notes (${AI_VOICE_CREDITS} credit, Groq Whisper on the server)` : "voice notes are not set up on this server",
    ai.vision ? `photo questions (${AI_VISION_CREDITS} credits, Groq vision on the server)` : "photo questions are not set up on this server",
  ]
  const state = ai.enabled
    ? "allowed. Screens may call askAi, transcribeAudio, and analyzeImage from @/lib/ai."
    : "not allowed. Tell them to click Allow AI at the top of the workspace. You cannot turn it on, and you never ask for an API key."
  return `# AI features
Dreamera AI is one switch for this app. The person clicks Allow AI once. Their credits pay for it, up to ${AI_DAILY_CREDIT_CAP} credits a day. The provider keys stay on the server.
- Right now AI is ${state}
- Jobs: ${jobs.join("; ")}.
- A chat, rewrite, summary, or answer to typed text uses askAi. A recording uses useVoiceNote and then transcribeAudio. An answer about a picture uses analyzeImage. A voice assistant that also replies is transcribeAudio and then askAi. Say which of these the screen should use inside the builder's request, and name the functions. The builder has the exact signatures and must not call a provider itself.
- If they want one of these and AI is not allowed, do not add that screen and do not call update_app for it. Tell them to click Allow AI, then ask again.
- If they say they turned AI on, add only the AI feature they already asked for. If they never asked for one, say AI is on and ask what they want it to do. Do not invent a chatbot.
- If a job says it is not set up on this server, say that kind of AI isn't available here. Do not write a screen that pretends it works.
- Website pages that are HTML only cannot use these functions.`
}
