// @vitest-environment jsdom

import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NewChatPage from './page'

const { createClient, loadPreview, formProps, redirect } = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadPreview: vi.fn(),
  formProps: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error('redirect:' + path)
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('./greeting-preview-data', () => ({ loadGreetingPreviewData: loadPreview }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('./NewChatForm', () => ({
  default: (props: unknown) => {
    formProps(props)
    return <div>New chat form</div>
  },
}))

const character = {
  id: 'char-1',
  user_id: 'user-1',
  name: 'Guide',
  greeting_message: 'Hello',
  metadata: null,
}

function setup(
  user: { id: string } | null,
  selectedCharacter: typeof character | null = character,
) {
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: (table: string) => {
      const result = {
        data:
          table === 'characters'
            ? selectedCharacter
            : table === 'api_keys'
              ? [
                  {
                    id: 'key-1',
                    provider: 'openai',
                    key_name: 'Primary',
                    model_preference: 'gpt-5.5',
                  },
                ]
              : [],
        error: null,
      }
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        is: () => query,
        order: () => query,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      }
      return query
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setup({ id: 'user-1' })
  loadPreview.mockResolvedValue({ characterAssets: [], assetUrlMap: {}, moduleRegex: [] })
})

describe('new chat preview access', () => {
  it('does not use privileged asset loading before authentication', async () => {
    setup(null)
    await expect(
      NewChatPage({ searchParams: Promise.resolve({ character: 'char-1' }) }),
    ).rejects.toThrow('redirect:/auth/login')
    expect(loadPreview).not.toHaveBeenCalled()
  })

  it('does not load assets for a character excluded by the access-filtered query', async () => {
    setup({ id: 'user-1' }, null)
    await expect(
      NewChatPage({ searchParams: Promise.resolve({ character: 'private-character' }) }),
    ).rejects.toThrow('redirect:/dashboard/characters')
    expect(loadPreview).not.toHaveBeenCalled()
  })

  it('passes chat rendering assets to the form for an accessible character', async () => {
    render(await NewChatPage({ searchParams: Promise.resolve({ character: 'char-1' }) }))
    expect(screen.getByText('New chat form')).toBeTruthy()
    expect(loadPreview).toHaveBeenCalledWith(character)
    expect(formProps).toHaveBeenCalledWith(
      expect.objectContaining({ greetingPreviewData: await loadPreview.mock.results[0].value }),
    )
  })

  it('skips asset loading when there are no greetings to preview', async () => {
    setup({ id: 'user-1' }, { ...character, greeting_message: '' })
    await NewChatPage({ searchParams: Promise.resolve({ character: 'char-1' }) })
    expect(loadPreview).not.toHaveBeenCalled()
  })
})
