import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Type alias to cast mock to SupabaseClient for functions that require it.
 * Usage: someFunction(supabase as SupabaseClientType)
 */
export type SupabaseClientType = SupabaseClient<Database>

type Filter<Row> = {
  field: keyof Row | string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not'
  value: unknown
  operator?: string
}

type TableOptions<Row> = {
  rows?: Row[]
  primaryKeys?: Array<keyof Row & string>
  project?: (row: Row, columns?: string) => Record<string, unknown>
  transformInsert?: (row: Row, current: Row[]) => Row
  onUpdate?: (context: MutationContext<Row>) => void | boolean
  onDelete?: (context: MutationContext<Row>) => void | boolean
}

type MutationContext<Row> = {
  payload?: Partial<Row>
  filters: Filter<Row>[]
  matched: Row[]
  rows: Row[]
  state: Record<string, unknown>
}

type SupabaseConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables?: Record<string, TableOptions<any>>
  rpc?: Record<string, (params?: unknown) => unknown>
  state?: Record<string, unknown>
}

type QueryResult<Row> = { data: Row[]; error: null; count?: number }

type QueryBuilder = {
  eq: (field: string, value: unknown) => QueryBuilder
  neq: (field: string, value: unknown) => QueryBuilder
  not: (field: string, operator: string, value: unknown) => QueryBuilder
  gt: (field: string, value: number) => QueryBuilder
  gte: (field: string, value: number) => QueryBuilder
  lt: (field: string, value: number) => QueryBuilder
  lte: (field: string, value: number) => QueryBuilder
  in: (field: string, values: unknown[]) => QueryBuilder
  order: (field: string, options?: { ascending?: boolean }) => QueryBuilder
  range: (from: number, to: number) => QueryBuilder
  limit: (count: number) => QueryBuilder
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null
    error: { code: string; message: string } | null
  }>
  single: () => Promise<{
    data: Record<string, unknown> | null
    error: { code: string; message: string } | null
  }>
  then: <T>(onfulfilled?: (value: QueryResult<Record<string, unknown>>) => T) => Promise<T>
}

type MutationBuilder = {
  eq: (field: string, value: unknown) => MutationBuilder
  neq: (field: string, value: unknown) => MutationBuilder
  not: (field: string, operator: string, value: unknown) => MutationBuilder
  in: (field: string, values: unknown[]) => MutationBuilder
  gte: (field: string, value: number) => MutationBuilder
  lte: (field: string, value: number) => MutationBuilder
  select: (columns?: string) => {
    single: () => Promise<{
      data: Record<string, unknown> | null
      error: { code: string; message: string } | null
    }>
    maybeSingle: () => Promise<{
      data: Record<string, unknown> | null
      error: { code: string; message: string } | null
    }>
  }
  then: <T>(onfulfilled?: (value: { error: null }) => T) => Promise<T>
}

type TableHandler = {
  select: (columns?: string, opts?: { count?: string }) => QueryBuilder
  insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
    select: () => { single: () => Promise<{ data: Record<string, unknown> | null; error: null }> }
    then: <T>(
      onfulfilled?: (value: { data: Record<string, unknown>[]; error: null }) => T,
    ) => Promise<T>
  }
  update: (payload: Record<string, unknown>) => MutationBuilder
  delete: () => MutationBuilder
  upsert: (payload: Record<string, unknown> | Record<string, unknown>[]) => Promise<{ error: null }>
}

/** Mock Supabase client for testing */
export type SupabaseMock = {
  state: Record<string, unknown>
  from: (table: string) => TableHandler
  rpc: (name: string, params?: unknown) => Promise<{ data: unknown; error: null }>
}

/** Extended mock with convenience accessors for chat job runner tests */
export type ChatJobRunnerSupabaseMock = SupabaseMock & {
  updates: Array<Record<string, unknown>>
  messages: Array<Record<string, unknown>>
  usageEvents: Array<Record<string, unknown>>
  globalVariables: Array<{ chat_id: string; key: string; value: unknown; user_id?: string | null }>
}

function toCamelCase(key: string) {
  return key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())
}

function pickColumns<Row extends Record<string, unknown>>(row: Row, columns?: string) {
  if (!columns || columns === '*' || columns.includes('(')) {
    return { ...row }
  }

  const requested = columns
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (requested.length === 0) {
    return { ...row }
  }

  return requested.reduce<Record<string, unknown>>((acc, column) => {
    const [rawAlias, rawSelector] = column.includes(':')
      ? (column.split(/:(.+)/, 2) as [string, string])
      : [column, column]
    const alias = rawAlias.trim()
    const selector = rawSelector.trim()

    if (selector in row) {
      acc[alias] = row[selector]
      return acc
    }

    const jsonSelectorMatch = selector.match(/^([a-zA-Z0-9_]+)(->>|->)([a-zA-Z0-9_]+)$/)
    if (!jsonSelectorMatch) {
      return acc
    }

    const [, sourceColumn, operator, key] = jsonSelectorMatch
    const sourceValue = row[sourceColumn]
    if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) {
      return acc
    }

    const nestedValue = (sourceValue as Record<string, unknown>)[key]
    if (typeof nestedValue === 'undefined') {
      return acc
    }

    acc[alias] = operator === '->>' && nestedValue !== null ? String(nestedValue) : nestedValue
    return acc
  }, {})
}

function parseInFilterValue(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    return null
  }

  const inner = trimmed.slice(1, -1).trim()
  if (!inner) {
    return []
  }

  try {
    return JSON.parse(`[${inner}]`) as unknown[]
  } catch {
    return null
  }
}

function matchesFilter<Row extends Record<string, unknown>>(row: Row, filter: Filter<Row>) {
  const value = row[filter.field as keyof Row] as unknown
  const numericValue = Number(value)
  const numericFilterValue = Number(filter.value)
  const hasNumericComparison = Number.isFinite(numericValue) && Number.isFinite(numericFilterValue)
  const comparableValue = String(value)
  const comparableFilterValue = String(filter.value)
  switch (filter.op) {
    case 'eq':
      return value === filter.value
    case 'neq':
      return value !== filter.value
    case 'gt':
      return hasNumericComparison
        ? numericValue > numericFilterValue
        : comparableValue > comparableFilterValue
    case 'gte':
      return hasNumericComparison
        ? numericValue >= numericFilterValue
        : comparableValue >= comparableFilterValue
    case 'lt':
      return hasNumericComparison
        ? numericValue < numericFilterValue
        : comparableValue < comparableFilterValue
    case 'lte':
      return hasNumericComparison
        ? numericValue <= numericFilterValue
        : comparableValue <= comparableFilterValue
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(value)
    case 'not':
      if (filter.operator === 'in') {
        const values = parseInFilterValue(filter.value)
        if (!values) {
          return value !== filter.value
        }
        return !values.includes(value)
      }
      return value !== filter.value
    default:
      return false
  }
}

function applyFilters<Row extends Record<string, unknown>>(rows: Row[], filters: Filter<Row>[]) {
  if (filters.length === 0) {
    return [...rows]
  }

  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)))
}

function createQueryBuilder<Row extends Record<string, unknown>>(
  rows: Row[],
  options: {
    columns?: string
    project?: (row: Row, columns?: string) => Record<string, unknown>
    count?: boolean
  },
) {
  const filters: Filter<Row>[] = []
  let orderSpec: { field: keyof Row | string; ascending: boolean } | null = null
  let limitCount: number | null = null
  let rangeBounds: { from: number; to: number } | null = null

  function execute(): QueryResult<Record<string, unknown>> {
    let result = applyFilters(rows, filters)

    if (orderSpec) {
      const { field, ascending } = orderSpec
      result = result.slice().sort((a, b) => {
        const aVal = a[field as keyof Row] as unknown
        const bVal = b[field as keyof Row] as unknown
        if (aVal === bVal) return 0
        if (aVal === undefined || aVal === null) return ascending ? 1 : -1
        if (bVal === undefined || bVal === null) return ascending ? -1 : 1
        if (aVal > bVal) return ascending ? 1 : -1
        return ascending ? -1 : 1
      })
    }

    if (rangeBounds) {
      result = result.slice(rangeBounds.from, rangeBounds.to + 1)
    }

    if (limitCount !== null) {
      result = result.slice(0, limitCount)
    }

    const project = options.project ?? pickColumns<Row>
    const projected = result.map((row) => project(row, options.columns))

    return {
      data: projected,
      error: null,
      count: options.count ? projected.length : undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(field: keyof Row | string, value: unknown) {
      filters.push({ field, op: 'eq', value })
      return builder
    },
    neq(field: keyof Row | string, value: unknown) {
      filters.push({ field, op: 'neq', value })
      return builder
    },
    not(field: keyof Row | string, operator: string, value: unknown) {
      filters.push({ field, op: 'not', value, operator })
      return builder
    },
    gt(field: keyof Row | string, value: number) {
      filters.push({ field, op: 'gt', value })
      return builder
    },
    gte(field: keyof Row | string, value: number) {
      filters.push({ field, op: 'gte', value })
      return builder
    },
    lt(field: keyof Row | string, value: number) {
      filters.push({ field, op: 'lt', value })
      return builder
    },
    lte(field: keyof Row | string, value: number) {
      filters.push({ field, op: 'lte', value })
      return builder
    },
    in(field: keyof Row | string, values: unknown[]) {
      filters.push({ field, op: 'in', value: values })
      return builder
    },
    order(field: keyof Row | string, options?: { ascending?: boolean }) {
      orderSpec = { field, ascending: options?.ascending ?? true }
      return builder
    },
    range(from: number, to: number) {
      rangeBounds = { from, to }
      return builder
    },
    limit(count: number) {
      limitCount = count
      return builder
    },
    maybeSingle() {
      const { data } = execute()
      const first = data[0] ?? null
      return Promise.resolve({
        data: first,
        error: first ? null : { code: 'PGRST116', message: 'No rows found' },
      })
    },
    single() {
      return builder.maybeSingle()
    },
    then<TResult1 = QueryResult<Record<string, unknown>>, TResult2 = never>(
      onfulfilled?:
        | ((value: QueryResult<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(execute()).then(onfulfilled, onrejected)
    },
  }

  return builder
}

function applyMutation<Row extends Record<string, unknown>>(
  rows: Row[],
  filters: Filter<Row>[],
  action: 'update' | 'delete',
  payload: Partial<Row> | undefined,
  options: TableOptions<Row>,
  state: Record<string, unknown>,
) {
  const matched = applyFilters(rows, filters)
  const context: MutationContext<Row> = { payload, filters, matched, rows, state }

  if (action === 'update') {
    const proceed = options.onUpdate ? options.onUpdate(context) !== false : true
    if (proceed) {
      matched.forEach((row) => Object.assign(row, payload))
    }
  } else {
    const proceed = options.onDelete ? options.onDelete(context) !== false : true
    if (proceed) {
      for (const row of matched) {
        const idx = rows.indexOf(row)
        if (idx >= 0) {
          rows.splice(idx, 1)
        }
      }
    }
  }
}

function createMutationBuilder<Row extends Record<string, unknown>>(
  rows: Row[],
  action: 'update' | 'delete',
  payload: Partial<Row> | undefined,
  options: TableOptions<Row>,
  state: Record<string, unknown>,
) {
  const filters: Filter<Row>[] = []
  let applied = false

  const applyOnce = () => {
    if (!applied) {
      applyMutation(rows, filters, action, payload, options, state)
      applied = true
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(field: keyof Row | string, value: unknown) {
      filters.push({ field, op: 'eq', value })
      return builder
    },
    neq(field: keyof Row | string, value: unknown) {
      filters.push({ field, op: 'neq', value })
      return builder
    },
    not(field: keyof Row | string, operator: string, value: unknown) {
      filters.push({ field, op: 'not', value, operator })
      return builder
    },
    in(field: keyof Row | string, values: unknown[]) {
      filters.push({ field, op: 'in', value: values })
      return builder
    },
    gte(field: keyof Row | string, value: number) {
      filters.push({ field, op: 'gte', value })
      return builder
    },
    lte(field: keyof Row | string, value: number) {
      filters.push({ field, op: 'lte', value })
      return builder
    },
    select(columns?: string) {
      applyOnce()
      const projected = applyFilters(rows, filters).map((row) =>
        (options.project ?? pickColumns<Row>)(row, columns),
      )
      return {
        single: () =>
          Promise.resolve({
            data: projected[0] ?? null,
            error: projected[0] ? null : { code: 'PGRST116', message: 'No rows found' },
          }),
        maybeSingle: () =>
          Promise.resolve({
            data: projected[0] ?? null,
            error: projected[0] ? null : { code: 'PGRST116', message: 'No rows found' },
          }),
      }
    },
    then<TResult1 = { error: null }, TResult2 = never>(
      onfulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      applyOnce()
      return Promise.resolve({ error: null }).then(onfulfilled, onrejected)
    },
  }

  return builder
}

function upsertRow<Row extends Record<string, unknown>>(
  rows: Row[],
  row: Row,
  primaryKeys?: Array<keyof Row & string>,
) {
  const matchIndex = rows.findIndex((existing) => {
    if (primaryKeys?.length) {
      return primaryKeys.every((key) => existing[key] === row[key])
    }
    if ('id' in row && 'id' in existing) {
      return existing.id === row.id
    }
    if ('chat_id' in row && 'key' in row && 'chat_id' in existing && 'key' in existing) {
      return (
        (existing as Record<string, unknown>).chat_id ===
          (row as Record<string, unknown>).chat_id &&
        (existing as Record<string, unknown>).key === (row as Record<string, unknown>).key
      )
    }
    if (
      'chat_id' in row &&
      'start_seq' in row &&
      'end_seq' in row &&
      'level' in row &&
      'chat_id' in existing &&
      'start_seq' in existing &&
      'end_seq' in existing &&
      'level' in existing
    ) {
      return (
        (existing as Record<string, unknown>).chat_id ===
          (row as Record<string, unknown>).chat_id &&
        (existing as Record<string, unknown>).start_seq ===
          (row as Record<string, unknown>).start_seq &&
        (existing as Record<string, unknown>).end_seq ===
          (row as Record<string, unknown>).end_seq &&
        (existing as Record<string, unknown>).level === (row as Record<string, unknown>).level
      )
    }
    return false
  })

  if (matchIndex >= 0) {
    rows[matchIndex] = { ...rows[matchIndex], ...row }
  } else {
    rows.push(row)
  }
}

function createTable<Row extends Record<string, unknown>>(
  rows: Row[],
  options: TableOptions<Row>,
  state: Record<string, unknown>,
) {
  return {
    select(columns?: string, opts?: { count?: string }) {
      return createQueryBuilder(rows, {
        columns,
        project: options.project,
        count: opts?.count === 'exact',
      })
    },
    insert(payload: Row | Row[]) {
      const items = (Array.isArray(payload) ? payload : [payload]).map((row) =>
        options.transformInsert ? options.transformInsert(row, rows) : row,
      )
      rows.push(...items)
      const result = { data: items, error: null }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        select: () => ({
          single: () =>
            Promise.resolve({
              data: items[items.length - 1] ?? null,
              error: null,
            }),
        }),
        then<TResult1 = typeof result, TResult2 = never>(
          onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(result).then(onfulfilled, onrejected)
        },
      }
      return builder
    },
    update(payload: Partial<Row>) {
      return createMutationBuilder(rows, 'update', payload, options, state)
    },
    delete() {
      return createMutationBuilder(rows, 'delete', undefined, options, state)
    },
    upsert(payload: Row | Row[]) {
      const items = Array.isArray(payload) ? payload : [payload]
      for (const item of items) {
        upsertRow(rows, item, options.primaryKeys)
      }
      return Promise.resolve({ error: null })
    },
  }
}

export function createSupabaseMock(config: SupabaseConfig = {}): SupabaseMock {
  const state: Record<string, unknown> = { ...(config.state ?? {}) }
  const tables: Record<string, ReturnType<typeof createTable>> = {}

  for (const [name, options] of Object.entries(config.tables ?? {})) {
    const rows = [...(options.rows ?? [])]
    const stateKey = toCamelCase(name)
    state[stateKey] = rows
    tables[name] = createTable(rows, options, state)
  }

  const supabase: SupabaseMock = {
    state,
    from(table: string) {
      const handler = tables[table]
      if (!handler) {
        throw new Error(`Unexpected table: ${table}`)
      }
      return handler
    },
    async rpc(name: string, params?: unknown) {
      const resolver = config.rpc?.[name]
      if (!resolver) {
        throw new Error(`Unexpected rpc: ${name}`)
      }
      const value = await resolver(params)
      if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
        return value as { data: unknown; error: null }
      }
      return { data: value, error: null }
    },
  }

  return supabase
}

// Chat summaries specific helper
type ChatSummaryRow = Record<string, unknown>
type ChatFactRow = Record<string, unknown>
type MessageRow = {
  role: string
  content: string
  id?: string
  sequence?: number
  chat_id: string
  message_status?: string
  [key: string]: unknown
}

function normalizeSummaryMockMessages(messages: MessageRow[]): MessageRow[] {
  return messages.map((message, index) => ({
    id: message.id ?? `msg-${index + 1}`,
    ...message,
  }))
}

function deriveChatTurnsFromMessages(messages: MessageRow[]): Array<Record<string, unknown>> {
  const orderedMessages = [...messages]
    .filter((message) => typeof message.sequence === 'number')
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))

  const turns: Array<Record<string, unknown>> = []
  let currentTurn: Record<string, unknown> | null = null
  let turnIndex = 0

  for (const message of orderedMessages) {
    if (message.role === 'system') {
      continue
    }

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

    if (!currentTurn || currentTurn.chat_id !== message.chat_id) {
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

export function createChatSummariesSupabaseMock(
  options: {
    messages?: MessageRow[]
    chatSummaries?: ChatSummaryRow[]
    chatFacts?: ChatFactRow[]
  } = {},
): SupabaseMock {
  const normalizedMessages = normalizeSummaryMockMessages(options.messages ?? [])

  return createSupabaseMock({
    tables: {
      messages: {
        rows: normalizedMessages,
        primaryKeys: ['id'],
      },
      chat_turns: {
        rows: deriveChatTurnsFromMessages(normalizedMessages),
        primaryKeys: ['id'],
      },
      chat_summaries: {
        rows: options.chatSummaries ?? [],
        primaryKeys: ['chat_id', 'level', 'start_seq', 'end_seq'],
      },
      chat_facts: {
        rows: options.chatFacts ?? [],
      },
    },
  })
}

// Chat job runner helper
type GlobalVariableRow = { chat_id: string; key: string; value: unknown; user_id?: string | null }
type ChatJobRunnerOptions = {
  presetLink?: Record<string, unknown> | null
  modules?: Array<Record<string, unknown>>
  globalVariables?: GlobalVariableRow[]
  metadata?: Record<string, unknown>
  apiKey?: Record<string, unknown>
  chat?: Record<string, unknown>
  character?: Record<string, unknown>
  personas?: Array<Record<string, unknown>>
  rpc?: Record<string, (params?: unknown) => unknown>
  initialJobs?: Array<Record<string, unknown>>
  initialMessages?: Array<Record<string, unknown>>
  initialTurns?: Array<Record<string, unknown>>
  initialChatSummaries?: Array<Record<string, unknown>>
  initialChatFacts?: Array<Record<string, unknown>>
}

export function createChatJobRunnerSupabaseMock(
  options: ChatJobRunnerOptions = {},
): ChatJobRunnerSupabaseMock {
  const {
    presetLink = null,
    modules = [],
    globalVariables = [],
    metadata = {},
    apiKey = {
      id: 'key-1',
      user_id: 'user-1',
      is_active: true,
      provider: 'openai',
      model_preference: 'gpt-4o-mini',
      vault_secret_name: 'vault-key',
      service_tier: 'standard',
    },
    chat = {
      id: 'chat-1',
      user_id: 'user-1',
      character_id: 'char-1',
      persona_id: null,
      max_context_messages: 20,
      custom_system_prompt: null,
    },
    character = {
      id: 'char-1',
      name: 'Hero',
      system_prompt: 'CHAR PROMPT',
      metadata,
    },
    personas = [
      {
        id: 'persona-1',
        user_id: (chat as Record<string, unknown>).user_id ?? 'user-1',
        name: 'Persona',
        description: null,
      },
    ],
    rpc = {},
    initialJobs = [],
    initialMessages = [],
    initialTurns = [],
    initialChatSummaries = [],
    initialChatFacts = [],
  } = options

  const supabase = createSupabaseMock({
    state: {
      updates: [] as Array<Record<string, unknown>>,
      usageEvents: [] as Array<Record<string, unknown>>,
    },
    rpc,
    tables: {
      chat_generation_jobs: {
        rows: [...initialJobs],
        onUpdate: ({ payload, state }) => {
          const target = (state.updates ??= []) as Array<Record<string, unknown>>
          target.push(payload ?? {})
        },
      },
      api_keys: {
        rows: [apiKey],
        primaryKeys: ['id'],
      },
      chats: {
        rows: [chat],
        primaryKeys: ['id'],
      },
      characters: {
        rows: [character],
        primaryKeys: ['id'],
      },
      messages: {
        rows: [...initialMessages],
        primaryKeys: ['id'],
        transformInsert: (row, current) => ({
          id: (row as Record<string, unknown>).id ?? `msg-${current.length + 1}`,
          ...row,
        }),
      },
      chat_turns: {
        rows: [...initialTurns],
        primaryKeys: ['id'],
      },
      chat_summaries: {
        rows: [...initialChatSummaries],
        primaryKeys: ['chat_id', 'level', 'start_seq', 'end_seq'],
      },
      chat_facts: {
        rows: [...initialChatFacts],
      },
      chat_usage_events: {
        rows: [],
      },
      character_presets: {
        rows: presetLink
          ? [
              {
                character_id: (chat as Record<string, unknown>).character_id ?? 'char-1',
                active: true,
                ...presetLink,
              },
            ]
          : [],
        primaryKeys: ['preset_id'],
      },
      character_modules: {
        rows: modules.map((row) => ({
          character_id: (chat as Record<string, unknown>).character_id ?? 'char-1',
          enabled: true,
          ...row,
        })),
      },
      personas: {
        rows: personas,
        primaryKeys: ['id'],
      },
      global_variables: {
        rows: [...globalVariables],
        primaryKeys: ['chat_id', 'key'],
      },
      lorebook_overrides: {
        rows: [],
      },
      lorebook_overrides_v2: {
        rows: [],
      },
      character_assets: {
        rows: [],
      },
    },
  })

  Object.defineProperties(supabase, {
    updates: {
      get() {
        return supabase.state.updates as Array<Record<string, unknown>>
      },
    },
    messages: {
      get() {
        return supabase.state.messages as Array<Record<string, unknown>>
      },
    },
    usageEvents: {
      get() {
        const events = (supabase.state.chatUsageEvents ?? supabase.state.usageEvents) as Array<
          Record<string, unknown>
        >
        return events ?? []
      },
    },
    globalVariables: {
      get() {
        return supabase.state.globalVariables as Array<GlobalVariableRow>
      },
    },
  })

  return supabase as ChatJobRunnerSupabaseMock
}
