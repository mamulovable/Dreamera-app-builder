// The file every generated app gets as lib/ai.ts. Screens import only this.
// The provider keys are not in it. Recording follows Expo SDK 54 expo-audio:
// requestRecordingPermissionsAsync, setAudioModeAsync({ playsInSilentMode, allowsRecording }),
// useAudioRecorder(RecordingPresets.HIGH_QUALITY), prepareToRecordAsync, record, stop, then uri.

export function aiClientSource(config: { enabled: boolean; apiUrl: string }) {
  return `import { useState } from "react";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";

const aiConfig = ${JSON.stringify(config)} as { enabled: boolean; apiUrl: string };

export type AiTurn = { role: "user" | "assistant"; content: string };

function assertEnabled() {
  if (!aiConfig.enabled || !aiConfig.apiUrl) {
    throw new Error("AI isn't turned on for this app yet.");
  }
}

async function readAnswer(response: Response) {
  const data = await response.json().catch(() => null);
  const message = data && typeof data.message === "string" ? data.message : "";
  if (!response.ok) throw new Error(message || "AI couldn't answer. Try again.");
  if (!data || typeof data.text !== "string" || !data.text.trim()) throw new Error("AI returned nothing. Try again.");
  return data.text.trim();
}

async function appendFile(form: FormData, uri: string, name: string, type: string) {
  if (uri.indexOf("blob:") === 0 || uri.indexOf("data:") === 0 || uri.indexOf("http://") === 0 || uri.indexOf("https://") === 0) {
    const blob = await fetch(uri).then((response) => response.blob());
    form.append("file", blob, name);
    return;
  }
  form.append("file", { uri: uri, name: name, type: type } as unknown as Blob);
}

/**
 * Sends a text message. history is earlier turns only, oldest first, not including prompt.
 * Returns the reply as a string. Throws Error with a message that can be shown on screen.
 */
export async function askAi(prompt: string, history?: AiTurn[]) {
  assertEnabled();
  const text = prompt.trim();
  if (!text) throw new Error("Type a message first.");
  const response = await fetch(aiConfig.apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "text", prompt: text, history: history ?? [] }),
  });
  return readAnswer(response);
}

/** Turns a recording uri from useVoiceNote().stop() into text. */
export async function transcribeAudio(uri: string) {
  assertEnabled();
  if (!uri) throw new Error("Record something first.");
  const form = new FormData();
  form.append("task", "transcribe");
  const webm = uri.indexOf("blob:") === 0;
  await appendFile(form, uri, webm ? "note.webm" : "note.m4a", webm ? "audio/webm" : "audio/m4a");
  const response = await fetch(aiConfig.apiUrl, { method: "POST", body: form });
  return readAnswer(response);
}

function photoFile(uri: string) {
  if (uri.indexOf("data:image/png") === 0 || /\\.png(\\?|$)/i.test(uri)) return { name: "photo.png", type: "image/png" };
  if (uri.indexOf("data:image/webp") === 0 || /\\.webp(\\?|$)/i.test(uri)) return { name: "photo.webp", type: "image/webp" };
  if (uri.indexOf("data:image/gif") === 0 || /\\.gif(\\?|$)/i.test(uri)) return { name: "photo.gif", type: "image/gif" };
  return { name: "photo.jpg", type: "image/jpeg" };
}

/** Answers a question about a local photo uri, such as one from expo-image-picker. */
export async function analyzeImage(uri: string, question: string) {
  assertEnabled();
  const asked = question.trim();
  if (!uri) throw new Error("Choose a photo first.");
  if (!asked) throw new Error("Ask something about the photo.");
  const photo = photoFile(uri);
  const form = new FormData();
  form.append("task", "vision");
  form.append("question", asked);
  await appendFile(form, uri, photo.name, photo.type);
  const response = await fetch(aiConfig.apiUrl, { method: "POST", body: form });
  return readAnswer(response);
}

/** Records one short voice note. Call start, then stop, then transcribeAudio on the uri. */
export function useVoiceNote() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  async function start() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error("Microphone permission was denied.");
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  }

  async function stop() {
    await recorder.stop();
    setRecording(false);
    if (!recorder.uri) throw new Error("No recording was captured.");
    return recorder.uri;
  }

  return { recording, start, stop };
}
`
}
