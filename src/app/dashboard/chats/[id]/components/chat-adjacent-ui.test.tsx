import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DeleteChatButton from '../DeleteChatButton'
import SystemPromptEditorButton from '../SystemPromptEditorButton'
import { ChatComposer, shouldSubmitChatComposerOnEnter } from './ChatComposer'
import { DebugModal } from './DebugModal'
import { LorebookPanelContent } from './LorebookPanelContent'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}))

describe('DeleteChatButton', () => {
  it('renders a destructive menu action label for chat deletion', () => {
    const html = renderToStaticMarkup(
      <DeleteChatButton chatId="chat-1" chatTitle="Example Chat" asMenuItem />,
    )

    expect(html).toContain('Delete Chat')
    expect(html).toContain('menuitem')
  })
})

describe('SystemPromptEditorButton', () => {
  it('shows a custom badge when the chat overrides the default system prompt', () => {
    const html = renderToStaticMarkup(
      <SystemPromptEditorButton
        chatId="chat-1"
        initialPrompt="custom prompt"
        defaultPrompt="default prompt"
      />,
    )

    expect(html).toContain('System Prompt')
    expect(html).toContain('Custom')
  })

  it('does not show a custom badge when the stored value matches the default prompt', () => {
    const html = renderToStaticMarkup(
      <SystemPromptEditorButton
        chatId="chat-1"
        initialPrompt="  default prompt  "
        defaultPrompt="default prompt"
      />,
    )

    expect(html).toContain('System Prompt')
    expect(html).not.toContain('Custom')
  })
})

describe('LorebookPanelContent', () => {
  it('renders an explicit empty-state message when the filtered list is empty', () => {
    const html = renderToStaticMarkup(
      <LorebookPanelContent
        overrideMap={new Map()}
        totalEntries={0}
        alwaysActiveCount={0}
        searchQuery=""
        setSearchQuery={vi.fn()}
        filter="all"
        setFilter={vi.fn()}
        showPreview={false}
        setShowPreview={vi.fn()}
        groupByFolder={false}
        setGroupByFolder={vi.fn()}
        activeFolderKey={null}
        setActiveFolderKey={vi.fn()}
        isSearching={false}
        expandedEntryId={null}
        setExpandedEntryId={vi.fn()}
        folderMeta={new Map()}
        groupedEntries={{ folderMap: new Map(), folderOrder: [] }}
        setEntryOverride={vi.fn(async () => null)}
        onClose={vi.fn()}
      />,
    )

    expect(html).toContain('No matching lorebook entries')
    expect(html).toContain('Try clearing the search or switching filters')
  })
})

describe('DebugModal', () => {
  it('renders the shared info-state message when no debug info is stored', () => {
    const html = renderToStaticMarkup(
      <DebugModal isOpen debugInfo={null} message={null} onClose={vi.fn()} />,
    )

    expect(html).toContain('Debug Info')
    expect(html).toContain('No server debug_info stored')
    expect(html).toContain('Close')
  })

  it('renders asset diagnostics mode without the message debug empty-state copy', () => {
    const html = renderToStaticMarkup(
      <DebugModal isOpen debugInfo={null} message={null} mode="assets" onClose={vi.fn()} />,
    )

    expect(html).toContain('Asset Diagnostics')
    expect(html).toContain('No message selected for unresolved asset checks')
    expect(html).not.toContain('No server debug_info stored')
  })

  it('renders arbitrary debug_info fields without bespoke UI wiring', () => {
    const html = renderToStaticMarkup(
      <DebugModal
        isOpen
        debugInfo={
          {
            experimental: {
              agenticTranscriptRecall: {
                toolCallCount: 2,
                toolFetchCount: 1,
              },
            },
          } as never
        }
        message={null}
        onClose={vi.fn()}
      />,
    )

    expect(html).toContain('Raw debug_info')
    expect(html).toContain('agenticTranscriptRecall')
    expect(html).toContain('toolCallCount')
    expect(html).toContain('toolFetchCount')
  })
})

describe('ChatComposer', () => {
  it('renders the send action disabled for blank input', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        composerRef={{ current: null }}
        input="   "
        isLoading={false}
        onInputChange={vi.fn()}
        onQuickInsert={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(html).toContain('Type a message...')
    expect(html).toContain('Send message')
    expect(html).toContain('Insert double quote')
    expect(html).toContain('Insert apostrophe')
    expect(html).toContain('Insert asterisk')
    expect(html).toContain('disabled')
  })

  it('shows the loading label when a queued send is in progress', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        composerRef={{ current: null }}
        input="hello"
        isLoading
        onInputChange={vi.fn()}
        onQuickInsert={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(html).toContain('Sending message')
    expect(html).toContain('Sending...')
    expect(html).not.toContain('>Send<')
  })

  it('submits on Enter for desktop keyboard interactions', () => {
    expect(
      shouldSubmitChatComposerOnEnter({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        mobileViewport: false,
      }),
    ).toBe(true)
  })

  it('keeps Enter as a newline on mobile viewports', () => {
    expect(
      shouldSubmitChatComposerOnEnter({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        mobileViewport: true,
      }),
    ).toBe(false)
  })
})
