import { describe, it, expect } from 'vitest'
import {
  CHAT_MEMORY_MODE_SUPPORT_TIERS,
  buildOperatorDefaultChatModelConfig,
  DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
  DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
  OPERATOR_DEFAULT_CHAT_MEMORY_MODE,
  normalizeChatModelConfig,
  resolveChatMemoryConfig,
} from './model-config'

describe('normalizeChatModelConfig', () => {
  it('returns empty config when input is invalid', () => {
    expect(normalizeChatModelConfig(null)).toEqual({})
    expect(normalizeChatModelConfig('nope')).toEqual({})
    expect(normalizeChatModelConfig({})).toEqual({})
  })

  it('normalizes alternate model config values', () => {
    const result = normalizeChatModelConfig({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'primary',
        secondaryApiKeyId: 'secondary',
      },
    })

    expect(result).toEqual({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'primary',
        secondaryApiKeyId: 'secondary',
      },
    })
  })

  it('coerces non-string ids to null', () => {
    const result = normalizeChatModelConfig({
      alternateModels: {
        enabled: false,
        primaryApiKeyId: 123,
        secondaryApiKeyId: '',
      },
    })

    expect(result).toEqual({
      alternateModels: {
        enabled: false,
        primaryApiKeyId: null,
        secondaryApiKeyId: null,
      },
    })
  })

  it('normalizes memory config values', () => {
    const result = normalizeChatModelConfig({
      memory: {
        mode: 'prefix_live_blocks',
        sealEveryMessages: 120,
        retainTailMessages: 6,
      },
    })

    expect(result).toEqual({
      memory: {
        mode: 'prefix_live_blocks',
        sealEveryMessages: 120,
        retainTailMessages: 6,
      },
    })
  })

  it('preserves alternate models and memory together', () => {
    const result = normalizeChatModelConfig({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'primary',
        secondaryApiKeyId: 'secondary',
      },
      memory: {
        mode: 'prefix_live_blocks',
      },
    })

    expect(result).toEqual({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'primary',
        secondaryApiKeyId: 'secondary',
      },
      memory: {
        mode: 'prefix_live_blocks',
        sealEveryMessages: undefined,
        retainTailMessages: undefined,
      },
    })
  })
})

describe('resolveChatMemoryConfig', () => {
  it('returns defaults when memory config is missing', () => {
    expect(resolveChatMemoryConfig({})).toEqual({
      mode: 'summary_window',
      sealEveryMessages: DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
      retainTailMessages: DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
    })
  })

  it('fills missing numeric fields with defaults', () => {
    expect(
      resolveChatMemoryConfig({
        memory: {
          mode: 'prefix_live_blocks',
        },
      }),
    ).toEqual({
      mode: 'prefix_live_blocks',
      sealEveryMessages: DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
      retainTailMessages: DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
    })
  })

  it('supports an explicit operator default mode without changing the system fallback', () => {
    expect(resolveChatMemoryConfig({}, { defaultMode: OPERATOR_DEFAULT_CHAT_MEMORY_MODE })).toEqual(
      {
        mode: 'prefix_live_blocks',
        sealEveryMessages: DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
        retainTailMessages: DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
      },
    )
  })

  it('marks summary_window as fallback and prefix_live_blocks as core', () => {
    expect(CHAT_MEMORY_MODE_SUPPORT_TIERS).toEqual({
      summary_window: 'fallback',
      prefix_live_blocks: 'core',
    })
  })
})

describe('buildOperatorDefaultChatModelConfig', () => {
  it('applies the operator default memory while preserving alternate-model settings', () => {
    expect(
      buildOperatorDefaultChatModelConfig({
        alternateModels: {
          enabled: false,
          primaryApiKeyId: 'primary',
          secondaryApiKeyId: 'secondary',
        },
      }),
    ).toEqual({
      alternateModels: {
        enabled: false,
        primaryApiKeyId: 'primary',
        secondaryApiKeyId: 'secondary',
      },
      memory: {
        mode: 'prefix_live_blocks',
        sealEveryMessages: DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
        retainTailMessages: DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
      },
    })
  })
})
