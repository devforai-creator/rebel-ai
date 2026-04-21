import { afterEach, describe, expect, it } from 'vitest'

import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
} from '@/lib/chat/delivery-mode'
import {
  AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS,
  EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV,
  resolveAgenticTranscriptRecallRuntimeConfig,
} from './config'
import {
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES,
} from '@/lib/chat/model-config'

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
        accountDefaultEnabled: false,
        provider: 'openai',
        deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      }),
    ).toMatchObject({
      configured: true,
      accountDefaultEnabled: false,
      preferenceSource: 'chat_override',
      globallyEnabled: false,
      providerSupported: true,
      providerAllowed: true,
      enabled: false,
      skipReason: 'disabled_by_global_flag',
      maxToolCalls: DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
      maxMessagesPerCall: 12,
      maxTotalMessages: DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES,
      providerAllowlist: [...AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS],
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
        accountDefaultEnabled: false,
        provider: 'openai',
        deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      }),
    ).toMatchObject({
      configured: true,
      accountDefaultEnabled: false,
      preferenceSource: 'chat_override',
      globallyEnabled: true,
      providerSupported: true,
      providerAllowed: true,
      enabled: true,
      skipReason: null,
      maxToolCalls: 2,
      maxMessagesPerCall: 8,
      maxTotalMessages: 10,
      providerAllowlist: [...AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS],
    })
  })

  it('enables recall for opted-in google chats when the global flag is on', () => {
    process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV] = 'true'

    expect(
      resolveAgenticTranscriptRecallRuntimeConfig({
        modelConfig: {
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
            },
          },
        },
        accountDefaultEnabled: false,
        provider: 'google',
        deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      }),
    ).toMatchObject({
      configured: true,
      accountDefaultEnabled: false,
      preferenceSource: 'chat_override',
      globallyEnabled: true,
      providerSupported: true,
      providerAllowed: true,
      enabled: true,
      skipReason: null,
      maxToolCalls: DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
      providerAllowlist: [...AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS],
    })
  })

  it('enables recall for opted-in anthropic streaming chats when the global flag is on', () => {
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
        accountDefaultEnabled: false,
        provider: 'anthropic',
        deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      }),
    ).toMatchObject({
      configured: true,
      accountDefaultEnabled: false,
      preferenceSource: 'chat_override',
      globallyEnabled: true,
      providerSupported: true,
      providerAllowed: true,
      enabled: true,
      skipReason: null,
      providerAllowlist: ['anthropic'],
    })
  })

  it('keeps anthropic batch delivery disabled even when the chat config allows anthropic', () => {
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
        accountDefaultEnabled: false,
        provider: 'anthropic',
        deliveryMode: CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
      }),
    ).toMatchObject({
      configured: true,
      accountDefaultEnabled: false,
      preferenceSource: 'chat_override',
      globallyEnabled: true,
      providerSupported: true,
      providerAllowed: true,
      enabled: false,
      skipReason: 'delivery_mode_not_supported',
    })
  })

  it('enables recall for inherited chats when the account default is on', () => {
    process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV] = 'true'

    expect(
      resolveAgenticTranscriptRecallRuntimeConfig({
        modelConfig: {},
        accountDefaultEnabled: true,
        provider: 'openai',
        deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      }),
    ).toMatchObject({
      configured: false,
      accountDefaultEnabled: true,
      preferenceSource: 'account_default',
      globallyEnabled: true,
      providerSupported: true,
      providerAllowed: true,
      enabled: true,
      skipReason: null,
      providerAllowlist: [...AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS],
    })
  })

  it('keeps inherited chats disabled when the account default is off', () => {
    process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV] = 'true'

    expect(
      resolveAgenticTranscriptRecallRuntimeConfig({
        modelConfig: {},
        accountDefaultEnabled: false,
        provider: 'openai',
        deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      }),
    ).toMatchObject({
      configured: false,
      accountDefaultEnabled: false,
      preferenceSource: 'account_default',
      globallyEnabled: true,
      providerSupported: true,
      providerAllowed: true,
      enabled: false,
      skipReason: 'disabled_by_account_default',
      providerAllowlist: [...AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS],
    })
  })

  it('lets an explicit chat off override beat an enabled account default', () => {
    process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV] = 'true'

    expect(
      resolveAgenticTranscriptRecallRuntimeConfig({
        modelConfig: {
          experimental: {
            agenticTranscriptRecall: {
              enabled: false,
            },
          },
        },
        accountDefaultEnabled: true,
        provider: 'openai',
        deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      }),
    ).toMatchObject({
      configured: true,
      accountDefaultEnabled: true,
      preferenceSource: 'chat_override',
      enabled: false,
      skipReason: 'disabled_by_chat_override',
    })
  })
})
