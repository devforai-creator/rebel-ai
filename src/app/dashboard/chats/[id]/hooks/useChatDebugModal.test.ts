import { describe, expect, it } from 'vitest'

import { resolveAssetDiagnosticsTargetMessage } from './useChatDebugModal'

describe('resolveAssetDiagnosticsTargetMessage', () => {
  it('prefers the latest assistant message for asset diagnostics', () => {
    expect(
      resolveAssetDiagnosticsTargetMessage([
        { id: 'message-1', role: 'user', content: 'Hello' },
        { id: 'message-2', role: 'assistant', content: 'Old assistant' },
        { id: 'message-3', role: 'assistant', content: 'Latest assistant' },
      ]),
    ).toEqual({
      id: 'message-3',
      role: 'assistant',
      content: 'Latest assistant',
    })
  })

  it('falls back to the latest message when no assistant message exists', () => {
    expect(
      resolveAssetDiagnosticsTargetMessage([
        { id: 'message-1', role: 'user', content: 'Hello' },
        { id: 'message-2', role: 'system', content: 'System note' },
      ]),
    ).toEqual({
      id: 'message-2',
      role: 'system',
      content: 'System note',
    })
  })

  it('returns null when the chat is empty', () => {
    expect(resolveAssetDiagnosticsTargetMessage([])).toBeNull()
  })
})
