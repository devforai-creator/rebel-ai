import type { LanguageModelV2Middleware, LanguageModelV2StreamPart } from '@ai-sdk/provider'

function reportedCost(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const usage = (body as Record<string, unknown>).usage
  if (!usage || typeof usage !== 'object') return null
  const cost = (usage as Record<string, unknown>).cost
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
}

// The OpenAI-compatible SDK strips OpenRouter's usage.cost. Retain only billing
// metadata from the native response; do not expose raw chunks unless requested.
export const openRouterUsageMiddleware: LanguageModelV2Middleware = {
  middlewareVersion: 'v2',
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()
    return {
      ...result,
      providerMetadata: {
        ...result.providerMetadata,
        openrouter: {
          ...result.providerMetadata?.openrouter,
          reportedCostUsd: reportedCost(result.response?.body),
          responseModel: result.response?.modelId ?? null,
        },
      },
    }
  },
  wrapStream: async ({ model, params }) => {
    const result = await model.doStream({ ...params, includeRawChunks: true })
    let reportedCostUsd: number | null = null
    let responseModel: string | null = null
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'raw') {
              reportedCostUsd = reportedCost(chunk.rawValue) ?? reportedCostUsd
              if (params.includeRawChunks) controller.enqueue(chunk)
              return
            }
            if (chunk.type === 'response-metadata') responseModel = chunk.modelId ?? null
            controller.enqueue(
              chunk.type === 'finish'
                ? {
                    ...chunk,
                    providerMetadata: {
                      ...chunk.providerMetadata,
                      openrouter: {
                        ...chunk.providerMetadata?.openrouter,
                        reportedCostUsd,
                        responseModel,
                      },
                    },
                  }
                : chunk,
            )
          },
        }),
      ),
    }
  },
}
