import { afterEach, describe, expect, it } from 'vitest'

import {
  EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV,
  resolveAgenticTranscriptRecallRuntimeConfig,
} from './config'

const ORIGINAL_ENV = process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV]

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV]
  } else {
    process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV] = ORIGINAL_ENV
  }
})

describe('resolveAgenticTranscriptRecallRuntimeConfig', () => {
  it('defaults to disabled when the global flag is off', () => {
    delete process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV]

    expect(
      resolveAgenticTranscriptRecallRuntimeConfig({
        modelConfig: {
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
            },
          },
        },
        provider: 'openai',
      }),
    ).toMatchObject({
      configured: true,
      globallyEnabled: false,
      providerSupported: true,
      providerAllowed: true,
      enabled: false,
      skipReason: 'disabled_by_global_flag',
      maxToolCalls: 1,
      maxMessagesPerCall: 12,
      maxTotalMessages: 12,
      providerAllowlist: ['openai'],
    })
  })

  it('enables recall for opted-in openai chats when the global flag is on', () => {
    process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV] = 'true'

    expect(
      resolveAgenticTranscriptRecallRuntimeConfig({
        modelConfig: {
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
              maxToolCalls: 2,
              maxMessagesPerCall: 8,
              maxTotalMessages: 10,
            },
          },
        },
        provider: 'openai',
      }),
    ).toMatchObject({
      configured: true,
      globallyEnabled: true,
      providerSupported: true,
      providerAllowed: true,
      enabled: true,
      skipReason: null,
      maxToolCalls: 2,
      maxMessagesPerCall: 8,
      maxTotalMessages: 10,
      providerAllowlist: ['openai'],
    })
  })

  it('keeps unsupported providers disabled even when the chat config allows them', () => {
    process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV] = 'true'

    expect(
      resolveAgenticTranscriptRecallRuntimeConfig({
        modelConfig: {
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
              providerAllowlist: ['anthropic'],
            },
          },
        },
        provider: 'anthropic',
      }),
    ).toMatchObject({
      configured: true,
      globallyEnabled: true,
      providerSupported: false,
      providerAllowed: true,
      enabled: false,
      skipReason: 'provider_not_supported',
    })
  })
})
