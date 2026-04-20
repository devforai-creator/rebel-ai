import { describe, expect, it } from 'vitest'

import type { ChatMemoryConfig } from '@/lib/chat/model-config'
import {
  getEmptyStateText,
  getMemoryDescription,
  getNextMemoryCheckpoint,
} from './ChatSummariesPanel'

function createMemoryConfig(overrides: Required<ChatMemoryConfig>): Required<ChatMemoryConfig> {
  return overrides
}

describe('ChatSummariesPanel memory stats copy', () => {
  it('uses canonical chunk checkpoints for summary_window', () => {
    const memoryConfig = createMemoryConfig({
      mode: 'summary_window',
      sealEveryMessages: 100,
      retainTailMessages: 4,
    })

    expect(getNextMemoryCheckpoint(0, memoryConfig)).toBe(20)
    expect(getNextMemoryCheckpoint(19, memoryConfig)).toBe(20)
    expect(getNextMemoryCheckpoint(20, memoryConfig)).toBe(30)
    expect(getNextMemoryCheckpoint(223, memoryConfig)).toBe(230)
  })

  it('uses canonical chunk checkpoints for prefix mode instead of legacy 96-message blocks', () => {
    const memoryConfig = createMemoryConfig({
      mode: 'prefix_live_blocks',
      sealEveryMessages: 100,
      retainTailMessages: 4,
    })

    expect(getNextMemoryCheckpoint(0, memoryConfig)).toBe(14)
    expect(getNextMemoryCheckpoint(13, memoryConfig)).toBe(14)
    expect(getNextMemoryCheckpoint(14, memoryConfig)).toBe(24)
    expect(getNextMemoryCheckpoint(223, memoryConfig)).toBe(224)
  })

  it('describes prefix mode using canonical chunk generation language', () => {
    const memoryConfig = createMemoryConfig({
      mode: 'prefix_live_blocks',
      sealEveryMessages: 100,
      retainTailMessages: 4,
    })

    expect(getMemoryDescription(memoryConfig)).toContain('latest 4 messages raw')
    expect(getMemoryDescription(memoryConfig)).toContain('canonical 10-message memory chunks')
    expect(getMemoryDescription(memoryConfig)).not.toContain(
      'live conversation raw until 100 messages',
    )
    expect(getEmptyStateText(memoryConfig)).toContain('after 14 messages')
  })
})
