// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSelectableApiKeyOption } from '../api-key-options'
import NewChatForm from './NewChatForm'

const pushMock = vi.fn()
const createChatMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

vi.mock('../actions', () => ({
  createChat: (...args: unknown[]) => createChatMock(...args),
}))

const character = {
  id: 'char-1',
  user_id: 'user-1',
  name: 'Guide',
  greeting_message: 'Hello',
  metadata: {
    alternate_greetings: ['Welcome'],
  },
}

const apiKeys = [
  {
    id: 'key-1',
    key_name: 'Primary',
    provider: 'openai',
    model_preference: 'gpt-5.5',
  },
  {
    id: 'key-2',
    key_name: 'Secondary',
    provider: 'anthropic',
    model_preference: 'claude-sonnet-5',
  },
] satisfies ChatSelectableApiKeyOption[]

const personas = [
  { id: 'persona-1', name: 'Scout', description: 'Curious' },
  { id: 'persona-2', name: 'Scholar', description: 'Careful' },
]

function getReturnToFromManagementLink() {
  const href = screen.getByRole('link', { name: '페르소나 관리' }).getAttribute('href')
  expect(href).toBeTruthy()

  return new URL(href!, 'https://rebel-ai.local').searchParams.get('returnTo')
}

describe('NewChatForm', () => {
  beforeEach(() => {
    pushMock.mockReset()
    createChatMock.mockReset()
  })

  it('restores valid new-chat selections from the return URL', () => {
    render(
      <NewChatForm
        character={character}
        apiKeys={apiKeys}
        personas={personas}
        initialApiKeyId="key-2"
        initialModelName="claude-sonnet-5"
        initialPersonaId="persona-1"
        initialGreetingIndex={1}
      />,
    )

    expect((screen.getByLabelText(/모델 선택/) as HTMLSelectElement).value).toBe(
      JSON.stringify(['key-2', 'claude-sonnet-5']),
    )
    expect((screen.getByLabelText(/페르소나 선택/) as HTMLSelectElement).value).toBe('persona-1')
    expect(screen.getByText('첫 인사 (2/3)')).toBeTruthy()
  })

  it('keeps the current selections in the persona management return target', () => {
    render(<NewChatForm character={character} apiKeys={apiKeys} personas={personas} />)

    fireEvent.change(screen.getByLabelText(/모델 선택/), {
      target: { value: JSON.stringify(['key-2', 'claude-sonnet-5']) },
    })
    fireEvent.change(screen.getByLabelText(/페르소나 선택/), {
      target: { value: 'persona-2' },
    })
    fireEvent.click(screen.getByTitle('다음 인사말'))

    const returnTo = getReturnToFromManagementLink()
    const returnUrl = new URL(returnTo!, 'https://rebel-ai.local')

    expect(returnUrl.pathname).toBe('/dashboard/chats/new')
    expect(returnUrl.searchParams.get('character')).toBe('char-1')
    expect(returnUrl.searchParams.get('apiKey')).toBe('key-2')
    expect(returnUrl.searchParams.get('model')).toBe('claude-sonnet-5')
    expect(returnUrl.searchParams.get('persona')).toBe('persona-2')
    expect(returnUrl.searchParams.get('greeting')).toBe('1')
  })

  it('persists the selected credential and model before opening the new chat', async () => {
    createChatMock.mockResolvedValue({ chatId: 'chat-1' })
    render(<NewChatForm character={character} apiKeys={apiKeys} personas={personas} />)

    fireEvent.change(screen.getByLabelText(/모델 선택/), {
      target: { value: JSON.stringify(['key-1', 'gpt-5.4']) },
    })
    fireEvent.click(screen.getByRole('button', { name: '채팅 시작' }))

    await waitFor(() => {
      expect(createChatMock).toHaveBeenCalledWith({
        characterId: 'char-1',
        personaId: null,
        greetingIndex: 0,
        modelSelection: {
          apiKeyId: 'key-1',
          modelName: 'gpt-5.4',
        },
      })
      expect(pushMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
    })
  })
})

describe('new chats from saves', () => {
  const saves = [{ id: 'save-1', title: '첫 번째 모험', default_persona_id: 'persona-2' }]
  it('preselects the save default but permits an explicit persona opt-out', () => {
    const { rerender } = render(
      <NewChatForm
        character={character}
        apiKeys={apiKeys}
        personas={personas}
        saves={saves}
        initialSaveId="save-1"
      />,
    )
    expect((screen.getByLabelText(/페르소나 선택/) as HTMLSelectElement).value).toBe('persona-2')
    rerender(
      <NewChatForm
        key="explicit"
        character={character}
        apiKeys={apiKeys}
        personas={personas}
        saves={saves}
        initialSaveId="save-1"
        initialPersonaId=""
      />,
    )
    expect((screen.getByLabelText(/페르소나 선택/) as HTMLSelectElement).value).toBe('')
  })
  it('submits the chosen save and retains it in the management return URL', async () => {
    createChatMock.mockResolvedValue({ chatId: 'new' })
    render(
      <NewChatForm character={character} apiKeys={apiKeys} personas={personas} saves={saves} />,
    )
    fireEvent.change(screen.getByLabelText(/세이브 선택/), { target: { value: 'save-1' } })
    expect((screen.getByLabelText(/페르소나 선택/) as HTMLSelectElement).value).toBe('persona-2')
    const href = screen.getByRole('link', { name: '세이브 관리' }).getAttribute('href')!
    expect(new URL(href, 'https://example.test').searchParams.get('returnTo')).toContain(
      'save=save-1',
    )
    fireEvent.click(screen.getByRole('button', { name: '채팅 시작' }))
    await waitFor(() =>
      expect(createChatMock).toHaveBeenCalledWith(
        expect.objectContaining({ saveId: 'save-1', personaId: 'persona-2' }),
      ),
    )
  })
})

describe('first greeting preview', () => {
  beforeEach(() => {
    createChatMock.mockReset()
    pushMock.mockReset()
  })
  const previewData = {
    characterAssets: [],
    assetUrlMap: { 'hero.webp': 'https://example.com/signed-hero.webp' },
    imageCommandUrlMap: { happy: 'https://example.com/signed-happy.webp' },
    moduleRegex: [
      {
        type: 'extract',
        comment: 'location panel',
        in: '\\[Loc:([^\\]]+)\\]',
        out: '',
        ableFlag: true,
        card_ref: 'status',
        bindings: { location: '$1' },
      },
    ],
    moduleAssetSummary: [],
  }
  const cardCharacter = {
    ...character,
    greeting_message:
      '**안녕, {{user}}**\n다음 줄의 이야기\n\n[Loc:Forest]\n\n![기쁜 표정](asset:happy)',
    metadata: {
      alternate_greetings: ['두 번째 시작'],
      default_variables: { opened: false },
      ui_cards: {
        status: {
          meta: { name: 'Location', version: '1.0.0' },
          state: { location: 'Start', opened: false },
          assets: { portrait: '@assets/hero.webp' },
          views: {
            Main: {
              type: 'Column',
              children: [
                { type: 'Text', content: { $ref: '$location' } },
                { type: 'Image', src: '@assets/hero.webp', alt: '카드 초상화' },
                { type: 'Button', label: '카드에서 확인', action: 'opened' },
                { type: 'Text', content: { $ref: '$opened' } },
              ],
            },
          },
        },
      },
    },
  }

  it('renders real SUU cards, bound state, markdown and signed images before chat creation', () => {
    render(
      <NewChatForm
        character={cardCharacter}
        apiKeys={apiKeys}
        personas={personas}
        greetingPreviewData={previewData}
      />,
    )

    const preview = screen.getByRole('region', { name: '첫 인사 미리보기' })
    expect(screen.getByText('안녕, User').tagName).toBe('STRONG')
    expect(preview.querySelector('br')).toBeTruthy()
    expect(screen.getByText('Forest')).toBeTruthy()
    expect(preview.textContent).not.toContain('[Loc:Forest]')
    expect(screen.getByAltText('카드 초상화').getAttribute('src')).toBe(
      'https://example.com/signed-hero.webp',
    )
    expect(screen.getByAltText('기쁜 표정').getAttribute('src')).toBe(
      'https://example.com/signed-happy.webp',
    )
    expect(createChatMock).not.toHaveBeenCalled()
  })

  it('updates persona names and keeps card actions local without submitting the form', () => {
    render(
      <NewChatForm
        character={cardCharacter}
        apiKeys={apiKeys}
        personas={personas}
        greetingPreviewData={previewData}
      />,
    )

    fireEvent.change(screen.getByLabelText(/페르소나 선택/), { target: { value: 'persona-2' } })
    expect(screen.getByText('안녕, Scholar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '카드에서 확인' }))
    expect(screen.getByText('true')).toBeTruthy()
    expect(createChatMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('다음 인사말'))
    expect(screen.getByText('두 번째 시작')).toBeTruthy()
    fireEvent.click(screen.getByTitle('이전 인사말'))
    expect(screen.getByText('false')).toBeTruthy()
  })

  it('cycles through the no-greeting option and submits that selection', async () => {
    createChatMock.mockResolvedValue({ chatId: 'chat-no-greeting' })
    render(<NewChatForm character={character} apiKeys={apiKeys} personas={personas} />)

    fireEvent.click(screen.getByTitle('이전 인사말'))
    expect(screen.getByText('(인사말 없이 시작)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '크게 보기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '채팅 시작' }))
    await waitFor(() =>
      expect(createChatMock).toHaveBeenCalledWith(expect.objectContaining({ greetingIndex: 2 })),
    )
  })

  it('opens a larger preview, switches greetings there, and closes without starting a chat', () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: showModal,
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: close,
    })

    const { unmount } = render(
      <NewChatForm character={character} apiKeys={apiKeys} personas={personas} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }))

    const dialog = screen.getByRole('dialog')
    expect(showModal).toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(dialog).getByText('Hello')).toBeTruthy()
    fireEvent.click(within(dialog).getByTitle('다음 인사말'))
    expect(within(dialog).getByText('Welcome')).toBeTruthy()

    // Native Escape closes the dialog and dispatches a close event.
    dialog.removeAttribute('open')
    fireEvent(dialog, new Event('close'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByRole('region', { name: '첫 인사 미리보기' }).textContent).toBe('Welcome')
    expect(createChatMock).not.toHaveBeenCalled()
    unmount()
    vi.restoreAllMocks()
  })
})
