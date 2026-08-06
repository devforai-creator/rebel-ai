export const OPENROUTER_KIMI_K3_MODEL_ID = 'moonshotai/kimi-k3'
export const OPENROUTER_KIMI_K3_REASONING_EFFORT = 'max'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function applyOpenRouterRequestPolicy({
  modelName,
  init,
}: {
  modelName: string
  init?: RequestInit
}): RequestInit | undefined {
  if (modelName !== OPENROUTER_KIMI_K3_MODEL_ID || typeof init?.body !== 'string') {
    return init
  }

  try {
    const body = JSON.parse(init.body) as unknown
    if (!isRecord(body)) {
      return init
    }

    const existingReasoning = isRecord(body.reasoning) ? body.reasoning : {}

    return {
      ...init,
      body: JSON.stringify({
        ...body,
        reasoning: {
          ...existingReasoning,
          effort: OPENROUTER_KIMI_K3_REASONING_EFFORT,
        },
      }),
    }
  } catch {
    return init
  }
}

export function createOpenRouterRequestFetch({
  modelName,
  fetchImpl = globalThis.fetch,
}: {
  modelName: string
  fetchImpl?: typeof globalThis.fetch
}): typeof globalThis.fetch | undefined {
  if (modelName !== OPENROUTER_KIMI_K3_MODEL_ID) {
    return undefined
  }

  return (input, init) =>
    fetchImpl(
      input,
      applyOpenRouterRequestPolicy({
        modelName,
        init,
      }),
    )
}
