import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DeleteChatButton from '../DeleteChatButton'
import SystemPromptEditorButton from '../SystemPromptEditorButton'
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
})
