import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatImportModal from './ChatImportModal'
import NewChatButton from './NewChatButton'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/app/dashboard/chats/actions', () => ({
  importChat: vi.fn(),
}))

describe('ChatImportModal', () => {
  it('renders the shared import chrome and button hierarchy when open', () => {
    const html = renderToStaticMarkup(
      <ChatImportModal characterId="char-1" characterName="Guide" isOpen onClose={vi.fn()} />,
    )

    expect(html).toContain('Import Chat')
    expect(html).toContain('Click to select JSON file')
    expect(html).toContain('Cancel')
    expect(html).toContain('Import')
  })
})

describe('NewChatButton', () => {
  it('reuses the shared primary button styling for the new chat entry point', () => {
    const html = renderToStaticMarkup(<NewChatButton characterId="char-1" />)

    expect(html).toContain('/dashboard/chats/new?character=char-1')
    expect(html).toContain('bg-blue-600')
    expect(html).toContain('새 채팅 시작')
  })
})
