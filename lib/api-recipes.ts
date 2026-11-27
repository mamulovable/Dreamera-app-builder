/**
 * Known third-party API recipes for the planner and screen builder.
 * Prefer these over guessing. Still call fetch_docs when the recipe is incomplete.
 */

export const API_RECIPES_DOC = `# Known external API recipes (use these; don't invent endpoints)

## OpenWeather (live weather)
- Secret name: OPENWEATHER_API_KEY
- Docs: https://openweathermap.org/current
- Auth: \`auth: { type: "query", name: "appid" }\` — NOT bearer
- Current weather by city:
  \`callExternalApi({ secretName: "OPENWEATHER_API_KEY", url: "https://api.openweathermap.org/data/2.5/weather?q=" + encodeURIComponent(city) + "&units=metric", method: "GET", auth: { type: "query", name: "appid" } })\`
- Read \`result.data.main.temp\`, \`result.data.weather[0].description\`, \`result.data.name\`. Check \`result.ok\` and \`result.status\`.
- Free key: https://home.openweathermap.org/users/sign_up then https://home.openweathermap.org/api_keys

## OpenRouter (text or image generation)
- Secret name: OPENROUTER_API_KEY
- Docs: https://openrouter.ai/docs/api-reference/overview
- Auth: \`auth: { type: "bearer" }\`
- Chat / image models (JSON body). Example image generation (model may vary; confirm with fetch_docs):
  \`callExternalApi({ secretName: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/chat/completions", method: "POST", auth: { type: "bearer" }, headers: { "HTTP-Referer": "https://dreamera.app", "X-Title": "Dreamera App" }, body: { model: "<image-model-id>", messages: [{ role: "user", content: prompt }] } })\`
- When the model returns base64, look in common fields such as \`choices[0].message.images\`, \`choices[0].message.content\` parts, or \`data[0].b64_json\`. Show with \`{ uri: "data:image/png;base64," + b64 }\` or an https URL if the API returns one.
- Never put the raw key in the app. If \`result.data\` is huge base64, assign it once to state and use Image with that data URI — do not invent "image too large" unless \`callExternalApi\` threw.

## Remove.bg style background removal
- Often needs multipart file upload. Dreamera's proxy today accepts JSON bodies (including a base64 image field if the provider supports JSON). Prefer providers with a JSON base64 API, or tell the person honestly if only multipart is supported and you cannot send FormData through callExternalApi yet.
- Always fetch_docs for the exact provider before wiring.

## General rules
- Before wiring an unfamiliar API, call \`fetch_docs\` on the provider's docs URL.
- After the person saves a key, call \`update_app\` so screens actually use \`callExternalApi\` — storing the key alone does nothing.
- On failure, show \`error.message\` from the thrown Error (proxy messages are safe to show).
`

export const API_RECIPES_BUILDER = `When calling third-party APIs through "@/lib/external":
- OpenWeather: query auth appid — GET https://api.openweathermap.org/data/2.5/weather?q=<city>&units=metric with auth { type: "query", name: "appid" }.
- OpenRouter: bearer auth — POST https://openrouter.ai/api/v1/chat/completions with JSON body; show returned image URLs or data:image/...;base64,... in Image uri. Do not invent a "too large to load" error; only show errors from thrown Error.message.
- Prefer https image URLs from the API when available; for base64 use a data URI in Image or <img src>.
- Request bodies may include a data-URL or base64 field for image-to-image APIs that accept JSON (keep under ~3 MB).
`
