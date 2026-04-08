import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { buildClientIdentifier } from '@/lib/chat/rate-limiter'
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
  return { createClientMock, fetchMock }
})

const createClientMock = hoistedMocks.createClientMock
type FetchMock = ReturnType<typeof vi.fn<typeof globalThis.fetch>>
const fetchMock = hoistedMocks.fetchMock as FetchMock

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
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
  chatJobInsertError?: { message: string; code?: string | null }
}

type ChatAdminRequest =
  | { action: 'checkAnonRateLimit'; args: Record<string, unknown> }
  | { action: 'checkUserRateLimit'; args: Record<string, unknown> }
  | { action: 'decryptSecret'; args: Record<string, unknown> }

type ChatAdminCall = { name: string; params: Record<string, unknown> }

let currentAdminMock: SupabaseAdminMock | null = null
let adminRpcCalls: ChatAdminCall[] = []

function buildChatAdminSuccess(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildChatAdminError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

fetchMock.mockImplementation(async (input, init) => {
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

  if (url.pathname !== '/api/internal/chat-admin') {
    throw new Error(`Unexpected fetch call: ${url.toString()}`)
  }

  const headers = new Headers(init?.headers)
  const authHeader = headers.get('authorization')
  const secret = process.env.CHAT_ADMIN_SECRET

  if (!secret) {
    return buildChatAdminError('CHAT_ADMIN_SECRET missing')
  }

  if (authHeader !== `Bearer ${secret}`) {
    return buildChatAdminError('Unauthorized', 401)
  }

  if (!currentAdminMock) {
    return buildChatAdminError('No admin mock configured')
  }

  const payload = init?.body ? JSON.parse(init.body.toString()) : {}
  const action = payload.action as ChatAdminRequest['action']
  const args = (payload.args ?? {}) as Record<string, unknown>

  let rpcName: string
  switch (action) {
    case 'checkAnonRateLimit':
      rpcName = 'check_anon_rate_limit'
      break
    case 'checkUserRateLimit':
      rpcName = 'check_chat_rate_limit'
      break
    case 'decryptSecret':
      rpcName = 'get_decrypted_secret'
      break
    default:
      return buildChatAdminError(`Unsupported action: ${action}`)
  }

  adminRpcCalls.push({ name: rpcName, params: args })

  const result = await currentAdminMock.rpc(rpcName, args)
  if (result.error) {
    return buildChatAdminError(result.error.message ?? 'RPC error')
  }

  return buildChatAdminSuccess(result.data ?? null)
})

class SupabaseRouteMock {
  constructor(
    fixture: SupabaseFixture,
    private readonly adminMock: SupabaseAdminMock,
  ) {
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
        return new MessagesTable(this.messages)
      case 'chat_turns':
        return new ChatTurnsTable(this.chatTurns, this.messages)
      case 'global_variables':
        return new GlobalVariablesTable(this.globalVariables)
      case 'chat_generation_jobs':
        return new ChatGenerationJobsTable(this.chatJobs, this.fixture.chatJobInsertError)
      default:
        throw new Error(`Unsupported table: ${table}`)
    }
  }
}

class SupabaseAdminMock {
  constructor(private readonly fixture: SupabaseFixture) {}

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
  constructor(private readonly rows: MessageRow[]) {}

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
          | ((value: { data: MessageRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        const remaining = this.rows.filter((row) => !filters.every((predicate) => predicate(row)))
        this.rows.length = 0
        this.rows.push(...remaining)
        return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  insert(payload: Omit<MessageRow, 'id'> | Array<Omit<MessageRow, 'id'>>) {
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
          | ((value: { data: ChatTurnRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
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
  const adminMock = new SupabaseAdminMock(fixture)
  const routeMock = new SupabaseRouteMock(fixture, adminMock)
  createClientMock.mockReturnValue(routeMock)
  currentAdminMock = adminMock
  adminRpcCalls = adminMock.rpcCalls
  ;(
    routeMock as SupabaseRouteMock & {
      adminRpcCalls: Array<{ name: string; params: Record<string, unknown> }>
    }
  ).adminRpcCalls = adminMock.rpcCalls
  return routeMock as SupabaseRouteMock & {
    adminRpcCalls: Array<{ name: string; params: Record<string, unknown> }>
  }
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
    fetchMock.mockClear()
    currentAdminMock = null
    adminRpcCalls = []
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

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid request body')
  })

  it('returns 400 when chatId is invalid', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 123,
        apiKeyId: 'api-key-1',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid chatId')
  })

  it('returns 400 when apiKeyId is invalid', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: '',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid apiKeyId')
  })

  it('returns 400 when no valid chat messages are provided', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        messages: [
          { role: 'system', content: 'ignored' },
          { role: 'user', content: 123 },
          { role: 10, content: 'bad role' },
        ],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Messages array required')
  })

  it('returns 400 when a message exceeds the byte-size limit', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        messages: [{ role: 'user', content: 'a'.repeat(262_145) }],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Message exceeds allowed size')
  })

  it('returns 400 when the last message is not a non-empty user message', async () => {
    createSupabaseMock(buildDefaultAuthenticatedFixture())

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'api-key-1',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'response' },
        ],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Last message must be a non-empty user message')
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
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
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
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Unauthorized')
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
        messages: [{ role: 'user', content: 'hello' }],
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
        messages: [{ role: 'user', content: 'hello' }],
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
        messages: [{ role: 'user', content: 'hello' }],
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
        messages: [{ role: 'user', content: 'hello' }],
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
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('17')
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: 'Too many requests',
      retryAfter: 17,
    })
  })

  it('rejects oversized declared request bodies before auth or JSON parsing', async () => {
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: '{}',
      headers: {
        'content-length': '5308417',
        'content-type': 'application/json',
      },
    })

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(await response.text()).toBe('Request body exceeds allowed size')
    expect(createClientMock).not.toHaveBeenCalled()
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
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(500)
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
        messages: [{ role: 'user', content: '안녕' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(404)
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
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('API key not found or inactive')
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
        messages: [{ role: 'user', content: '안녕' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Unsupported provider')
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
        messages: [
          { role: 'system', content: 'ignored' },
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: '최신 질문' },
        ],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(202)
    const body = (await response.json()) as { jobId: string }
    expect(body.jobId).toBeDefined()

    expect(supabase.messages).toHaveLength(1)
    expect(supabase.messages[0]).toMatchObject({
      role: 'user',
      content: '최신 질문',
    })
    expect(supabase.chatJobs).toHaveLength(1)
    expect(supabase.chatJobs[0]).toMatchObject({
      chat_id: 'chat-1',
      user_id: 'user-1',
      status: 'pending',
    })
    const payload = supabase.chatJobs[0].payload as Record<string, unknown>
    expect(payload).toMatchObject({
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'api-key-1',
      provider: 'google',
      modelName: 'gemini-2.5-flash',
      isRegeneration: false,
    })
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
        messages: [{ role: 'user', content: 'blocked' }],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(409)
    expect(await response.text()).toBe('This chat already has a pending or in-progress response.')
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(1)
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
        messages: [{ role: 'user', content: 'too many queues' }],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(429)
    expect(await response.text()).toBe(
      'You already have 3 active chat responses. Wait for one to finish before sending another message.',
    )
    expect(supabase.messages).toHaveLength(0)
    expect(supabase.chatJobs).toHaveLength(3)
  })

  it('rolls back the persisted user message when chat job insert hits an active-job race', async () => {
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
        messages: [{ role: 'user', content: 'race me' }],
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(409)
    expect(await response.text()).toBe('This chat already has a pending or in-progress response.')
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
        messages: [{ role: 'user', content: 'use default model' }],
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
        messages: [{ role: 'user', content: 'rate limit me' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(429)
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: 'Rate limit exceeded',
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

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('15')
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
        messages: [{ role: 'user', content: 'rate limit me' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
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
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(500)
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
        messages: [
          { role: 'assistant', content: 'old reply' },
          { role: 'user', content: 'retry please' },
        ],
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
        messages: [
          { role: 'assistant', content: 'old reply' },
          { role: 'user', content: 'retry please' },
        ],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid regeneration target')
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
    private readonly insertError?: { message: string; code?: string | null },
  ) {}

  select() {
    const filters: Predicate<ChatJobRow>[] = []
    let limitCount: number | null = null
    const builder = {
      eq: (field: keyof ChatJobRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      in: (field: keyof ChatJobRow, values: unknown[]) => {
        filters.push((row) => values.includes(row[field]))
        return builder
      },
      limit: (value: number) => {
        limitCount = value
        return builder
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: ChatJobRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        const filtered = this.rows.filter((row) => filters.every((predicate) => predicate(row)))
        const data = limitCount === null ? filtered : filtered.slice(0, limitCount)
        return Promise.resolve({ data, error: null as null }).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  insert(payload: Omit<ChatJobRow, 'id'> | Array<Omit<ChatJobRow, 'id'>>) {
    if (this.insertError) {
      return {
        select: () => ({
          single: async () => ({
            data: null,
            error: this.insertError,
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
