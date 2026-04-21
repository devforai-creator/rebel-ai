import { describe, it, expect } from 'vitest'
import {
  AGENTIC_TRANSCRIPT_RECALL_CONFIG_PROVIDERS,
  buildAgenticTranscriptRecallOverrideModelConfigPatch,
  resolveAgenticTranscriptRecallOverrideMode,
  buildOperatorDefaultPersistedChatModelConfig,
  CHAT_MEMORY_MODE_SUPPORT_TIERS,
  buildOperatorDefaultChatModelConfig,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_MESSAGES_PER_CALL,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES,
  DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
  DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
  OPERATOR_DEFAULT_CHAT_MEMORY_MODE,
  hasPersistableChatModelConfig,
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

  it('normalizes experimental agentic transcript recall config values', () => {
    const result = normalizeChatModelConfig({
      experimental: {
        agenticTranscriptRecall: {
          enabled: true,
          maxToolCalls: 1.9,
          maxMessagesPerCall: 12.2,
          maxTotalMessages: 18.7,
          providerAllowlist: [
            'google',
            'openai',
            'anthropic',
            'deepseek',
            'openrouter',
            'bad-provider',
            'openai',
          ],
        },
      },
    })

    expect(result).toEqual({
      experimental: {
        agenticTranscriptRecall: {
          enabled: true,
          maxToolCalls: 1,
          maxMessagesPerCall: 12,
          maxTotalMessages: 18,
          providerAllowlist: [...AGENTIC_TRANSCRIPT_RECALL_CONFIG_PROVIDERS],
        },
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

describe('buildOperatorDefaultPersistedChatModelConfig', () => {
  it('keeps operator persisted chat defaults limited to memory defaults', () => {
    expect(buildOperatorDefaultPersistedChatModelConfig({})).toEqual({
      memory: {
        mode: 'prefix_live_blocks',
        sealEveryMessages: DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
        retainTailMessages: DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
      },
    })
  })

  it('preserves explicit transcript recall config when one is already provided', () => {
    expect(
      buildOperatorDefaultPersistedChatModelConfig({
        experimental: {
          agenticTranscriptRecall: {
            enabled: false,
            maxToolCalls: 4,
          },
        },
      }),
    ).toEqual({
      memory: {
        mode: 'prefix_live_blocks',
        sealEveryMessages: DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
        retainTailMessages: DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
      },
      experimental: {
        agenticTranscriptRecall: {
          enabled: false,
          maxToolCalls: 4,
          maxMessagesPerCall: undefined,
          maxTotalMessages: undefined,
          providerAllowlist: undefined,
        },
      },
    })
  })
})

describe('resolveAgenticTranscriptRecallOverrideMode', () => {
  it('treats missing ATR config as inherit', () => {
    expect(resolveAgenticTranscriptRecallOverrideMode({})).toBe('inherit')
    expect(
      resolveAgenticTranscriptRecallOverrideMode({
        experimental: null,
      }),
    ).toBe('inherit')
  })

  it('treats enabled ATR config as explicit on', () => {
    expect(
      resolveAgenticTranscriptRecallOverrideMode({
        experimental: {
          agenticTranscriptRecall: {
            enabled: true,
          },
        },
      }),
    ).toBe('enabled')
  })

  it('treats disabled ATR config as explicit off', () => {
    expect(
      resolveAgenticTranscriptRecallOverrideMode({
        experimental: {
          agenticTranscriptRecall: {
            enabled: false,
          },
        },
      }),
    ).toBe('disabled')
  })
})

describe('buildAgenticTranscriptRecallOverrideModelConfigPatch', () => {
  it('returns an empty experimental patch for inherit', () => {
    expect(
      buildAgenticTranscriptRecallOverrideModelConfigPatch(
        {
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
              maxToolCalls: 4,
            },
          },
        },
        'inherit',
      ),
    ).toEqual({
      experimental: {},
    })
  })

  it('preserves ATR budgets while switching the override on', () => {
    expect(
      buildAgenticTranscriptRecallOverrideModelConfigPatch(
        {
          experimental: {
            agenticTranscriptRecall: {
              enabled: false,
              maxToolCalls: 4,
              maxMessagesPerCall: 16,
            },
          },
        },
        'enabled',
      ),
    ).toEqual({
      experimental: {
        agenticTranscriptRecall: {
          enabled: true,
          maxToolCalls: 4,
          maxMessagesPerCall: 16,
          maxTotalMessages: undefined,
          providerAllowlist: undefined,
        },
      },
    })
  })
})

describe('hasPersistableChatModelConfig', () => {
  it('treats enabled experimental agentic transcript recall config as persistable', () => {
    expect(
      hasPersistableChatModelConfig(
        normalizeChatModelConfig({
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
            },
          },
        }),
      ),
    ).toBe(true)
  })

  it('persists explicit off experimental agentic transcript recall config', () => {
    expect(
      hasPersistableChatModelConfig(
        normalizeChatModelConfig({
          experimental: {
            agenticTranscriptRecall: {
              enabled: false,
              maxToolCalls: DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
              maxMessagesPerCall: DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_MESSAGES_PER_CALL,
              maxTotalMessages: DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES,
            },
          },
        }),
      ),
    ).toBe(true)
  })
})
