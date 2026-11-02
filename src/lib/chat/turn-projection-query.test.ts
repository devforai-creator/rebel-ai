import { describe, expect, it } from 'vitest'
import {
  loadGenerationTranscript,
  loadProjectedChatMessages,
  loadProjectedConversationMessages,
  loadProjectedConversationTail,
} from './turn-projection'
import { loadTurnsForChat } from './turn-projection-query'
import type { TurnClient } from './turn-types'

type Row = Record<string, unknown>

// Emulate PostgREST's 1,000-row cap even when a caller omits a limit.
function cappedDatabase(turnCount = 1203, failSecondPage = false) {
  const turns: Row[] = Array.from({ length: turnCount }, (_, i) => ({
    id: 'turn-' + i,
    chat_id: 'chat-1',
    turn_index: i * 3 + 1,
    user_message_id: 'user-' + i,
    active_assistant_message_id: 'assistant-' + i,
  }))
  const messages: Row[] = turns.flatMap((turn, i) =>
    ['user', 'assistant'].map((role, offset) => ({
      id: role + '-' + i,
      chat_id: 'chat-1',
      role,
      content: role + '-' + i,
      sequence: i * 2 + offset + 1,
      message_status: 'completed',
    })),
  )
  const tables = { chat_turns: turns, messages }
  const client = {
    from(table: keyof typeof tables) {
      let rows = [...tables[table]]
      let limit = 1000
      let paginated = false
      const query = {
        select() {
          return query
        },
        eq(field: string, value: unknown) {
          rows = rows.filter((r) => r[field] === value)
          return query
        },
        neq(field: string, value: unknown) {
          rows = rows.filter((r) => r[field] !== value)
          return query
        },
        in(field: string, values: unknown[]) {
          rows = rows.filter((r) => values.includes(r[field]))
          return query
        },
        gte(field: string, value: number) {
          rows = rows.filter((r) => Number(r[field]) >= value)
          return query
        },
        lte(field: string, value: number) {
          rows = rows.filter((r) => Number(r[field]) <= value)
          return query
        },
        gt(field: string, value: number) {
          paginated = true
          rows = rows.filter((r) => Number(r[field]) > value)
          return query
        },
        lt(field: string, value: number) {
          paginated = true
          rows = rows.filter((r) => Number(r[field]) < value)
          return query
        },
        order(field: string, { ascending }: { ascending: boolean }) {
          rows.sort((a, b) => (Number(a[field]) - Number(b[field])) * (ascending ? 1 : -1))
          return query
        },
        limit(count: number) {
          limit = Math.min(count, 1000)
          return query
        },
        single() {
          return Promise.resolve({ data: rows[0], error: null })
        },
        then(
          resolve: (result: { data: Row[] | null; error: { message: string } | null }) => unknown,
        ) {
          return Promise.resolve(
            failSecondPage && table === 'chat_turns' && paginated
              ? { data: null, error: { message: 'second page unavailable' } }
              : { data: rows.slice(0, limit), error: null },
          ).then(resolve)
        },
      }
      return query
    },
  }
  return { client: client as unknown as TurnClient, turns, messages }
}

describe('projection pagination beyond the Data API row cap', () => {
  it('loads every active message for exports and summary generation', async () => {
    const { client, messages } = cappedDatabase()
    expect(await loadProjectedConversationMessages({ supabase: client, chatId: 'chat-1' })).toEqual(
      messages,
    )
    expect(await loadProjectedChatMessages({ supabase: client, chatId: 'chat-1' })).toEqual(
      messages,
    )
  })

  it('keeps all messages in a long unsealed generation tail', async () => {
    const { client, messages } = cappedDatabase()
    expect(
      await loadProjectedConversationTail({
        supabase: client,
        chatId: 'chat-1',
        limitMessages: 2201,
      }),
    ).toEqual(messages.slice(-2201))
  })

  it('applies a descending limit across pages with non-contiguous turn indices', async () => {
    const { client, turns } = cappedDatabase()
    expect(
      await loadTurnsForChat({
        supabase: client,
        chatId: 'chat-1',
        ascending: false,
        limit: 1005,
      }),
    ).toEqual(turns.slice(-1005).reverse())
  })

  it('preserves range boundaries across pages', async () => {
    const { client, turns } = cappedDatabase()
    expect(
      await loadTurnsForChat({
        supabase: client,
        chatId: 'chat-1',
        ascending: true,
        minTurnIndex: 4,
        maxTurnIndex: 3301,
      }),
    ).toEqual(turns.filter((t) => Number(t.turn_index) >= 4 && Number(t.turn_index) <= 3301))
  })

  it('loads a transcript through its target turn and excludes only its active assistant', async () => {
    const { client, messages } = cappedDatabase()
    const transcript = await loadGenerationTranscript({
      supabase: client,
      chatId: 'chat-1',
      turnId: 'turn-1050',
      excludeAssistantForTurnId: 'turn-1050',
    })
    expect(transcript.map((m) => m.messageId)).toEqual(messages.slice(0, 2101).map((m) => m.id))
  })

  it('paginates standalone system messages in exports', async () => {
    const { client, messages } = cappedDatabase(0)
    messages.push(
      ...Array.from({ length: 1003 }, (_, i) => ({
        id: 'system-' + i,
        chat_id: 'chat-1',
        role: 'system',
        content: 'system',
        sequence: i + 1,
        message_status: 'completed',
      })),
    )
    expect(await loadProjectedChatMessages({ supabase: client, chatId: 'chat-1' })).toEqual(
      messages,
    )
  })

  it('rejects a failed later page instead of returning partial history', async () => {
    const { client } = cappedDatabase(1203, true)
    await expect(
      loadProjectedConversationMessages({ supabase: client, chatId: 'chat-1' }),
    ).rejects.toThrow('second page unavailable')
  })
})
