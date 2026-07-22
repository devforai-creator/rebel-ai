import { afterAll, describe, expect, it } from 'vitest'
import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
  isAnthropicBatchChatEnabled,
  isAnthropicBatchChatSupported,
  isChatDeliveryMode,
} from './delivery-mode'

const ORIGINAL_ANTHROPIC_BATCH_CHAT_ENABLED = process.env.ANTHROPIC_BATCH_CHAT_ENABLED

afterAll(() => {
  if (ORIGINAL_ANTHROPIC_BATCH_CHAT_ENABLED === undefined) {
    delete process.env.ANTHROPIC_BATCH_CHAT_ENABLED
  } else {
    process.env.ANTHROPIC_BATCH_CHAT_ENABLED = ORIGINAL_ANTHROPIC_BATCH_CHAT_ENABLED
  }
})

describe('chat delivery modes', () => {
  it('validates known delivery modes', () => {
    expect(isChatDeliveryMode(CHAT_DELIVERY_MODE_STREAMING)).toBe(true)
    expect(isChatDeliveryMode(CHAT_DELIVERY_MODE_ANTHROPIC_BATCH)).toBe(true)
    expect(isChatDeliveryMode('batch')).toBe(false)
  })

  it('only enables Anthropic Batch chat for supported current Claude models', () => {
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-fable-5',
      }),
    ).toBe(true)
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-sonnet-5',
      }),
    ).toBe(true)
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-sonnet-5-20260701',
      }),
    ).toBe(true)
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-opus-4-8',
      }),
    ).toBe(true)
    expect(
      isAnthropicBatchChatSupported({
        provider: 'anthropic',
        modelName: 'claude-opus-4-7',
      }),
    ).toBe(true)
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

  it('keeps Anthropic Batch chat disabled by default unless explicitly enabled', () => {
    delete process.env.ANTHROPIC_BATCH_CHAT_ENABLED
    expect(isAnthropicBatchChatEnabled()).toBe(false)

    process.env.ANTHROPIC_BATCH_CHAT_ENABLED = 'true'
    expect(isAnthropicBatchChatEnabled()).toBe(true)

    process.env.ANTHROPIC_BATCH_CHAT_ENABLED = '1'
    expect(isAnthropicBatchChatEnabled()).toBe(true)

    process.env.ANTHROPIC_BATCH_CHAT_ENABLED = 'false'
    expect(isAnthropicBatchChatEnabled()).toBe(false)
  })
})
