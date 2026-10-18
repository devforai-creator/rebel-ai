import { userDraftRequestSchema } from './user-draft-contract'
import { supportsReasoningPreference } from '@/lib/llm/reasoning'
import { supportsModelServiceTier } from '@/lib/llm/service-tier'
import { listModelsByProvider } from '@/lib/models'
import type { LlmProvider } from '@/types/database.types'
import type { z } from 'zod'

export const userDraftModelConfigSchema = userDraftRequestSchema
  .pick({ apiKeyId: true, modelName: true, reasoningEffort: true, serviceTier: true })
  .extend({
    reasoningEffort: userDraftRequestSchema.shape.reasoningEffort.default('default'),
  })

export type UserDraftModelConfig = z.infer<typeof userDraftModelConfigSchema>

export function parseUserDraftModelConfig(value: unknown): UserDraftModelConfig | null {
  const parsed = userDraftModelConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function getUserDraftModelConfigError(
  provider: LlmProvider,
  config: UserDraftModelConfig,
): string | null {
  if (provider === 'local') return '대필 전용 모델은 클라우드 모델만 선택할 수 있습니다.'
  if (!listModelsByProvider(provider).some((model) => model.id === config.modelName))
    return '선택한 모델을 사용할 수 없습니다. 대필 모델 설정을 확인해주세요.'
  if (!supportsReasoningPreference(provider, config.modelName, config.reasoningEffort))
    return '선택한 모델에서 지원하지 않는 추론 강도입니다.'
  if (
    config.serviceTier !== undefined &&
    !supportsModelServiceTier(provider, config.modelName, config.serviceTier)
  )
    return '선택한 모델에서 지원하지 않는 서비스 티어입니다.'
  return null
}
