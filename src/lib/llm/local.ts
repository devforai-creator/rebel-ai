import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { wrapLanguageModel } from 'ai'
import { LOCAL_MODEL_IDS } from '@/lib/models/catalog/local'

// Operator-controlled destination, never a URL supplied by chat content or the browser.
export function localBaseURL(): string {
  if (process.env.LOCAL_LLM_ENABLED !== 'true' || process.env.VERCEL) {
    throw new Error('LOCAL_LLM_DISABLED')
  }
  let url: URL
  try {
    url = new URL(process.env.LOCAL_LLM_BASE_URL ?? '')
  } catch {
    throw new Error('LOCAL_LLM_CONFIGURATION')
  }
  const host = url.hostname
  const octets = host.split('.').map(Number)
  const tailscale =
    octets.length === 4 &&
    octets.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) &&
    octets[0] === 100 &&
    octets[1] >= 64 &&
    octets[1] <= 127
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/v1', '/v1/'].includes(url.pathname) ||
    !(host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || tailscale)
  ) {
    throw new Error('LOCAL_LLM_CONFIGURATION')
  }
  return url.toString().replace(/\/$/, '')
}

export function buildLocalModel(apiKey: string, modelName: string) {
  const baseURL = localBaseURL()
  if (!LOCAL_MODEL_IDS.some((id) => id === modelName)) throw new Error('LOCAL_LLM_MODEL')
  const model = createOpenAICompatible({
    name: 'local',
    includeUsage: false,
    baseURL,
    apiKey,
    fetch: async (input, init) => {
      // No redirects: bearer tokens and private prompts must stay at the configured endpoint.
      try {
        const response = await fetch(input, { ...init, redirect: 'error' })
        if (!response.ok) {
          const status = response.status
          // Read only a bounded error object; never propagate server response text.
          let badRequestCode = 'LOCAL_LLM_REQUEST'
          if (status === 400) {
            const reader = response.body?.getReader()
            const part = await reader?.read()
            await reader?.cancel()
            if (part?.value && part.value.byteLength <= 4096) {
              try {
                const message = JSON.parse(new TextDecoder().decode(part.value))?.error?.message
                if (
                  message ===
                  'Context limit exceeded: prompt <=4096, output <=2048, total <=6144; no truncation'
                ) {
                  badRequestCode = 'LOCAL_LLM_CONTEXT'
                } else if (message === 'Messages rejected by model chat template') {
                  badRequestCode = 'LOCAL_LLM_TEMPLATE'
                }
              } catch {
                /* Unknown response stays a generic request error. */
              }
            }
          } else {
            await response.body?.cancel()
          }
          const code =
            status === 400
              ? badRequestCode
              : status === 401 || status === 403
                ? 'LOCAL_LLM_AUTH'
                : status === 413 || status === 422
                  ? 'LOCAL_LLM_CONTEXT'
                  : status === 409 || status === 429 || status === 503
                    ? 'LOCAL_LLM_BUSY'
                    : 'LOCAL_LLM_RESPONSE'
          throw new Error(code)
        }
        return response
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('LOCAL_LLM_')) throw error
        throw new Error('LOCAL_LLM_UNAVAILABLE')
      }
    },
  }).chatModel(modelName)
  return wrapLanguageModel({
    model,
    middleware: {
      middlewareVersion: 'v2',
      transformParams: async ({ params }) => {
        if (params.tools?.length) throw new Error('LOCAL_LLM_TOOLS')
        return { ...params, maxOutputTokens: Math.min(params.maxOutputTokens ?? 2048, 2048) }
      },
    },
  })
}
