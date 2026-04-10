export const CHAT_DELIVERY_MODE_STREAMING = 'streaming'
export const CHAT_DELIVERY_MODE_ANTHROPIC_BATCH = 'anthropic_batch'

export type ChatDeliveryMode =
  | typeof CHAT_DELIVERY_MODE_STREAMING
  | typeof CHAT_DELIVERY_MODE_ANTHROPIC_BATCH

export function isChatDeliveryMode(value: unknown): value is ChatDeliveryMode {
  return value === CHAT_DELIVERY_MODE_STREAMING || value === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
}

export function isAnthropicBatchChatSupported({
  provider,
  modelName,
}: {
  provider?: string | null
  modelName?: string | null
}): boolean {
  if (provider !== 'anthropic' || !modelName) {
    return false
  }

  const normalized = modelName.toLowerCase()
  return normalized.includes('claude-opus-4-6') || normalized.includes('claude-opus-4-5')
}
