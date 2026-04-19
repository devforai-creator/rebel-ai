import { describe, expect, it } from 'vitest'

import * as chatHooks from './index'
import { useQueuedChat } from './useQueuedChat'
import { useChatHistory, combineHistoryWithLiveMessages } from './useChatHistory'
import { useChatRuntimeVariables } from './useChatRuntimeVariables'

describe('chat hooks barrel', () => {
  it('re-exports the queued chat and runtime hooks', () => {
    expect(chatHooks.useQueuedChat).toBe(useQueuedChat)
    expect(chatHooks.useChatHistory).toBe(useChatHistory)
    expect(chatHooks.useChatRuntimeVariables).toBe(useChatRuntimeVariables)
  })

  it('re-exports helper utilities from hook modules', () => {
    expect(chatHooks.combineHistoryWithLiveMessages).toBe(combineHistoryWithLiveMessages)
  })
})
