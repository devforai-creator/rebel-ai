// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatImportModal from './ChatImportModal'
import CharacterDetailView from './CharacterDetailView'
import NewChatButton from './NewChatButton'
import { importCharacterChat } from './character-chats-client'

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean
  }) => (
    <a
      href={typeof href === 'string' ? href : '#'}
      data-prefetch={prefetch === false ? 'false' : undefined}
      {...props}
    >
      {children}
    </a>
  ),
}))

vi.mock('./character-chats-client', () => ({
  importCharacterChat: vi.fn(),
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

  it('imports a chat file and offers navigation to the imported chat', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.mocked(importCharacterChat).mockResolvedValue({
      success: true,
      chatId: 'chat-42',
      messageCount: 7,
    })

    const { container } = render(
      <ChatImportModal characterId="char-1" characterName="Guide" isOpen onClose={onClose} />,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(
      input,
      new File(['{"chat":true}'], 'guide_chat.json', { type: 'application/json' }),
    )

    const titleInput = screen.getByPlaceholderText(
      'Title for the imported chat',
    ) as HTMLInputElement
    expect(titleInput.value).toBe('guide')

    await user.clear(titleInput)
    await user.type(titleInput, 'Imported session')
    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(importCharacterChat).toHaveBeenCalledWith(
        'char-1',
        expect.objectContaining({ name: 'guide_chat.json' }),
        'Imported session',
      )
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(refreshMock).not.toHaveBeenCalled()
    })

    expect(await screen.findByText('Open imported chat?')).toBeTruthy()
    expect(screen.getByText('Imported 7 messages successfully.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Go to chat' }))

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard/chats/chat-42')
    })
  })

  it('surfaces import failures and resets local state on cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.mocked(importCharacterChat).mockResolvedValue({
      success: false,
      error: 'Malformed export',
    })

    const { container } = render(
      <ChatImportModal characterId="char-1" characterName="Guide" isOpen onClose={onClose} />,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(
      input,
      new File(['{"chat":false}'], 'broken.json', { type: 'application/json' }),
    )
    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByText('Malformed export')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Click to select JSON file')).toBeTruthy()
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

describe('CharacterDetailView', () => {
  it('does not prefetch chat detail routes while preserving list interactions', async () => {
    const user = userEvent.setup()

    render(
      <CharacterDetailView
        character={{
          id: 'char-1',
          name: 'Guide',
          description: null,
          system_prompt: 'Guide the user',
          greeting_message: null,
          avatar_url: null,
          visibility: 'private',
          created_at: '2026-04-12T00:00:00.000Z',
        }}
        chats={[
          {
            id: 'chat-1',
            title: 'Session one',
            created_at: '2026-04-12T00:00:00.000Z',
            last_message_at: '2026-04-12T01:00:00.000Z',
            recency_at: '2026-04-12T01:00:00.000Z',
            lastMessage: null,
          },
        ]}
        isStarter={false}
        modules={[]}
        initialModuleIds={[]}
        hasMoreChats={false}
        initialChatCursor={null}
      />,
    )

    expect(screen.getByRole('link', { name: /Session one/ }).getAttribute('data-prefetch')).toBe(
      'false',
    )

    await user.click(screen.getByRole('button', { name: 'Import Chat' }))
    expect(screen.getByText('Click to select JSON file')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete "Session one"?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
