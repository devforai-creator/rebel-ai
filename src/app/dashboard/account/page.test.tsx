// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AccountPage from './page'

const { createClientMock, redirectMock, pushMock, refreshMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('./actions', () => ({
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
  updateAgenticTranscriptRecallDefaultSettings: vi.fn(),
  updateChatUsageSettings: vi.fn(),
  updateRagSettings: vi.fn(),
  updateReprocessSettings: vi.fn(),
  updateSummaryModelPreference: vi.fn(),
  updateSummaryPrompts: vi.fn(),
  updateTranslationModelPreference: vi.fn(),
}))

type ProfileRow = {
  id: string
  display_name: string | null
  chunk_summary_prompt: string | null
  meta_summary_prompt: string | null
  fact_extraction_prompt: string | null
  enable_episodic_rag: boolean
  enable_agentic_transcript_recall_default: boolean
  enable_chat_usage_stats: boolean
  voyage_embedding_api_key_id: string | null
  summary_api_key_id: string | null
  summary_model_name: string | null
  reprocess_prompt: string | null
  reprocess_api_key_id: string | null
  reprocess_model_name: string | null
  translation_api_key_id: string | null
  translation_model_name: string | null
}

type ApiKeyRow = {
  id: string
  user_id: string
  key_name: string
  provider: string
  model_preference: string | null
  is_active: boolean
  service_tier: string | null
  created_at: string
}

type UserRow = {
  id: string
  email: string
}

function pickSelectedColumns<T extends Record<string, unknown>>(row: T, columns: string) {
  return Object.fromEntries(
    columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
      .map((column) => [column, row[column]]),
  )
}

function buildSupabase({
  user,
  profile,
  apiKeys,
}: {
  user: UserRow
  profile: ProfileRow
  apiKeys: ApiKeyRow[]
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select(columns: string) {
            const filters: Array<[string, unknown]> = []
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value])
                return builder
              },
              async single() {
                const requestedUserId = filters.find(([field]) => field === 'id')?.[1]

                if (requestedUserId !== user.id) {
                  return { data: null, error: { message: 'not found' } }
                }

                return {
                  data: pickSelectedColumns(profile, columns),
                  error: null,
                }
              },
            }

            return builder
          },
        }
      }

      if (table === 'api_keys') {
        return {
          select() {
            const filters: Array<[string, unknown]> = []
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value])
                return builder
              },
              async order() {
                const filteredRows = apiKeys
                  .filter((row) =>
                    filters.every(([field, value]) => row[field as keyof ApiKeyRow] === value),
                  )
                  .sort((left, right) => left.created_at.localeCompare(right.created_at))

                return {
                  data: filteredRows,
                  error: null,
                }
              },
            }

            return builder
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

afterEach(() => {
  cleanup()
  createClientMock.mockReset()
  redirectMock.mockReset()
  pushMock.mockReset()
  refreshMock.mockReset()
})

describe('account page', () => {
  it('renders all account setting sections from the selected profile fields', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: {
          id: 'user-1',
          email: 'owner@example.com',
        },
        profile: {
          id: 'user-1',
          display_name: 'Owner',
          chunk_summary_prompt: 'Chunk prompt override',
          meta_summary_prompt: 'Meta prompt override',
          fact_extraction_prompt: 'Fact prompt override',
          enable_episodic_rag: true,
          enable_agentic_transcript_recall_default: true,
          enable_chat_usage_stats: true,
          voyage_embedding_api_key_id: 'voyage-key',
          summary_api_key_id: 'summary-key',
          summary_model_name: 'gpt-5.5',
          reprocess_prompt: 'Translate to Korean and keep the tone.',
          reprocess_api_key_id: 'reprocess-key',
          reprocess_model_name: 'gpt-5.4',
          translation_api_key_id: 'translation-key',
          translation_model_name: 'gemini-2.5-flash',
        },
        apiKeys: [
          {
            id: 'voyage-key',
            user_id: 'user-1',
            key_name: 'Voyage Memory',
            provider: 'voyage_embeddings',
            model_preference: null,
            is_active: true,
            service_tier: null,
            created_at: '2026-04-01T00:00:00.000Z',
          },
          {
            id: 'summary-key',
            user_id: 'user-1',
            key_name: 'Budget Summary',
            provider: 'openai',
            model_preference: 'gpt-5.5',
            is_active: true,
            service_tier: null,
            created_at: '2026-04-02T00:00:00.000Z',
          },
          {
            id: 'reprocess-key',
            user_id: 'user-1',
            key_name: 'Rewrite Key',
            provider: 'openai',
            model_preference: 'gpt-5.4',
            is_active: true,
            service_tier: 'default',
            created_at: '2026-04-03T00:00:00.000Z',
          },
          {
            id: 'translation-key',
            user_id: 'user-1',
            key_name: 'Translator Key',
            provider: 'google',
            model_preference: 'gemini-2.5-flash',
            is_active: true,
            service_tier: null,
            created_at: '2026-04-04T00:00:00.000Z',
          },
        ],
      }),
    )

    render(await AccountPage())

    expect(screen.getByRole('heading', { name: 'Account Settings' })).toBeTruthy()
    expect(screen.getByText('Owner (owner@example.com)')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Message Reprocess' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Bilingual Memory' })).toBeTruthy()

    expect(
      (screen.getByLabelText('Chunk Summary Prompt (per 10 messages)') as HTMLTextAreaElement)
        .value,
    ).toBe('Chunk prompt override')
    expect(
      (screen.getByLabelText('Meta Summary Prompt (per 100 messages)') as HTMLTextAreaElement)
        .value,
    ).toBe('Meta prompt override')
    expect(
      (
        screen.getByLabelText(
          'Fact Extraction Prompt (Episodic Memory, per 10 messages)',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe('Fact prompt override')
    expect(
      (screen.getByLabelText('Voyage Embeddings Key to Connect') as HTMLSelectElement).value,
    ).toBe('voyage-key')
    expect((screen.getByLabelText('Summary-dedicated Model') as HTMLSelectElement).value).toBe(
      JSON.stringify(['summary-key', 'gpt-5.5']),
    )
    expect((screen.getByLabelText('Reprocess Prompt') as HTMLTextAreaElement).value).toBe(
      'Translate to Korean and keep the tone.',
    )
    expect((screen.getByLabelText('Reprocess Model') as HTMLSelectElement).value).toBe(
      JSON.stringify(['reprocess-key', 'gpt-5.4']),
    )
    expect(
      (screen.getByLabelText('Translation Model (Bilingual Memory)') as HTMLSelectElement).value,
    ).toBe(JSON.stringify(['translation-key', 'gemini-2.5-flash']))

    expect(
      document.querySelector('input[name="enable_chat_usage_stats"][value="true"]'),
    ).not.toBeNull()
    expect(
      document.querySelector(
        'input[name="enable_agentic_transcript_recall_default"][value="true"]',
      ),
    ).not.toBeNull()
  })
})
