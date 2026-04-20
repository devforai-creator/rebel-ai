import { describe, expect, it } from 'vitest'

import { resolveMessageActionItems } from './MessageActionBar'

describe('resolveMessageActionItems', () => {
  it('shows the full assistant toolset for the latest persisted assistant message', () => {
    expect(
      resolveMessageActionItems({
        role: 'assistant',
        isPersisted: true,
        isLastMessage: true,
        isLatestAssistant: true,
        developerMode: true,
        isLoading: false,
        isReprocessing: false,
        reprocessingMessageId: null,
        isRetranslating: false,
        retranslatingMessageId: null,
      }).map((item) => item.id),
    ).toEqual(['edit', 'delete', 'regenerate', 'reprocess', 'debug', 'translate'])
  })

  it('limits non-persisted user messages to edit and delete', () => {
    expect(
      resolveMessageActionItems({
        role: 'user',
        isPersisted: false,
        isLastMessage: false,
        isLatestAssistant: false,
        developerMode: true,
        isLoading: false,
        isReprocessing: false,
        reprocessingMessageId: null,
        isRetranslating: false,
        retranslatingMessageId: null,
      }).map((item) => item.id),
    ).toEqual(['edit', 'delete'])
  })

  it('disables long-running tools while other work is active', () => {
    expect(
      resolveMessageActionItems({
        role: 'assistant',
        isPersisted: true,
        isLastMessage: false,
        isLatestAssistant: false,
        developerMode: false,
        isLoading: false,
        isReprocessing: true,
        reprocessingMessageId: 'message-1',
        isRetranslating: false,
        retranslatingMessageId: 'message-2',
      }),
    ).toEqual([
      {
        id: 'edit',
        label: 'Edit',
        title: 'Edit message',
      },
      {
        id: 'delete',
        label: 'Delete',
        title: 'Delete message',
      },
      {
        id: 'reprocess',
        label: 'Reprocessing...',
        title: 'Experimental reprocess with custom prompt',
        disabled: true,
      },
      {
        id: 'translate',
        label: 'Translate',
        title: 'Translate to English (Bilingual Memory)',
        disabled: true,
      },
    ])
  })

  it('hides debug for non-latest assistant messages even in developer mode', () => {
    expect(
      resolveMessageActionItems({
        role: 'assistant',
        isPersisted: true,
        isLastMessage: false,
        isLatestAssistant: false,
        developerMode: true,
        isLoading: false,
        isReprocessing: false,
        reprocessingMessageId: null,
        isRetranslating: false,
        retranslatingMessageId: null,
      }).map((item) => item.id),
    ).toEqual(['edit', 'delete', 'reprocess', 'translate'])
  })
})
