import type { LanguageModelV2Middleware, LanguageModelV2StreamPart } from '@ai-sdk/provider'
import { isGoogleServiceTier } from './service-tier'

function readServiceTier(body: unknown) {
  if (!body || typeof body !== 'object') return undefined
  const response = body as Record<string, unknown>
  const usage = response.usageMetadata as Record<string, unknown> | undefined
  const tier = usage?.serviceTier ?? response.serviceTier
  return isGoogleServiceTier(tier) ? tier : undefined
}

// @ai-sdk/google 2.x only reads response.serviceTier. Live Gemini responses also
// report usageMetadata.serviceTier, which its usage schema currently strips.
export const googleUsageMiddleware: LanguageModelV2Middleware = {
  middlewareVersion: 'v2',
  wrapGenerate: async ({ doGenerate }) => {
    const pricingTimestamp = new Date().toISOString()
    const result = await doGenerate()
    const serviceTier = readServiceTier(result.response?.body)
    return {
      ...result,
      providerMetadata: {
        ...result.providerMetadata,
        google: {
          ...result.providerMetadata?.google,
          pricingTimestamp,
          ...(serviceTier ? { serviceTier } : {}),
        },
      },
    }
  },
  wrapStream: async ({ model, params }) => {
    const pricingTimestamp = new Date().toISOString()
    const result = await model.doStream({ ...params, includeRawChunks: true })
    let serviceTier: 'standard' | 'flex' | undefined
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'raw') {
              serviceTier = readServiceTier(chunk.rawValue) ?? serviceTier
              // Inspect only billing metadata; do not expose raw payloads unless requested.
              if (params.includeRawChunks) controller.enqueue(chunk)
              return
            }
            if (chunk.type === 'finish') {
              controller.enqueue({
                ...chunk,
                providerMetadata: {
                  ...chunk.providerMetadata,
                  google: {
                    ...chunk.providerMetadata?.google,
                    pricingTimestamp,
                    ...(serviceTier ? { serviceTier } : {}),
                  },
                },
              })
              return
            }
            controller.enqueue(chunk)
          },
        }),
      ),
    }
  },
}
