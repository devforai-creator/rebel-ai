import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { buildClientIdentifier } from '@/lib/chat/rate-limiter'
import { CHAT_REQUEST_LIMITS } from '@/lib/chat/runtime-limits'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { getDefaultModelForProvider } from '@/lib/llm/default-model'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const hoistedMocks = vi.hoisted(() => {
  const createClientMock = vi.fn()
  const fetchMock = vi.fn()
  const createAdminClientMock = vi.fn(() => ({}))
  const persistChatJobLifecycleStageMock = vi.fn()
  return {
    createClientMock,
    fetchMock,
    createAdminClientMock,
    persistChatJobLifecycleStageMock,
  }
})

const createClientMock = hoistedMocks.createClientMock
type FetchMock = ReturnType<typeof vi.fn<typeof globalThis.fetch>>
const fetchMock = hoistedMocks.fetchMock as FetchMock
const createAdminClientMock = hoistedMocks.createAdminClientMock
const persistChatJobLifecycleStageMock = hoistedMocks.persistChatJobLifecycleStageMock

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/chat/job-lifecycle-store', () => ({
  persistChatJobLifecycleStage: (...args: Parameters<typeof persistChatJobLifecycleStageMock>) =>
    persistChatJobLifecycleStageMock(...args),
}))

vi.mock('@/lib/chat/translation-trigger', () => ({
  triggerMessageTranslation: vi.fn(),
}))

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return {
    ...actual,
    after: vi.fn((cb: () => void | Promise<void>) => {
      cb()
    }),
  }
})

vi.stubGlobal('fetch', fetchMock)

import { POST } from './route'

const triggerMessageTranslationMock = vi.mocked(triggerMessageTranslation)

interface ApiKeyRow {
  id: string
  user_id: string
  provider: 'google' | 'openai' | 'anthropic' | 'voyage_embeddings'
  is_active: boolean
  vault_secret_name: string
  model_preference: string | null
}

interface ChatRow {
  id: string
  user_id: string
  character_id: string
  max_context_messages: number
}

interface CharacterRow {
  id: string
  system_prompt: string
}

interface MessageRow {
  id: string
  chat_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  turn_id?: string | null
  variant_index?: number | null
  supersedes_message_id?: string | null
  message_status?: string
  model_used?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  error_code?: string | null
}

interface ChatTurnRow {
  id: string
  chat_id: string
  user_id: string
  turn_index: number
  user_message_id: string | null
  active_assistant_message_id: string | null
}

interface GlobalVariableRow {
  chat_id: string
  key: string
  value: unknown
}

interface ChatJobRow {
  id: string
  chat_id: string
  user_id: string
  status: string
  delivery_mode?: string
  lifecycle_stage?: string
  failure_stage?: string | null
  payload: unknown
}

interface SupabaseFixture {
  user: { id: string } | null
  apiKeys: ApiKeyRow[]
  chats: ChatRow[]
  characters: CharacterRow[]
  decryptedSecret?: string
  rateLimit?: {
    allowed: boolean
    retryAfter?: number | null
    error?: { message: string; code?: string | null }
  }
  userRateLimit?: {
    allowed: boolean
    retryAfter?: number | null
    error?: { message: string; code?: string | null }
  }
  anonRateLimit?: {
    allowed: boolean
    retryAfter?: number | null
    error?: { message: string; code?: string | null }
  }
  messages?: Array<{
    id: string
    chat_id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    turn_id?: string | null
    variant_index?: number | null
    supersedes_message_id?: string | null
    message_status?: string
  }>
  chatTurns?: ChatTurnRow[]
  chatJobs?: ChatJobRow[]
  chatSubmissionError?: { message: string; code?: string | null; details?: string | null }
  chatJobInsertError?: { message: string; code?: string | null }
  activeChatJobsError?: { message: string; code?: string | null }
  activeUserJobsError?: { message: string; code?: string | null }
  chatTurnInsertError?: { message: string; code?: string | null }
  chatTurnDeleteError?: { message: string; code?: string | null }
  messageInsertError?: { message: string; code?: string | null }
  messageDeleteError?: { message: string; code?: string | null }
}

async function expectJsonError(
  response: Response,
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
) {
  expect(response.status).toBe(status)
  expect(response.headers.get('content-type')).toContain('application/json')

  const payload = (await response.json()) as Record<string, unknown>
  expect(payload).toMatchObject({
    error,
    ...extra,
  })

  return payload
}

fetchMock.mockImplementation(async (input) => {
  const url =
    typeof input === 'string' || input instanceof URL
      ? new URL(input.toString())
      : new URL(String(input))

  if (url.pathname === '/api/internal/chat-job-runner/trigger') {
    return new Response(JSON.stringify({ triggered: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  throw new Error(`Unexpected fetch call: ${url.toString()}`)
})

class SupabaseRouteMock {
  constructor(fixture: SupabaseFixture) {
    this.fixture = fixture
    if (fixture.messages) {
      this.messages.push(
        ...fixture.messages.map((msg) => ({
          id: msg.id,
          chat_id: msg.chat_id,
          role: msg.role,
          content: msg.content,
          turn_id: msg.turn_id ?? null,
          variant_index: msg.variant_index ?? null,
          supersedes_message_id: msg.supersedes_message_id ?? null,
          message_status: msg.message_status ?? 'completed',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          error_code: null,
        })),
      )
    }
    if (fixture.chatTurns) {
      this.chatTurns.push(...fixture.chatTurns.map((turn) => ({ ...turn })))
    }
    if (fixture.chatJobs) {
      this.chatJobs.push(...fixture.chatJobs.map((job) => ({ ...job })))
    }
  }

  private readonly fixture: SupabaseFixture
  readonly messages: MessageRow[] = []
  readonly chatTurns: ChatTurnRow[] = []
  readonly globalVariables: GlobalVariableRow[] = []
  readonly chatJobs: ChatJobRow[] = []

  auth = {
    getUser: async () => ({
      data: { user: this.fixture.user },
    }),
  }

  from(table: string) {
    switch (table) {
      case 'api_keys':
        return new ApiKeysTable(this.fixture.apiKeys)
      case 'chats':
        return new ChatsTable(this.fixture.chats)
      case 'characters':
        return new CharactersTable(this.fixture.characters)
      case 'messages':
        return new MessagesTable(
          this.messages,
          this.fixture.messageInsertError,
          this.fixture.messageDeleteError,
        )
      case 'chat_turns':
        return new ChatTurnsTable(
          this.chatTurns,
          this.messages,
          this.fixture.chatTurnInsertError,
          this.fixture.chatTurnDeleteError,
        )
      case 'global_variables':
        return new GlobalVariablesTable(this.globalVariables)
      case 'chat_generation_jobs':
        return new ChatGenerationJobsTable(this.chatJobs, {
          insertError: this.fixture.chatJobInsertError,
          activeChatJobsError: this.fixture.activeChatJobsError,
          activeUserJobsError: this.fixture.activeUserJobsError,
        })
      default:
        throw new Error(`Unsupported table: ${table}`)
    }
  }
}

class SupabaseAdminMock {
  constructor(
    private readonly fixture: SupabaseFixture,
    private readonly routeMock: SupabaseRouteMock,
  ) {}

  readonly rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = []

  rpc(name: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ name, params })

    switch (name) {
      case 'check_anon_rate_limit': {
        if (this.fixture.anonRateLimit?.error) {
          return Promise.resolve({
            data: null,
            error: this.fixture.anonRateLimit.error,
          })
        }

        const allowed = this.fixture.anonRateLimit?.allowed ?? true
        const retryAfter =
          this.fixture.anonRateLimit?.retryAfter === null ||
          typeof this.fixture.anonRateLimit?.retryAfter === 'number'
            ? this.fixture.anonRateLimit.retryAfter
            : 0
        const remaining = allowed ? 1 : 0

        return Promise.resolve({
          data: [
            {
              allowed,
              remaining,
              retry_after: retryAfter,
            },
          ],
          error: null,
        })
      }
      case 'get_decrypted_secret': {
        const requester = params.requester
        const expectedUserId = this.fixture.user?.id
        if (!expectedUserId || requester !== expectedUserId) {
          return Promise.resolve({
            data: null,
            error: { message: 'Not authorized' },
          })
        }

        const secret =
          this.fixture.decryptedSecret ?? `decrypted-${String(params.secret_name ?? '')}`

        return Promise.resolve({ data: secret, error: null })
      }
      case 'check_chat_rate_limit': {
        // Use userRateLimit if specified, otherwise fall back to rateLimit
        const rateLimitConfig = this.fixture.userRateLimit ?? this.fixture.rateLimit

        if (rateLimitConfig?.error) {
          return Promise.resolve({
            data: null,
            error: rateLimitConfig.error,
          })
        }

        const allowed = rateLimitConfig?.allowed ?? true
        const retryAfter =
          rateLimitConfig?.retryAfter === null || typeof rateLimitConfig?.retryAfter === 'number'
            ? rateLimitConfig.retryAfter
            : 0
        const remaining = allowed ? 1 : 0

        return Promise.resolve({
          data: [
            {
              allowed,
              remaining,
              retry_after: retryAfter,
            },
          ],
          error: null,
        })
      }
      case 'submit_chat_generation_job': {
        const configuredError = this.fixture.chatSubmissionError ?? this.fixture.chatJobInsertError
        if (configuredError) {
          return Promise.resolve({ data: null, error: configuredError })
        }

        const chatId = String(params.p_chat_id ?? '')
        const requester = String(params.p_requester ?? '')
        const chat = this.fixture.chats.find(
          (candidate) => candidate.id === chatId && candidate.user_id === requester,
        )
        if (!chat) {
          return Promise.resolve({
            data: null,
            error: { code: 'P0002', message: 'Chat not found' },
          })
        }

        const activeJobs = this.routeMock.chatJobs.filter(
          (job) => job.status === 'pending' || job.status === 'processing',
        )
        if (activeJobs.some((job) => job.chat_id === chatId)) {
          return Promise.resolve({
            data: null,
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "chat_generation_jobs_active_chat_idx"',
            },
          })
        }

        if (activeJobs.filter((job) => job.user_id === requester).length >= 3) {
          return Promise.resolve({
            data: null,
            error: {
              code: 'P0001',
              message: 'User already has 3 active chat generation jobs',
            },
          })
        }

        const isRegeneration = params.p_is_regeneration === true
        let turnId: string
        let userMessageId: string | null = null

        if (isRegeneration) {
          const regenerateAssistantMessageId = String(
            params.p_regenerate_assistant_message_id ?? '',
          )
          const targetTurn = this.routeMock.chatTurns.find(
            (turn) =>
              turn.chat_id === chatId &&
              turn.active_assistant_message_id === regenerateAssistantMessageId,
          )
          if (!targetTurn) {
            return Promise.resolve({
              data: null,
              error: { code: '22023', message: 'Invalid regeneration target' },
            })
          }

          const latestTurn = this.routeMock.chatTurns
            .filter((turn) => turn.chat_id === chatId)
            .sort((left, right) => right.turn_index - left.turn_index)[0]
          if (latestTurn?.id !== targetTurn.id) {
            return Promise.resolve({
              data: null,
              error: {
                code: '22023',
                message: 'Only the latest assistant message can be regenerated',
              },
            })
          }

          turnId = targetTurn.id
        } else {
          if (this.fixture.chatTurnInsertError) {
            return Promise.resolve({ data: null, error: this.fixture.chatTurnInsertError })
          }
          if (this.fixture.messageInsertError) {
            return Promise.resolve({ data: null, error: this.fixture.messageInsertError })
          }

          turnId = String(params.p_turn_id ?? '')
          userMessageId = String(params.p_user_message_id ?? '')
          const nextTurnIndex =
            Math.max(
              0,
              ...this.routeMock.chatTurns
                .filter((turn) => turn.chat_id === chatId)
                .map((turn) => turn.turn_index),
            ) + 1

          this.routeMock.chatTurns.push({
            id: turnId,
            chat_id: chatId,
            user_id: requester,
            turn_index: nextTurnIndex,
            user_message_id: userMessageId,
            active_assistant_message_id: null,
          })
          this.routeMock.messages.push({
            id: userMessageId,
            chat_id: chatId,
            role: 'user',
            content: String(params.p_user_message_content ?? ''),
            turn_id: turnId,
            variant_index: null,
            supersedes_message_id: null,
            message_status: 'completed',
            model_used: null,
            prompt_tokens: null,
            completion_tokens: null,
            error_code: null,
          })
        }

        const payload = {
          ...((params.p_job_payload as Record<string, unknown>) ?? {}),
          turnId,
        }
        const jobId = `job-${this.routeMock.chatJobs.length + 1}`
        this.routeMock.chatJobs.push({
          id: jobId,
          chat_id: chatId,
          user_id: requester,
          status: 'pending',
          delivery_mode: String(params.p_delivery_mode ?? ''),
          lifecycle_stage: 'queued',
          failure_stage: null,
          payload,
        })

        return Promise.resolve({
          data: [{ job_id: jobId, turn_id: turnId, user_message_id: userMessageId }],
          error: null,
        })
      }
      default:
        throw new Error(`Unsupported admin RPC: ${name}`)
    }
  }
}

type Predicate<T> = (row: T) => boolean

class ApiKeysTable {
  constructor(private readonly rows: ApiKeyRow[]) {}

  select() {
    const filters: Predicate<ApiKeyRow>[] = []
    const builder = {
      eq: (field: keyof ApiKeyRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      single: async () => {
        const row = this.rows.find((candidate) =>
          filters.every((predicate) => predicate(candidate)),
        )
        if (!row) {
          return { data: null, error: { message: 'Not found' } }
        }
        return { data: { ...row }, error: null }
      },
    }
    return builder
  }

  update(values: Partial<ApiKeyRow>) {
    const filters: Predicate<ApiKeyRow>[] = []
    const builder = {
      eq: (field: keyof ApiKeyRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: ApiKeyRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        const targets = this.rows.filter((candidate) =>
          filters.every((predicate) => predicate(candidate)),
        )
        targets.forEach((row) => Object.assign(row, values))
        return Promise.resolve({ data: targets, error: null }).then(onfulfilled, onrejected)
      },
    }
    return builder
  }
}

class ChatsTable {
  constructor(private readonly rows: ChatRow[]) {}

  select() {
    const filters: Predicate<ChatRow>[] = []
    const builder = {
      eq: (field: keyof ChatRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      single: async () => {
        const row = this.rows.find((candidate) =>
          filters.every((predicate) => predicate(candidate)),
        )
        if (!row) {
          return { data: null, error: { message: 'Not found' } }
        }
        return { data: { ...row }, error: null }
      },
    }
    return builder
  }
}

class CharactersTable {
  constructor(private readonly rows: CharacterRow[]) {}

  select() {
    const filters: Predicate<CharacterRow>[] = []
    const builder = {
      eq: (field: keyof CharacterRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      single: async () => {
        const row = this.rows.find((candidate) =>
          filters.every((predicate) => predicate(candidate)),
        )
        if (!row) {
          return { data: null, error: { message: 'Not found' } }
        }
        return { data: { ...row }, error: null }
      },
    }
    return builder
  }
}

class MessagesTable {
  constructor(
    private readonly rows: MessageRow[],
    private readonly insertError?: { message: string; code?: string | null },
    private readonly deleteError?: { message: string; code?: string | null },
  ) {}

  select() {
    const filters: Predicate<MessageRow>[] = []
    const builder = {
      eq: (field: keyof MessageRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      single: async () => {
        const row = this.rows.find((candidate) =>
          filters.every((predicate) => predicate(candidate)),
        )
        if (!row) {
          return { data: null, error: { message: 'Not found' } }
        }
        return { data: { ...row }, error: null }
      },
    }
    return builder
  }

  delete() {
    const filters: Predicate<MessageRow>[] = []
    const builder = {
      eq: (field: keyof MessageRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: {
              data: MessageRow[]
              error: { message: string; code?: string | null } | null
            }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        if (this.deleteError) {
          return Promise.resolve({ data: [], error: this.deleteError }).then(
            onfulfilled,
            onrejected,
          )
        }

        const remaining = this.rows.filter((row) => !filters.every((predicate) => predicate(row)))
        this.rows.length = 0
        this.rows.push(...remaining)
        return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  insert(payload: Omit<MessageRow, 'id'> | Array<Omit<MessageRow, 'id'>>) {
    if (this.insertError) {
      return {
        select: (_columns?: string) => {
          void _columns
          return {
            single: async () => ({
              data: null,
              error: this.insertError,
            }),
          }
        },
      }
    }

    const records = Array.isArray(payload) ? payload : [payload]
    const insertedRows: MessageRow[] = []
    records.forEach((record) => {
      const newRow: MessageRow = {
        id:
          ('id' in record && typeof record.id === 'string' ? record.id : null) ??
          `msg-${this.rows.length + 1}`,
        chat_id: record.chat_id,
        role: record.role,
        content: record.content,
        turn_id: record.turn_id ?? null,
        variant_index: record.variant_index ?? null,
        supersedes_message_id: record.supersedes_message_id ?? null,
        message_status: record.message_status ?? 'completed',
        model_used: record.model_used ?? null,
        prompt_tokens: record.prompt_tokens ?? null,
        completion_tokens: record.completion_tokens ?? null,
        error_code: record.error_code ?? null,
      }
      this.rows.push(newRow)
      insertedRows.push(newRow)
    })

    // Return chainable builder for .select().single() pattern
    return {
      select: (_columns?: string) => {
        void _columns
        return {
          single: async () => ({
            data: insertedRows[0] ?? null,
            error: null,
          }),
        }
      },
      then: <T>(onfulfilled?: (value: { data: MessageRow[]; error: null }) => T) =>
        Promise.resolve({ data: insertedRows, error: null as null }).then(onfulfilled),
    }
  }
}

class ChatTurnsTable {
  constructor(
    private readonly rows: ChatTurnRow[],
    private readonly messages: MessageRow[],
    private readonly insertError?: { message: string; code?: string | null },
    private readonly deleteError?: { message: string; code?: string | null },
  ) {}

  select() {
    const filters: Predicate<ChatTurnRow>[] = []
    let limitCount: number | null = null
    let orderField: keyof ChatTurnRow | null = null
    let ascending = true

    const builder = {
      eq: (field: keyof ChatTurnRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      order: (field: keyof ChatTurnRow, options?: { ascending?: boolean }) => {
        orderField = field
        ascending = options?.ascending ?? true
        return builder
      },
      limit: (value: number) => {
        limitCount = value
        return builder
      },
      single: async () => {
        const rows = this.resolveRows(filters, orderField, ascending, limitCount)
        const row = rows[0]
        if (!row) {
          return { data: null, error: { message: 'Not found' } }
        }
        return { data: { ...row }, error: null }
      },
      maybeSingle: async () => {
        const rows = this.resolveRows(filters, orderField, ascending, limitCount)
        const row = rows[0]
        return { data: row ? { ...row } : null, error: null }
      },
    }

    return builder
  }

  insert(payload: Omit<ChatTurnRow, 'id'> | Array<Omit<ChatTurnRow, 'id'>>) {
    if (this.insertError) {
      return {
        select: (_columns?: string) => {
          void _columns
          return {
            single: async () => ({
              data: null,
              error: this.insertError,
            }),
          }
        },
      }
    }

    const records = Array.isArray(payload) ? payload : [payload]
    const insertedRows: ChatTurnRow[] = []

    for (const record of records) {
      const newRow: ChatTurnRow = {
        id:
          ('id' in record && typeof record.id === 'string' ? record.id : null) ??
          `turn-${this.rows.length + 1}`,
        chat_id: record.chat_id,
        user_id: record.user_id,
        turn_index: record.turn_index,
        user_message_id: record.user_message_id ?? null,
        active_assistant_message_id: record.active_assistant_message_id ?? null,
      }
      this.rows.push(newRow)
      insertedRows.push(newRow)
    }

    return {
      select: (_columns?: string) => {
        void _columns
        return {
          single: async () => ({
            data: insertedRows[0] ?? null,
            error: null,
          }),
        }
      },
      then: <T>(onfulfilled?: (value: { data: ChatTurnRow[]; error: null }) => T) =>
        Promise.resolve({ data: insertedRows, error: null as null }).then(onfulfilled),
    }
  }

  delete() {
    const filters: Predicate<ChatTurnRow>[] = []
    const builder = {
      eq: (field: keyof ChatTurnRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: {
              data: ChatTurnRow[]
              error: { message: string; code?: string | null } | null
            }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        if (this.deleteError) {
          return Promise.resolve({ data: [], error: this.deleteError }).then(
            onfulfilled,
            onrejected,
          )
        }

        const removed = this.rows.filter((row) => filters.every((predicate) => predicate(row)))
        const removedIds = new Set(removed.map((row) => row.id))
        const remaining = this.rows.filter((row) => !removedIds.has(row.id))
        this.rows.length = 0
        this.rows.push(...remaining)

        const remainingMessages = this.messages.filter((row) => !removedIds.has(row.turn_id ?? ''))
        this.messages.length = 0
        this.messages.push(...remainingMessages)

        return Promise.resolve({ data: removed, error: null }).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  private resolveRows(
    filters: Predicate<ChatTurnRow>[],
    orderField: keyof ChatTurnRow | null,
    ascending: boolean,
    limitCount: number | null,
  ) {
    let rows = this.rows.filter((row) => filters.every((predicate) => predicate(row)))
    if (orderField) {
      rows = rows.slice().sort((left, right) => {
        const leftValue = left[orderField]
        const rightValue = right[orderField]
        if (leftValue === rightValue) return 0
        if (leftValue === undefined || leftValue === null) return ascending ? 1 : -1
        if (rightValue === undefined || rightValue === null) return ascending ? -1 : 1
        if (leftValue > rightValue) return ascending ? 1 : -1
        return ascending ? -1 : 1
      })
    }
    if (typeof limitCount === 'number') {
      rows = rows.slice(0, limitCount)
    }
    return rows
  }
}

class GlobalVariablesTable {
  constructor(private readonly rows: GlobalVariableRow[]) {}

  select() {
    const filters: Predicate<GlobalVariableRow>[] = []
    const builder = {
      eq: (field: keyof GlobalVariableRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: {
              data: GlobalVariableRow[]
              error: null
            }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        const results = this.rows.filter((row) => filters.every((predicate) => predicate(row)))
        return Promise.resolve({ data: results, error: null }).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  async insert(payload: GlobalVariableRow | GlobalVariableRow[]) {
    const records = Array.isArray(payload) ? payload : [payload]
    this.rows.push(...records)
    return { data: records, error: null }
  }
}

function createSupabaseMock(fixture: SupabaseFixture): SupabaseRouteMock & {
  adminRpcCalls: Array<{ name: string; params: Record<string, unknown> }>
} {
  const routeMock = new SupabaseRouteMock(fixture)
  const adminMock = new SupabaseAdminMock(fixture, routeMock)
  createClientMock.mockReturnValue(routeMock)
  createAdminClientMock.mockReturnValue(adminMock)
  ;(
    routeMock as SupabaseRouteMock & {
      adminRpcCalls: Array<{ name: string; params: Record<string, unknown> }>
    }
  ).adminRpcCalls = adminMock.rpcCalls
  return routeMock as SupabaseRouteMock & {
    adminRpcCalls: Array<{ name: string; params: Record<string, unknown> }>
  }
}

function getFetchUrl(input: Parameters<FetchMock>[0]): URL {
  if (typeof input === 'string' || input instanceof URL) {
    return new URL(input.toString())
  }

  return new URL(input.url)
}

function findFetchCallByPathname(pathname: string): Parameters<FetchMock> | undefined {
  return fetchMock.mock.calls.find(([input]) => getFetchUrl(input).pathname === pathname)
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

function createStreamingJsonRequest({
  chunks,
  headers = {},
}: {
  chunks: string[]
  headers?: Record<string, string>
}) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })

  return new Request('http://localhost/api/chat', {
    method: 'POST',
    body: stream,
    duplex: 'half',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  } as RequestInit)
}

function buildDefaultAuthenticatedFixture(
  overrides: Partial<SupabaseFixture> = {},
): SupabaseFixture {
  return {
    user: { id: 'user-1' },
    apiKeys: [
      {
        id: 'api-key-1',
        user_id: 'user-1',
        provider: 'google',
        is_active: true,
        vault_secret_name: 'secret-key',
        model_preference: 'gemini-2.5-flash',
      },
    ],
    chats: [
      {
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'character-1',
        max_context_messages: 20,
      },
    ],
    characters: [
      {
        id: 'character-1',
        system_prompt: 'character system prompt',
      },
    ],
    userRateLimit: {
      allowed: true,
    },
    ...overrides,
  }
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    process.env.CHAT_ADMIN_SECRET = 'test-chat-admin-secret'
    createClientMock.mockReset()
    createAdminClientMock.mockReset()
    createAdminClientMock.mockReturnValue({})
    fetchMock.mockClear()
    persistChatJobLifecycleStageMock.mockReset()
    triggerMessageTranslationMock.mockReset()
    triggerMessageTranslationMock.mockImplementation(() => undefined)
    global.fetch = fetchMock as typeof global.fetch
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 400 for malformed JSON request bodies', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: '{ invalid-json',
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'Invalid request body')
  })

  it('returns 400 when chatId is invalid', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 123,
        apiKeyId: 'api-key-1',
        userMessage: 'hello',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'Invalid chatId')
  })

  it('returns 400 when apiKeyId is invalid', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: '',
        userMessage: 'hello',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'Invalid apiKeyId')
  })

  it('returns 400 when a legacy transcript payload is provided', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        messages: [{ role: 'user', content: 'legacy hello' }],
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'messages transcript payload is no longer supported')
  })

  it('returns 400 when unexpected request fields are provided', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'hello',
        debugTranscript: ['nope'],
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'Invalid request body')
  })

  it('returns 400 when clientMessageId is not a UUID', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'hello',
        clientMessageId: 'not-a-uuid',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'Invalid clientMessageId')
  })

  it('returns 400 when userMessage exceeds the byte-size limit', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'a'.repeat(CHAT_REQUEST_LIMITS.maxMessageBytes + 1),
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'Message exceeds allowed size')
  })

  it('returns 400 when userMessage is missing for non-regeneration requests', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'userMessage is required')
  })

  it('accepts the slim userMessage request path without requiring transcript messages', async () => {
    const supabase = createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'hello from userMessage',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)

    expect(supabase.messages).toHaveLength(1)
    expect(supabase.messages[0]).toMatchObject({
      role: 'user',
      content: 'hello from userMessage',
    })

    expect(supabase.chatJobs).toHaveLength(1)
    expect(supabase.chatJobs[0].payload).toMatchObject({
      sanitizedMessages: [
        {
          role: 'user',
          content: 'hello from userMessage',
          messageId: supabase.messages[0].id,
        },
      ],
      isRegeneration: false,
      regenerateAssistantMessageId: null,
    })
  })

  it('returns 401 for anonymous users when the rate limit allows the request', async () => {
    createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: true,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-anon',
        apiKeyId: 'anon-key',
        userMessage: 'hello',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('returns 401 for anonymous users before attempting to parse an invalid body', async () => {
    createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: true,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: '{',
      headers: {
        'content-type': 'application/json',
      },
    })

    const response = await POST(request)
    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('prefers trusted deployment headers for anonymous rate limiting by default', async () => {
    const supabase = createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: true,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-anon',
        apiKeyId: 'anon-key',
        userMessage: 'hello',
      }),
      headers: {
        'x-vercel-ip': '203.0.113.10',
        'cf-connecting-ip': '203.0.113.11',
        'x-real-ip': '10.0.0.8',
        'x-forwarded-for': '198.51.100.5, 10.0.0.2',
      },
    })

    await POST(request)

    const rateLimitCall = supabase.adminRpcCalls.find(
      (call) => call.name === 'check_anon_rate_limit',
    )

    expect(rateLimitCall?.params.identifier).toBe(buildClientIdentifier('203.0.113.10'))
  })

  it('ignores x-real-ip and x-forwarded-for unless proxy trust is explicitly enabled', async () => {
    const supabase = createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: true,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-anon',
        apiKeyId: 'anon-key',
        userMessage: 'hello',
      }),
      headers: {
        'x-real-ip': '10.0.0.8',
        'x-forwarded-for': '198.51.100.5, 10.0.0.2',
        'user-agent': 'VitestAgent/1.0',
        'accept-language': 'ko-KR',
      },
    })

    await POST(request)

    const rateLimitCall = supabase.adminRpcCalls.find(
      (call) => call.name === 'check_anon_rate_limit',
    )

    expect(rateLimitCall?.params.identifier).toBe(
      buildClientIdentifier(buildClientIdentifier('VitestAgent/1.0|ko-KR')),
    )
  })

  it('uses trusted proxy headers when TRUST_PROXY_IP_HEADERS=true', async () => {
    process.env.TRUST_PROXY_IP_HEADERS = 'true'

    const supabase = createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: true,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-anon',
        apiKeyId: 'anon-key',
        userMessage: 'hello',
      }),
      headers: {
        'x-real-ip': '10.0.0.8',
        'x-forwarded-for': '198.51.100.5, 10.0.0.2',
      },
    })

    await POST(request)

    const rateLimitCall = supabase.adminRpcCalls.find(
      (call) => call.name === 'check_anon_rate_limit',
    )

    expect(rateLimitCall?.params.identifier).toBe(buildClientIdentifier('198.51.100.5'))
  })

  it('falls back to hashed user-agent fingerprint when no valid IP headers exist', async () => {
    const supabase = createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: true,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-anon',
        apiKeyId: 'anon-key',
        userMessage: 'hello',
      }),
      headers: {
        'x-real-ip': '   ',
        'x-forwarded-for': ' , ',
        'user-agent': 'VitestAgent/1.0',
        'accept-language': 'ko-KR',
      },
    })

    await POST(request)

    const rateLimitCall = supabase.adminRpcCalls.find(
      (call) => call.name === 'check_anon_rate_limit',
    )

    expect(rateLimitCall?.params.identifier).toBe(
      buildClientIdentifier(buildClientIdentifier('VitestAgent/1.0|ko-KR')),
    )
  })

  it('returns 429 when anonymous rate limit is exceeded', async () => {
    createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: false,
        retryAfter: 17,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-anon',
        apiKeyId: 'anon-key',
        userMessage: 'hello',
      }),
    })

    const response = await POST(request)
    expect(response.headers.get('Retry-After')).toBe('17')
    await expectJsonError(response, 429, 'Too many requests', {
      retryAfter: 17,
    })
  })

  it('rejects oversized declared request bodies before auth or JSON parsing', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: '{}',
      headers: {
        'content-length': String(CHAT_REQUEST_LIMITS.maxRequestBodyBytes + 1),
        'content-type': 'application/json',
      },
    })

    const response = await POST(request)

    await expectJsonError(response, 413, 'Request body exceeds allowed size')
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects oversized streamed request bodies even when content-length stays under the limit', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const prefix = '{"chatId":"chat-1","apiKeyId":"api-key-1","userMessage":"hello","padding":"'
    const suffix = '"}'
    const paddingBytes =
      CHAT_REQUEST_LIMITS.maxRequestBodyBytes - new TextEncoder().encode(prefix + suffix).length + 1

    const request = createStreamingJsonRequest({
      chunks: [prefix, 'x'.repeat(paddingBytes), suffix],
      headers: {
        'content-length': '64',
      },
    })

    const response = await POST(request)

    await expectJsonError(response, 413, 'Request body exceeds allowed size')
  })

  it('returns 500 when anonymous rate limiter RPC fails', async () => {
    createSupabaseMock({
      user: null,
      apiKeys: [],
      chats: [],
      characters: [],
      anonRateLimit: {
        allowed: true,
        error: { message: 'db down', code: 'XX001' },
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-anon',
        apiKeyId: 'anon-key',
        userMessage: 'hello',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 500, 'Internal server error')
  })

  it('enforces chat ownership and returns 404 when chat is missing', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: 'gemini-2.5-flash',
        },
      ],
      chats: [
        {
          id: 'chat-other',
          user_id: 'user-2',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'base prompt',
        },
      ],
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: '안녕',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 404, 'Chat not found')
  })

  it('returns 404 when API key is missing or inactive', async () => {
    createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        apiKeys: [],
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'missing-key',
        userMessage: 'hello',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 404, 'API key not found or inactive')
  })

  it('rejects embedding-only providers before persisting messages or enqueuing jobs', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'voyage_embeddings',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: null,
        },
      ],
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'character system prompt',
        },
      ],
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: '안녕',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 400, 'Unsupported provider')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('persists the user message and enqueues a chat generation job for valid requests', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: 'gemini-2.5-flash',
        },
      ],
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'character system prompt',
        },
      ],
      userRateLimit: {
        allowed: true,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: '최신 질문',
        clientMessageId: '11111111-1111-4111-8111-111111111111',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)
    const body = (await response.json()) as {
      jobId: string
      requestId: string
      userMessageId: string | null
    }
    expect(body.jobId).toBeDefined()
    expect(body.requestId).toBeDefined()
    expect(body.userMessageId).toBe('11111111-1111-4111-8111-111111111111')

    expect(supabase.messages).toHaveLength(1)
    expect(supabase.messages[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'user',
      content: '최신 질문',
    })
    expect(supabase.chatJobs).toHaveLength(1)
    expect(supabase.chatJobs[0]).toMatchObject({
      chat_id: 'chat-1',
      user_id: 'user-1',
      status: 'pending',
      delivery_mode: 'streaming',
      lifecycle_stage: 'queued',
      failure_stage: null,
    })
    const payload = supabase.chatJobs[0].payload as Record<string, unknown>
    expect(payload).toMatchObject({
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'api-key-1',
      provider: 'google',
      modelName: 'gemini-2.5-flash',
      deliveryMode: 'streaming',
      isRegeneration: false,
    })
    expect(triggerMessageTranslationMock).toHaveBeenCalledWith(supabase.messages[0].id, 'user-1')
    expect(persistChatJobLifecycleStageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: body.jobId,
        stage: 'dispatching_runner_trigger',
        additionalUpdate: { failure_stage: null },
      }),
    )
    expect(persistChatJobLifecycleStageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: body.jobId,
        stage: 'trigger_dispatched',
        additionalUpdate: { failure_stage: null },
      }),
    )
  })

  it('reuses one provider credential with an explicitly selected model', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        apiKeys: [
          {
            id: 'api-key-1',
            user_id: 'user-1',
            provider: 'google',
            is_active: true,
            vault_secret_name: 'secret-key',
            model_preference: 'gemini-2.5-flash',
          },
        ],
      }),
    )

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          chatId: 'chat-1',
          apiKeyId: 'api-key-1',
          modelName: 'gemini-3.5-flash',
          userMessage: 'use another Google model',
        }),
      }),
    )

    expect(response.status).toBe(202)
    expect(supabase.chatJobs).toHaveLength(1)
    expect(supabase.chatJobs[0].payload).toMatchObject({
      apiKeyId: 'api-key-1',
      provider: 'google',
      modelName: 'gemini-3.5-flash',
    })
  })

  it('rejects a model that belongs to a different provider', async () => {
    const supabase = createSupabaseMock(buildDefaultAuthenticatedFixture())

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          chatId: 'chat-1',
          apiKeyId: 'api-key-1',
          modelName: 'gpt-5.5',
          userMessage: 'do not cross providers',
        }),
      }),
    )

    await expectJsonError(response, 400, 'Unsupported model for provider')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('dispatches the chat job runner trigger with the expected internal URL and auth headers', async () => {
    process.env.INTERNAL_API_ORIGIN = 'https://internal.example.com'
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'vercel-bypass-secret'

    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'trigger the runner',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(202)
    await flushMicrotasks()

    const runnerTriggerCall = findFetchCallByPathname('/api/internal/chat-job-runner/trigger')

    expect(runnerTriggerCall).toBeDefined()

    const [input, init] = runnerTriggerCall!
    const headers = new Headers(init?.headers)

    expect(getFetchUrl(input).toString()).toBe(
      'https://internal.example.com/api/internal/chat-job-runner/trigger',
    )
    expect(init?.method).toBe('GET')
    expect(headers.get('authorization')).toBe('Bearer test-chat-admin-secret')
    expect(headers.get('x-vercel-protection-bypass')).toBe('vercel-bypass-secret')
  })

  it('still returns 202 when the translation trigger throws synchronously', async () => {
    triggerMessageTranslationMock.mockImplementation(() => {
      throw new Error('translation trigger escaped')
    })
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'keep chat acceptance stable',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(202)
    await flushMicrotasks()

    expect(triggerMessageTranslationMock).toHaveBeenCalled()
    expect(findFetchCallByPathname('/api/internal/chat-job-runner/trigger')).toBeDefined()
  })

  it('enqueues Anthropic Batch mode for supported Anthropic keys', async () => {
    process.env.ANTHROPIC_BATCH_CHAT_ENABLED = 'true'
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        apiKeys: [
          {
            id: 'api-key-1',
            user_id: 'user-1',
            provider: 'anthropic',
            is_active: true,
            vault_secret_name: 'secret-key',
            model_preference: 'claude-sonnet-5',
          },
        ],
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        deliveryMode: 'anthropic_batch',
        userMessage: 'batch please',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)
    expect(supabase.chatJobs).toHaveLength(1)
    expect(supabase.chatJobs[0]).toMatchObject({
      status: 'pending',
      delivery_mode: 'anthropic_batch',
    })
    expect(supabase.chatJobs[0].payload).toMatchObject({
      provider: 'anthropic',
      modelName: 'claude-sonnet-5',
      deliveryMode: 'anthropic_batch',
    })
  })

  it('rejects Anthropic Batch mode when the deployment keeps it disabled', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        apiKeys: [
          {
            id: 'api-key-1',
            user_id: 'user-1',
            provider: 'anthropic',
            is_active: true,
            vault_secret_name: 'secret-key',
            model_preference: 'claude-opus-4-5',
          },
        ],
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        deliveryMode: 'anthropic_batch',
        userMessage: 'batch please',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 400, 'Claude Batch mode is disabled for this deployment')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('rejects Anthropic Batch mode for unsupported keys', async () => {
    process.env.ANTHROPIC_BATCH_CHAT_ENABLED = 'true'
    const supabase = createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        deliveryMode: 'anthropic_batch',
        userMessage: 'batch please',
      }),
    })

    const response = await POST(request)
    await expectJsonError(
      response,
      400,
      'Claude Batch mode is only supported for selected Anthropic models',
    )
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('returns 409 when the chat already has an active generation job', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        chatJobs: [
          {
            id: 'job-1',
            chat_id: 'chat-1',
            user_id: 'user-1',
            status: 'pending',
            payload: {},
          },
        ],
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'blocked',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 409, 'This chat already has a pending or in-progress response.')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(1)
  })

  it('returns 500 when the atomic submission RPC fails', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        chatSubmissionError: {
          message: 'atomic submission failed',
          code: 'XX001',
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'fail atomically',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 500, 'Failed to queue chat response')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatTurns).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('returns 429 when the user already has too many active chat jobs', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        chatJobs: [
          { id: 'job-1', chat_id: 'chat-a', user_id: 'user-1', status: 'pending', payload: {} },
          { id: 'job-2', chat_id: 'chat-b', user_id: 'user-1', status: 'processing', payload: {} },
          { id: 'job-3', chat_id: 'chat-c', user_id: 'user-1', status: 'pending', payload: {} },
        ],
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'too many queues',
      }),
    })

    const response = await POST(request)

    await expectJsonError(
      response,
      429,
      'You already have 3 active chat responses. Wait for one to finish before sending another message.',
    )
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(3)
  })

  it('returns 409 without persisting chat data when atomic admission hits an active-job race', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        chatJobInsertError: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "chat_generation_jobs_active_chat_idx"',
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'race me',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 409, 'This chat already has a pending or in-progress response.')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('returns 429 when enqueuing hits the active-user limit race', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        chatJobInsertError: {
          code: 'P0001',
          message: 'active chat generation jobs limit exceeded',
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'race me too',
      }),
    })

    const response = await POST(request)

    await expectJsonError(
      response,
      429,
      'You already have 3 active chat responses. Wait for one to finish before sending another message.',
    )
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('falls back to provider default model when API key has no model_preference', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        apiKeys: [
          {
            id: 'api-key-1',
            user_id: 'user-1',
            provider: 'openai',
            is_active: true,
            vault_secret_name: 'secret-key',
            model_preference: null,
          },
        ],
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'use default model',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)

    const payload = supabase.chatJobs[0].payload as Record<string, unknown>
    expect(payload.modelName).toBe(getDefaultModelForProvider('openai'))
  })

  it('returns 429 when user rate limit is exceeded', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: 'gemini-2.5-flash',
        },
      ],
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'character system prompt',
        },
      ],
      rateLimit: {
        allowed: false,
        retryAfter: 12,
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'rate limit me',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 429, 'Rate limit exceeded', {
      retryAfter: 12,
    })
  })

  it('returns 429 for rate-limited users before attempting to parse an invalid body', async () => {
    createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        userRateLimit: {
          allowed: false,
          retryAfter: 15,
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: '{',
      headers: {
        'content-type': 'application/json',
      },
    })

    const response = await POST(request)

    expect(response.headers.get('Retry-After')).toBe('15')
    await expectJsonError(response, 429, 'Rate limit exceeded', {
      retryAfter: 15,
    })
  })

  it('uses Retry-After=60 when user rate limit response has null retryAfter', async () => {
    createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        userRateLimit: {
          allowed: false,
          retryAfter: null,
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'rate limit me',
      }),
    })

    const response = await POST(request)
    expect(response.headers.get('Retry-After')).toBe('60')
    await expectJsonError(response, 429, 'Rate limit exceeded', {
      retryAfter: 60,
    })
  })

  it('fails with 500 when rate limiter RPC errors', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: 'gemini-2.5-flash',
        },
      ],
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'character system prompt',
        },
      ],
      userRateLimit: {
        allowed: true,
        error: { message: 'db down', code: 'XX001' },
      },
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'hello',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 500, 'Internal server error')
  })

  it('validates the target assistant message and enqueues a regeneration job', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: 'gemini-2.5-flash',
        },
      ],
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'character system prompt',
        },
      ],
      userRateLimit: {
        allowed: true,
      },
      messages: [
        {
          id: 'assistant-1',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'old reply',
        },
      ],
      chatTurns: [
        {
          id: 'turn-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          turn_index: 1,
          user_message_id: 'user-1-msg',
          active_assistant_message_id: 'assistant-1',
        },
      ],
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)

    expect(supabase.messages).toHaveLength(1)
    expect(supabase.messages[0].id).toBe('assistant-1')
    expect(supabase.chatJobs).toHaveLength(1)
    expect(supabase.chatJobs[0].payload).toMatchObject({
      isRegeneration: true,
      regenerateAssistantMessageId: 'assistant-1',
    })
  })

  it('accepts regeneration requests without a client transcript payload', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: 'gemini-2.5-flash',
        },
      ],
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'character system prompt',
        },
      ],
      userRateLimit: {
        allowed: true,
      },
      messages: [
        {
          id: 'assistant-1',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'old reply',
        },
      ],
      chatTurns: [
        {
          id: 'turn-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          turn_index: 1,
          user_message_id: 'user-1-msg',
          active_assistant_message_id: 'assistant-1',
        },
      ],
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)

    expect(supabase.chatJobs).toHaveLength(1)
    expect(supabase.chatJobs[0].payload).toMatchObject({
      isRegeneration: true,
      regenerateAssistantMessageId: 'assistant-1',
      sanitizedMessages: [],
    })
  })

  it('rejects regeneration requests that still include a userMessage payload', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
        userMessage: 'retry please',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'userMessage is not allowed for regeneration')
  })

  it('rejects clientMessageId on regeneration requests', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
        clientMessageId: '11111111-1111-4111-8111-111111111111',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'clientMessageId is not allowed for regeneration')
  })

  it('returns 400 when regeneration targets a non-latest assistant turn', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          is_active: true,
          vault_secret_name: 'secret-key',
          model_preference: 'gemini-2.5-flash',
        },
      ],
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'character-1',
          max_context_messages: 20,
        },
      ],
      characters: [
        {
          id: 'character-1',
          system_prompt: 'character system prompt',
        },
      ],
      chatTurns: [
        {
          id: 'turn-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          turn_index: 1,
          user_message_id: 'user-1-msg',
          active_assistant_message_id: 'assistant-1',
        },
        {
          id: 'turn-2',
          chat_id: 'chat-1',
          user_id: 'user-1',
          turn_index: 2,
          user_message_id: 'user-2-msg',
          active_assistant_message_id: 'assistant-2',
        },
      ],
    })

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 400, 'Only the latest assistant message can be regenerated')
  })

  it('returns 500 without partial data when creating the chat turn fails in the RPC', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        chatTurnInsertError: {
          message: 'failed to insert turn',
          code: 'XX001',
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'create turn please',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 500, 'Failed to queue chat response')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatTurns).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('does not misclassify an unrelated unique violation as an active-job conflict', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        chatTurnInsertError: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "chat_turns_chat_id_turn_index_key"',
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'collide please',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 500, 'Failed to queue chat response')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatTurns).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('returns 500 without partial data when saving the user message fails in the RPC', async () => {
    const supabase = createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        messageInsertError: {
          message: 'failed to insert message',
          code: 'XX001',
        },
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        userMessage: 'persist me',
      }),
    })

    const response = await POST(request)

    await expectJsonError(response, 500, 'Failed to queue chat response')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatTurns).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(0)
  })

  it('returns 400 when regeneration target is missing or not an assistant message', async () => {
    createSupabaseMock(
      buildDefaultAuthenticatedFixture({
        messages: [
          {
            id: 'user-msg-1',
            chat_id: 'chat-1',
            role: 'user',
            content: 'not an assistant message',
          },
        ],
      }),
    )

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        isRegeneration: true,
        regenerateAssistantMessageId: 'user-msg-1',
      }),
    })

    const response = await POST(request)
    await expectJsonError(response, 400, 'Invalid regeneration target')
  })
})

describe('Security: Runtime Configuration', () => {
  it('must use nodejs runtime to prevent CHAT_ADMIN_SECRET exposure', () => {
    const routePath = resolve(__dirname, './route.ts')
    const content = readFileSync(routePath, 'utf-8')

    expect(content).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/)
    expect(content).not.toMatch(/export\s+const\s+runtime\s*=\s*['"]edge['"]/)
  })
})
class ChatGenerationJobsTable {
  constructor(
    private readonly rows: ChatJobRow[],
    private readonly errors: {
      insertError?: { message: string; code?: string | null }
      activeChatJobsError?: { message: string; code?: string | null }
      activeUserJobsError?: { message: string; code?: string | null }
    } = {},
  ) {}

  select() {
    const filters: Predicate<ChatJobRow>[] = []
    const filterFields = new Set<keyof ChatJobRow>()
    let limitCount: number | null = null
    const builder = {
      eq: (field: keyof ChatJobRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        filterFields.add(field)
        return builder
      },
      in: (field: keyof ChatJobRow, values: unknown[]) => {
        filters.push((row) => values.includes(row[field]))
        filterFields.add(field)
        return builder
      },
      limit: (value: number) => {
        limitCount = value
        return builder
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: {
              data: ChatJobRow[] | null
              error: { message: string; code?: string | null } | null
            }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        if (filterFields.has('chat_id') && this.errors.activeChatJobsError) {
          return Promise.resolve({
            data: null,
            error: this.errors.activeChatJobsError,
          }).then(onfulfilled, onrejected)
        }

        if (filterFields.has('user_id') && this.errors.activeUserJobsError) {
          return Promise.resolve({
            data: null,
            error: this.errors.activeUserJobsError,
          }).then(onfulfilled, onrejected)
        }

        const filtered = this.rows.filter((row) => filters.every((predicate) => predicate(row)))
        const data = limitCount === null ? filtered : filtered.slice(0, limitCount)
        return Promise.resolve({ data, error: null as null }).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  insert(payload: Omit<ChatJobRow, 'id'> | Array<Omit<ChatJobRow, 'id'>>) {
    if (this.errors.insertError) {
      return {
        select: () => ({
          single: async () => ({
            data: null,
            error: this.errors.insertError,
          }),
        }),
      }
    }

    const records = Array.isArray(payload) ? payload : [payload]
    const inserted = records.map((record) => {
      const job: ChatJobRow = {
        id: `job-${this.rows.length + 1}`,
        ...record,
      }
      this.rows.push(job)
      return job
    })

    return {
      select: () => ({
        single: async () => ({
          data: { id: inserted[0].id },
          error: null,
        }),
      }),
    }
  }
}
