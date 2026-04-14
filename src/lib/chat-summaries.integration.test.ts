import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: vi.fn(),
  }
})

import type { LanguageModel } from 'ai'
import { generateText } from 'ai'
import type { ChatSummary } from '@/types/database.types'
import type { ChatSummariesSupabaseClient } from './chat-summaries'
import { SUMMARY_CONFIG, updateSummaries } from './chat-summaries'

const generateTextMock = vi.mocked(generateText)
type GenerateTextResult = Awaited<ReturnType<typeof generateText>>

function buildUsage(completionTokens: number): NonNullable<GenerateTextResult['usage']> {
  return {
    inputTokens: 0,
    outputTokens: completionTokens,
    totalTokens: completionTokens,
  }
}

function createGenerateTextResult(text: string, completionTokens: number): GenerateTextResult {
  return {
    text,
    usage: buildUsage(completionTokens),
    finishReason: 'stop',
  } as GenerateTextResult
}

type ChatRole = 'user' | 'assistant'

interface MessageRow extends Record<string, unknown> {
  id: string
  chat_id: string
  sequence: number
  role: ChatRole
  content: string
}

type ChatSummaryRow = ChatSummary & Record<string, unknown>
type ChatTurnRow = {
  id: string
  chat_id: string
  turn_index: number
  user_message_id: string | null
  active_assistant_message_id: string | null
}

// NOTE: SUMMARY_LEVEL_SUPER_META, SUMMARY_GROUP_SIZE, and SUPER_SUMMARY_GROUP_SIZE
// were removed because the active summary pipeline does not use super-meta summaries.
const { SUMMARY_LEVEL_CHUNK, SUMMARY_LEVEL_META, CHUNK_SIZE } = SUMMARY_CONFIG

type Predicate<T> = (row: T) => boolean

class BaseQuery<T extends Record<string, unknown>> {
  constructor(
    private readonly source: () => T[],
    private readonly projector: (row: T) => Record<string, unknown>,
  ) {}

  private filters: Predicate<T>[] = []
  private orderSpec: { field: keyof T; ascending: boolean } | null = null
  private limitCount: number | null = null

  eq(field: keyof T, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  not(field: keyof T, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.filters.push((row) => row[field] !== null)
      return this
    }
    this.filters.push((row) => row[field] !== value)
    return this
  }

  gt(field: keyof T, value: number) {
    this.filters.push((row) => Number(row[field]) > value)
    return this
  }

  lte(field: keyof T, value: number) {
    this.filters.push((row) => Number(row[field]) <= value)
    return this
  }

  in(field: keyof T, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order(field: keyof T, options?: { ascending?: boolean }) {
    this.orderSpec = { field, ascending: options?.ascending ?? true }
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  maybeSingle<R = Record<string, unknown>>() {
    const [first] = this.projectRows(this.materializeRows())
    return Promise.resolve({
      data: (first as R | undefined) ?? null,
      error: null,
    })
  }

  then<TResult1 = { data: Record<string, unknown>[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: Record<string, unknown>[]
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected)
  }

  protected materializeRows(): T[] {
    let rows = this.source().filter((row) => this.filters.every((predicate) => predicate(row)))

    if (this.orderSpec) {
      const { field, ascending } = this.orderSpec
      rows = rows.slice().sort((a, b) => {
        const av = a[field] as number | string | null | undefined
        const bv = b[field] as number | string | null | undefined
        if (av === bv) {
          return 0
        }
        if (av === undefined || av === null) {
          return ascending ? 1 : -1
        }
        if (bv === undefined || bv === null) {
          return ascending ? -1 : 1
        }
        const comparison = av > bv ? 1 : -1
        return ascending ? comparison : -comparison
      })
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount)
    }

    return rows
  }

  protected projectRows(rows: T[]) {
    return rows.map((row) => ({ ...this.projector(row) }))
  }

  private resolve() {
    return {
      data: this.projectRows(this.materializeRows()),
      error: null,
    }
  }
}

function mapColumns<T extends Record<string, unknown>>(columns: string) {
  const parts = columns
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  const selectAll = parts.length === 0 || parts.includes('*')

  if (selectAll) {
    return (row: T) => ({ ...row })
  }

  return (row: T) => {
    const result: Record<string, unknown> = {}
    for (const key of parts) {
      result[key] = row[key as keyof T]
    }
    return result
  }
}

class SupabaseMock {
  constructor(messages: MessageRow[]) {
    this.messages = messages
    this.chatTurns = deriveChatTurns(messages)
    this.chatSummaries = []
    this.chatFacts = []
  }

  messages: MessageRow[]
  chatTurns: ChatTurnRow[]
  chatSummaries: ChatSummaryRow[]
  chatFacts: Array<Record<string, unknown>>

  from(table: string) {
    if (table === 'messages') {
      return new MessagesTable(this)
    }
    if (table === 'chat_turns') {
      return new ChatTurnsTable(this)
    }
    if (table === 'chat_summaries') {
      return new ChatSummariesTable(this)
    }
    if (table === 'chat_facts') {
      return new ChatFactsTable(this)
    }
    if (table === 'profiles') {
      return new ProfilesTable(this)
    }
    throw new Error(`Unsupported table "${table}"`)
  }
}

function deriveChatTurns(messages: MessageRow[]): ChatTurnRow[] {
  const orderedMessages = [...messages].sort((a, b) => a.sequence - b.sequence)
  const turns: ChatTurnRow[] = []
  let currentTurn: ChatTurnRow | null = null
  let turnIndex = 0

  for (const message of orderedMessages) {
    if (message.role === 'user') {
      turnIndex += 1
      currentTurn = {
        id: `turn-${turnIndex}`,
        chat_id: message.chat_id,
        turn_index: turnIndex,
        user_message_id: message.id,
        active_assistant_message_id: null,
      }
      turns.push(currentTurn)
      continue
    }

    if (!currentTurn) {
      turnIndex += 1
      currentTurn = {
        id: `turn-${turnIndex}`,
        chat_id: message.chat_id,
        turn_index: turnIndex,
        user_message_id: null,
        active_assistant_message_id: null,
      }
      turns.push(currentTurn)
    }

    currentTurn.active_assistant_message_id = message.id
  }

  return turns
}

class MessagesTable {
  constructor(private readonly mock: SupabaseMock) {}

  select(columns: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) {
      return new MessagesCountQuery(this.mock)
    }
    return new MessagesQuery(this.mock, columns)
  }
}

class MessagesCountQuery {
  constructor(private readonly mock: SupabaseMock) {}

  async eq(field: keyof MessageRow, value: unknown) {
    const count = this.mock.messages.filter((row) => row[field] === value).length
    return { count, error: null }
  }
}

class ChatTurnsTable {
  constructor(private readonly mock: SupabaseMock) {}

  select(columns: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) {
      return new ChatTurnsCountQuery(this.mock)
    }
    return new ChatTurnsQuery(this.mock, columns)
  }
}

class ChatTurnsQuery extends BaseQuery<ChatTurnRow> {
  constructor(mock: SupabaseMock, columns: string) {
    super(() => mock.chatTurns, mapColumns<ChatTurnRow>(columns))
  }
}

class ChatTurnsCountQuery {
  constructor(private readonly mock: SupabaseMock) {}

  private predicates: Array<(row: ChatTurnRow) => boolean> = []

  eq(field: keyof ChatTurnRow, value: unknown) {
    this.predicates.push((row) => row[field] === value)
    return this
  }

  not(field: keyof ChatTurnRow, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.predicates.push((row) => row[field] !== null)
      return this
    }
    this.predicates.push((row) => row[field] !== value)
    return this
  }

  then<TResult1 = { count: number; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { count: number; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({
      count: this.mock.chatTurns.filter((row) =>
        this.predicates.every((predicate) => predicate(row)),
      ).length,
      error: null,
    }).then(onfulfilled, onrejected)
  }
}

class ChatSummariesTable {
  constructor(private readonly mock: SupabaseMock) {}

  select(columns: string) {
    return new ChatSummariesQuery(this.mock, columns)
  }

  insert(data: {
    chat_id: string
    level: number
    start_seq: number
    end_seq: number
    summary: string
    token_count: number | null
  }) {
    const row: ChatSummaryRow = {
      id: `summary-${this.mock.chatSummaries.length + 1}`,
      chat_id: data.chat_id,
      user_id: 'user-1',
      level: data.level,
      start_seq: data.start_seq,
      end_seq: data.end_seq,
      summary: data.summary,
      token_count: data.token_count,
      created_at: new Date().toISOString(),
    }
    this.mock.chatSummaries.push(row)
    return Promise.resolve({ data: row, error: null })
  }
}

class ChatSummariesQuery extends BaseQuery<ChatSummaryRow> {
  constructor(mock: SupabaseMock, columns: string) {
    super(() => mock.chatSummaries, mapColumns<ChatSummaryRow>(columns))
  }
}

class ChatFactsTable {
  constructor(private readonly mock: SupabaseMock) {}

  select(columns: string) {
    return new ChatFactsQuery(this.mock, columns)
  }

  insert(data: {
    chat_id: string
    user_id: string
    start_seq: number
    end_seq: number
    facts: string
  }) {
    const row = {
      id: `fact-${this.mock.chatFacts.length + 1}`,
      chat_id: data.chat_id,
      user_id: data.user_id,
      start_seq: data.start_seq,
      end_seq: data.end_seq,
      facts: data.facts,
      created_at: new Date().toISOString(),
    }
    this.mock.chatFacts.push(row)
    return Promise.resolve({ data: row, error: null })
  }
}

class ChatFactsQuery extends BaseQuery<Record<string, unknown>> {
  constructor(mock: SupabaseMock, columns: string) {
    super(() => mock.chatFacts, mapColumns<Record<string, unknown>>(columns))
  }
}

class ProfilesTable {
  constructor(private readonly mock: SupabaseMock) {}

  select(columns: string) {
    return new ProfilesQuery(this.mock, columns)
  }
}

class ProfilesQuery {
  constructor(
    private readonly mock: SupabaseMock,
    private readonly columns: string,
  ) {}

  eq() {
    return this
  }

  async single() {
    // Return null custom prompts (use defaults)
    return {
      data: {
        chunk_summary_prompt: null,
        meta_summary_prompt: null,
        fact_extraction_prompt: null,
      },
      error: null,
    }
  }
}

class MessagesQuery extends BaseQuery<MessageRow> {
  constructor(mock: SupabaseMock, columns: string) {
    super(() => mock.messages, mapColumns<MessageRow>(columns))
  }

  range(from: number, to: number) {
    const rows = this.materializeRows()
    const slice = rows.slice(from, to + 1)
    return Promise.resolve({
      data: this.projectRows(slice),
      error: null,
    })
  }
}

function makeMessages(total: number, chatId = 'chat-1'): MessageRow[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `msg-${index + 1}`,
    chat_id: chatId,
    sequence: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index + 1}`,
  }))
}

const MODEL = {} as LanguageModel

function createSupabaseMock(messages: MessageRow[]) {
  return new SupabaseMock(messages)
}

describe('updateSummaries integration smoke tests', () => {
  beforeEach(() => {
    generateTextMock.mockReset()
  })

  it('creates the first chunk summary once the threshold is reached', async () => {
    const supabaseMock = createSupabaseMock(makeMessages(CHUNK_SIZE * 2))

    // Mock both summary and facts extraction calls
    generateTextMock.mockResolvedValue(createGenerateTextResult('chunk summary result', 55))

    await updateSummaries({
      supabase: supabaseMock as unknown as ChatSummariesSupabaseClient,
      chatId: 'chat-1',
      userId: 'test-user-id',
      model: MODEL,
      provider: 'google',
      modelName: 'test-model',
    })

    // Expect 2 calls: 1 for summary, 1 for facts
    expect(generateTextMock).toHaveBeenCalledTimes(2)

    const chunkSummaries = supabaseMock.chatSummaries.filter(
      (row) => row.level === SUMMARY_LEVEL_CHUNK,
    )

    expect(chunkSummaries).toHaveLength(1)
    expect(chunkSummaries[0]).toMatchObject({
      start_seq: 1,
      end_seq: 10,
      summary: 'chunk summary result',
      token_count: 55,
    })

    expect(
      supabaseMock.chatSummaries.filter((row) => row.level === SUMMARY_LEVEL_META),
    ).toHaveLength(0)
  })

  it('builds sequential chunk summaries and a meta summary when enough history accumulates', async () => {
    const supabaseMock = createSupabaseMock(makeMessages(CHUNK_SIZE * 12))

    type GenerateTextParams = Parameters<typeof generateText>
    generateTextMock.mockImplementation(async (...args: GenerateTextParams) => {
      const [config] = args
      const prompt =
        typeof config === 'object' && config !== null && 'prompt' in config
          ? String((config as { prompt?: string }).prompt ?? '')
          : ''

      if (prompt.startsWith('Create a concise higher-level summary')) {
        return createGenerateTextResult('meta summary result', 88)
      }
      return createGenerateTextResult('chunk summary result', 44)
    })

    await updateSummaries({
      supabase: supabaseMock as unknown as ChatSummariesSupabaseClient,
      chatId: 'chat-1',
      userId: 'test-user-id',
      model: MODEL,
      provider: 'google',
      modelName: 'test-model',
    })

    const chunkSummaries = supabaseMock.chatSummaries.filter(
      (row) => row.level === SUMMARY_LEVEL_CHUNK,
    )
    expect(chunkSummaries).toHaveLength(11)
    expect(chunkSummaries[0]).toMatchObject({
      start_seq: 1,
      end_seq: 10,
      summary: 'chunk summary result',
      token_count: 44,
    })
    expect(chunkSummaries[10]).toMatchObject({ start_seq: 101, end_seq: 110 })

    const metaSummaries = supabaseMock.chatSummaries.filter(
      (row) => row.level === SUMMARY_LEVEL_META,
    )
    expect(metaSummaries).toHaveLength(1)
    expect(metaSummaries[0]).toMatchObject({
      start_seq: 1,
      end_seq: 100,
      summary: 'meta summary result',
      token_count: 88,
    })
  })

  // NOTE: Super-meta summaries are currently disabled in the active pipeline.
  // The test for 'creates a super meta summary once four meta summaries are available'
  // was removed as the feature is not in use. Re-add when super-meta is re-enabled.

  it('falls back to deterministic highlights when the LLM call fails', async () => {
    const supabaseMock = createSupabaseMock(makeMessages(CHUNK_SIZE * 2))

    // Reject both summary and facts extraction calls
    generateTextMock.mockRejectedValue(new Error('upstream unavailable'))

    await updateSummaries({
      supabase: supabaseMock as unknown as ChatSummariesSupabaseClient,
      chatId: 'chat-1',
      userId: 'test-user-id',
      model: MODEL,
      provider: 'google',
      modelName: 'test-model',
    })

    const [chunk] = supabaseMock.chatSummaries
    expect(chunk.summary).toContain('Summary failed')
    expect(chunk.token_count).toBeNull()
  })
})
