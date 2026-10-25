const JAILBREAK_CATEGORY = 'HARM_CATEGORY_JAILBREAK'

function applyGoogleSafetySettings(init?: RequestInit): RequestInit | undefined {
  if (typeof init?.body !== 'string') return init

  try {
    const body = JSON.parse(init.body) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return init
    const request = body as Record<string, unknown>
    const settings = Array.isArray(request.safetySettings) ? request.safetySettings : []

    return {
      ...init,
      body: JSON.stringify({
        ...request,
        safetySettings: [
          ...settings.filter((setting) => setting?.category !== JAILBREAK_CATEGORY),
          { category: JAILBREAK_CATEGORY, threshold: 'OFF' },
        ],
      }),
    }
  } catch {
    return init
  }
}

// @ai-sdk/google 2.x rejects HARM_CATEGORY_JAILBREAK in providerOptions even though
// the Gemini API supports it. Add it after SDK validation for both generation modes.
// https://ai.google.dev/api/generate-content#HarmCategory
export function createGoogleSafetySettingsFetch(
  fetchImpl = globalThis.fetch,
): typeof globalThis.fetch {
  return (input, init) => fetchImpl(input, applyGoogleSafetySettings(init))
}
