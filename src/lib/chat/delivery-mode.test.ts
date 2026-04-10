import { describe, expect, it } from 'vitest'
import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
  isAnthropicBatchChatSupported,
  isChatDeliveryMode,
} from './delivery-mode'

describe('chat delivery modes', () => {
  it('validates known delivery modes', () => {
    expect(isChatDeliveryMode(CHAT_DELIVERY_MODE_STREAMING)).toBe(true)
    expect(isChatDeliveryMode(CHAT_DELIVERY_MODE_ANTHROPIC_BATCH)).toBe(true)
    expect(isChatDeliveryMode('batch')).toBe(false)
  })

  it('only enables Anthropic Batch chat for Opus 4.5 and 4.6', () => {
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-opus-4-6',
      }),
    ).toBe(true)
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-opus-4-5',
      }),
    ).toBe(true)
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-sonnet-4-6',
      }),
    ).toBe(false)
    expect(
      isAnthropicBatchChatSupported({
        provider: 'openai',
        modelName: 'claude-opus-4-6',
      }),
    ).toBe(false)
  })
})
