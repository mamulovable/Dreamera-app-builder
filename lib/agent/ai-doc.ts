import type { AppAiAvailability } from "@/lib/ai/types"
import { AI_DAILY_CREDIT_CAP, AI_SPEECH_CREDITS, AI_TEXT_CREDITS, AI_VISION_CREDITS, AI_VOICE_CREDITS } from "@/lib/plans"

/**
 * The only AI API the screen builder is allowed to use. It is the contract for
 * lib/ai.ts. Groq runs every job on the server: text is openai/gpt-oss-120b,
 * speech to text is whisper-large-v3, text to speech is canopylabs/orpheus-v1-english,
 * photos are qwen/qwen3.8-27b. A screen that calls Groq itself is wrong.
 */
export const AI_BUILDER_RULES = `# AI in the app
The app's AI is four functions in "@/lib/ai". They are the whole API. There is no model argument, no API key, and no provider URL. The server chooses the provider. "AI powered" does not mean askAi. Pick the function from what the screen does.
- A written reply, chat, rewrite, summary, or an answer the person reads: \`askAi(prompt, history?)\` returns \`Promise<string>\`. \`prompt\` is the new message. \`history\` is optional earlier turns, oldest first, each \`{ role: "user" | "assistant", content: string }\`. Do not put \`prompt\` in \`history\` again. Do not use role \`"system"\`.
- Text to speech, read aloud, narrate, or speak typed text: \`speakText(text)\` returns \`Promise<void>\` and plays the voice. Pass the words to speak. Do not pass them to \`askAi\`. Do not show the spoken words as if they were an AI reply. A long passage is split into short lines inside \`speakText\`. Do not import "expo-audio" to play it.
- Speech to text, dictation, or a voice note: \`useVoiceNote()\` returns \`{ recording, start, stop }\`. \`start()\` asks for the microphone and begins recording. \`stop()\` returns a file uri string. Then \`transcribeAudio(uri)\` returns \`Promise<string>\` of the spoken words. If the person should also get a written answer, pass that string to \`askAi\`. If they should hear an answer, pass it to \`speakText\`. Do not import "expo-audio" or "expo-av". Do not call Groq, Whisper, or Orpheus yourself.
- A photo: \`analyzeImage(uri, question)\` returns \`Promise<string>\`. \`uri\` is a local image from \`expo-image-picker\` (\`assets[0].uri\`). \`question\` is what to ask about that picture. Do not send the picture to \`askAi\`. Do not call Groq yourself.
- Import them with \`import { askAi, analyzeImage, speakText, transcribeAudio, useVoiceNote } from "@/lib/ai"\`. Import only the ones this screen uses.
- Each function throws an \`Error\` whose \`message\` is safe to show. Wrap the call in try/catch and show \`error.message\` inline. Show a busy state while the promise is running, and ignore a second press until it finishes.
- Keep a voice note under a minute. Keep a question under a few sentences. \`askAi\` history is at most 12 turns.
- Use these only when this screen's purpose or the requested change asks for a written reply, speech playback, a transcription, or an answer about a photo. Otherwise do not import "@/lib/ai". Speaking text is speakText, never askAi.
- The string from askAi, transcribeAudio, or analyzeImage is plain text, not HTML and not markdown. Show it in a card that uses this screen's type scale, padding, radius, and theme colors. Keep line breaks with nested \`Text\` lines, or one \`Text\` whose style sets a line height. Let the screen's \`ScrollView\` scroll a long reply. Never put the string in a \`WebView\`, and never leave it as an unstyled block. speakText returns nothing to show.
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
\`const reply = await askAi(draft)\`

Speaking text, written this way and no other way:
\`await speakText(draft)\``

export function aiPlannerSection(ai: AppAiAvailability) {
  const jobs = [
    ai.text ? `written replies (${AI_TEXT_CREDITS} credit, Groq on the server)` : "written replies are not set up on this server",
    ai.voice ? `speech to text (${AI_VOICE_CREDITS} credit, Groq Whisper on the server)` : "speech to text is not set up on this server",
    ai.speech ? `text to speech (${AI_SPEECH_CREDITS} credit a line, Groq Orpheus on the server)` : "text to speech is not set up on this server",
    ai.vision ? `photo questions (${AI_VISION_CREDITS} credits, Groq vision on the server)` : "photo questions are not set up on this server",
  ]
  const state = ai.enabled
    ? "allowed. Screens may call askAi, speakText, transcribeAudio, and analyzeImage from @/lib/ai."
    : "not allowed. Tell them to click Allow AI at the top of the workspace. You cannot turn it on, and you never ask for an API key."
  return `# AI features
Dreamera AI is one switch for this app. The person clicks Allow AI once. Their credits pay for it, up to ${AI_DAILY_CREDIT_CAP} credits a day. The provider keys stay on the server.
- Right now AI is ${state}
- Jobs: ${jobs.join("; ")}.
- Match the job to the screen, not to the words "AI" or "AI powered". A written chat, rewrite, summary, or answer the person reads uses askAi. Text to speech, read aloud, narrate, or speak what they typed uses speakText and not askAi. Speech to text, dictation, or a recording uses useVoiceNote and then transcribeAudio. An answer about a picture uses analyzeImage. A voice assistant that replies in text is transcribeAudio and then askAi. One that replies out loud is transcribeAudio and then speakText. Say which of these the screen should use inside the builder's request, and name the functions. The builder has the exact signatures and must not call a provider itself.
- If they want one of these and AI is not allowed, do not add that screen and do not call update_app for it. Tell them to click Allow AI, then ask again.
- If they say they turned AI on, or say "add the AI feature" without naming a new one, read the current plan and wire the job those screens already do. Call \`update_app\` immediately. A text-to-speech, read-aloud, or narrate screen uses speakText on the text it already collects. A dictation or transcribe screen uses useVoiceNote and then transcribeAudio. A summarize, rewrite, chat, or written-answer screen uses askAi. A screen that already takes a photo uses analyzeImage. A typed box is not askAi when the app's purpose is to speak that text. Do not ask which job they want when the plan already shows it. Do not add speech, recording, or photos they never asked for. Ask what they want only when no screen is speech, a written reply, a recording, or a photo question. Do not invent a chatbot.
- In that builder \`request\`, name the function and the screen that calls it. For speakText, name the text it speaks and say the function plays the voice, so the screen does not render an AI reply. For askAi, name the prompt, where the reply is saved, and that the reply is plain text in an existing card. Say a written reply is not HTML and must not go in a WebView.
- If a job says it is not set up on this server, say that kind of AI isn't available here. Do not write a screen that pretends it works.
- Website pages that are HTML only cannot use these functions.`
}
