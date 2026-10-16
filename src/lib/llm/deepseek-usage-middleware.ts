import type { LanguageModelV2Middleware, LanguageModelV2StreamPart } from '@ai-sdk/provider'

const timestamp = (value: Date | undefined) =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null

// AI SDK 5 fills missing response timestamps/model IDs with local defaults.
// Retain the native metadata before that fallback so pricing can remain unknown.
export const deepSeekUsageMiddleware: LanguageModelV2Middleware = {
  middlewareVersion: 'v2',
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()
    return {
      ...result,
      providerMetadata: {
        ...result.providerMetadata,
        deepseek: {
          ...result.providerMetadata?.deepseek,
          responseTimestamp: timestamp(result.response?.timestamp),
          responseModel: result.response?.modelId ?? null,
        },
      },
    }
  },
  wrapStream: async ({ doStream }) => {
    const result = await doStream()
    let responseTimestamp: string | null = null
    let responseModel: string | null = null
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'response-metadata') {
              responseTimestamp = timestamp(chunk.timestamp)
              responseModel = chunk.modelId ?? null
            }
            controller.enqueue(
              chunk.type === 'finish'
                ? {
                    ...chunk,
                    providerMetadata: {
                      ...chunk.providerMetadata,
                      deepseek: {
                        ...chunk.providerMetadata?.deepseek,
                        responseTimestamp,
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
