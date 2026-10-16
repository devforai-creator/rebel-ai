import { readSdkUsageStep, reportedTokenCount, type SdkUsageStep, type UsageStep } from './usage'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

export function readAnthropicUsageStep(step: SdkUsageStep): UsageStep {
  const usage = readSdkUsageStep(step)
  const metadata = record(step.providerMetadata?.anthropic)
  const raw = record(metadata.usage)
  const creation = record(raw.cache_creation)
  const writes =
    reportedTokenCount(metadata.cacheCreationInputTokens) ??
    reportedTokenCount(raw.cache_creation_input_tokens)
  const five = reportedTokenCount(creation.ephemeral_5m_input_tokens)
  const hour = reportedTokenCount(creation.ephemeral_1h_input_tokens)
  return {
    ...usage,
    cachedInputTokens: usage.cachedInputTokens ?? reportedTokenCount(raw.cache_read_input_tokens),
    ...(writes !== null ? { cacheWriteTokens: writes } : {}),
    ...(five !== null ? { cacheWrite5mTokens: five } : {}),
    ...(hour !== null ? { cacheWrite1hTokens: hour } : {}),
  }
}
