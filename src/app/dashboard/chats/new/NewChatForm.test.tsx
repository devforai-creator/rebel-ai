// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('passes the selected credential and model to the new chat URL', async () => {
    createChatMock.mockResolvedValue({ chatId: 'chat-1' })
    render(<NewChatForm character={character} apiKeys={apiKeys} personas={personas} />)

    fireEvent.change(screen.getByLabelText(/모델 선택/), {
      target: { value: JSON.stringify(['key-1', 'gpt-5.4']) },
    })
    fireEvent.click(screen.getByRole('button', { name: '채팅 시작' }))

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard/chats/chat-1?apiKey=key-1&model=gpt-5.4')
    })
  })
})
