import { findModelDefinition, getModelFeatures } from '@/lib/models'
import { MODEL_REASONING_LEVELS, type ModelReasoningLevel } from '@/lib/models/types'
import type { LlmProvider } from '@/types/database.types'

export type ReasoningPreference = 'default' | ModelReasoningLevel
export type ChatReasoningPreferences = Record<string, ReasoningPreference>
export type ReasoningSnapshot = {
  effort: ModelReasoningLevel | null
  source: 'chat' | 'legacy-key' | 'model-default'
}

export const REASONING_LABELS: Record<ReasoningPreference, string> = {
  default: '모델 기본값',
  none: '끄기',
  minimal: '최소',
  low: '낮음',
  medium: '보통',
  high: '높음',
  xhigh: '매우 높음',
  max: '최대',
}

export function isReasoningPreference(value: unknown): value is ReasoningPreference {
  return value === 'default' || MODEL_REASONING_LEVELS.some((level) => level === value)
}

export function getReasoningModelKey(provider: LlmProvider, modelName: string): string {
  const model = findModelDefinition({ provider, modelName })
  return `${provider}:${model?.id ?? modelName}`
}

export function getReasoningControl(provider: LlmProvider, modelName: string) {
  return getModelFeatures({ provider, modelName })?.reasoningControl
}

export function supportsReasoningPreference(
  provider: LlmProvider,
  modelName: string,
  preference: ReasoningPreference,
): boolean {
  const control = getReasoningControl(provider, modelName)
  return preference === 'default' || !!control?.levels.includes(preference)
}

export function normalizeReasoningPreferences(input: unknown): ChatReasoningPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const entries = Object.entries(input).filter(([key, value]) => {
    const separator = key.indexOf(':')
    if (separator < 1 || !isReasoningPreference(value)) return false
    const model = findModelDefinition({ modelName: key.slice(separator + 1) })
    return (
      !!model &&
      model.provider === key.slice(0, separator) &&
      !!model.features?.reasoningControl &&
      supportsReasoningPreference(model.provider as LlmProvider, model.id, value)
    )
  })
  return Object.fromEntries(entries) as ChatReasoningPreferences
}

export function resolveReasoningSnapshot({
  provider,
  modelName,
  preference,
  legacyEffort,
}: {
  provider: LlmProvider
  modelName: string
  preference?: ReasoningPreference
  legacyEffort?: string | null
}): ReasoningSnapshot {
  if (preference !== undefined) {
    if (!supportsReasoningPreference(provider, modelName, preference)) {
      throw new Error('이 모델에서 지원하지 않는 추론 설정입니다.')
    }
    return { effort: preference === 'default' ? null : preference, source: 'chat' }
  }

  // Preserve the old key setting's effective behavior until this model is customized.
  if (provider === 'openai' && legacyEffort) {
    const policy = getModelFeatures({ provider, modelName })?.openai
    const effort =
      policy?.minimumReasoningEffort && ['none', 'minimal'].includes(legacyEffort)
        ? policy.minimumReasoningEffort
        : legacyEffort === 'none' && !policy?.forwardReasoningEffortNone
          ? null
          : legacyEffort
    if (
      effort === null ||
      (isReasoningPreference(effort) &&
        effort !== 'default' &&
        supportsReasoningPreference(provider, modelName, effort))
    ) {
      return { effort, source: 'legacy-key' }
    }
  }
  return { effort: null, source: 'model-default' }
}
