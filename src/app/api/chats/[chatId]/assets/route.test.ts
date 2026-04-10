import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

type TableName =
  | 'chats'
  | 'character_assets'
  | 'character_modules'
  | 'module_assets'
  | 'global_variables'

type QueryResponse<Row> = {
  data: Row[] | null
  error: { message: string; code?: string } | null
}

type QueryResolverContext = {
  callIndex: number
  filters: Array<[string, unknown]>
  inFilters: Array<[string, unknown[]]>
  orders: Array<{ field: string; ascending: boolean }>
  range: { from: number; to: number } | null
}

type AssetRouteFixture = {
  user: { id: string } | null
  chatsRows?: Array<Record<string, unknown>>
  characterAssetsRows?: Array<Record<string, unknown>>
  characterModulesRows?: Array<Record<string, unknown>>
  moduleAssetsRows?: Array<Record<string, unknown>>
  globalVarsRows?: Array<Record<string, unknown>>
  globalVarsError?: { message: string; code?: string } | null
  tableResolvers?: Partial<
    Record<
      'character_assets' | 'module_assets',
      (
        ctx: QueryResolverContext,
      ) =>
        | QueryResponse<Record<string, unknown>>
        | Promise<QueryResponse<Record<string, unknown>> | undefined>
        | undefined
    >
  >
}

function buildContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

function buildRequest(chatId = 'chat-1') {
  return new Request(`http://localhost/api/chats/${chatId}/assets`)
}

function matchesRow(
  row: Record<string, unknown>,
  filters: Array<[string, unknown]>,
  inFilters: Array<[string, unknown[]]>,
) {
  return (
    filters.every(([field, value]) => row[field] === value) &&
    inFilters.every(([field, values]) => values.includes(row[field]))
  )
}

function sortRows(
  rows: Array<Record<string, unknown>>,
  orders: Array<{ field: string; ascending: boolean }>,
) {
  if (orders.length === 0) {
    return [...rows]
  }

  return [...rows].sort((left, right) => {
    for (const { field, ascending } of orders) {
      const leftValue = left[field]
      const rightValue = right[field]

      if (leftValue === rightValue) {
        continue
      }

      if (leftValue === undefined || leftValue === null) {
        return ascending ? 1 : -1
      }

      if (rightValue === undefined || rightValue === null) {
        return ascending ? -1 : 1
      }

      if (leftValue > rightValue) {
        return ascending ? 1 : -1
      }

      return ascending ? -1 : 1
    }

    return 0
  })
}

class RouteSupabaseMock {
  readonly queryCalls: Partial<Record<TableName, QueryResolverContext[]>> = {}

  constructor(readonly fixture: AssetRouteFixture) {}

  auth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: this.fixture.user },
      error: null,
    }),
  }

  storage = {
    from: vi.fn((bucket: string) => ({
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
      }),
    })),
  }

  from(table: string) {
    const tableName = table as TableName
    if (
      ![
        'chats',
        'character_assets',
        'character_modules',
        'module_assets',
        'global_variables',
      ].includes(tableName)
    ) {
      throw new Error(`Unexpected table: ${table}`)
    }

    const filters: Array<[string, unknown]> = []
    const inFilters: Array<[string, unknown[]]> = []
    const orders: Array<{ field: string; ascending: boolean }> = []
    let range: { from: number; to: number } | null = null

    const execute = async (): Promise<QueryResponse<Record<string, unknown>>> => {
      const callIndex = (this.queryCalls[tableName]?.length ?? 0) + 1
      const context: QueryResolverContext = {
        callIndex,
        filters: [...filters],
        inFilters: [...inFilters],
        orders: [...orders],
        range,
      }
      ;(this.queryCalls[tableName] ??= []).push(context)

      if (tableName === 'global_variables' && this.fixture.globalVarsError) {
        return { data: null, error: this.fixture.globalVarsError }
      }

      const resolver =
        this.fixture.tableResolvers?.[tableName as 'character_assets' | 'module_assets']
      const custom = resolver ? await resolver(context) : undefined
      if (custom !== undefined) {
        return custom
      }

      const rows = (() => {
        switch (tableName) {
          case 'chats':
            return this.fixture.chatsRows ?? []
          case 'character_assets':
            return this.fixture.characterAssetsRows ?? []
          case 'character_modules':
            return this.fixture.characterModulesRows ?? []
          case 'module_assets':
            return this.fixture.moduleAssetsRows ?? []
          case 'global_variables':
            return this.fixture.globalVarsRows ?? []
        }
      })()

      const filtered = sortRows(
        rows.filter((row) => matchesRow(row, filters, inFilters)),
        orders,
      )
      const data = range ? filtered.slice(range.from, range.to + 1) : filtered
      return { data, error: null }
    }

    const builder = {
      select: () => builder,
      eq: (field: string, value: unknown) => {
        filters.push([field, value])
        return builder
      },
      in: (field: string, values: unknown[]) => {
        inFilters.push([field, values])
        return builder
      },
      order: (field: string, options?: { ascending?: boolean }) => {
        orders.push({ field, ascending: options?.ascending ?? true })
        return builder
      },
      range: (from: number, to: number) => {
        range = { from, to }
        return builder
      },
      async single() {
        const result = await execute()
        return {
          data: result.data?.[0] ?? null,
          error: result.error,
        }
      },
      then<TResult1 = QueryResponse<Record<string, unknown>>, TResult2 = never>(
        onfulfilled?:
          | ((value: QueryResponse<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(execute()).then(onfulfilled, onrejected)
      },
    }

    return builder
  }
}

function buildSupabase(fixture: Partial<AssetRouteFixture> & { user: { id: string } | null }) {
  const characterId = 'char-1'
  const userId = fixture.user?.id ?? 'user-1'

  const supabase = new RouteSupabaseMock({
    chatsRows: fixture.chatsRows ?? [
      {
        id: 'chat-1',
        user_id: userId,
        character_id: characterId,
        characters: {
          id: characterId,
          metadata: {
            image_commands: {
              happy: 'asset-1',
            },
          },
        },
      },
    ],
    characterAssetsRows: fixture.characterAssetsRows ?? [
      {
        id: 'asset-1',
        character_id: characterId,
        file_name: 'hero_happy.png',
        storage_path: `${characterId}/hero_happy.png`,
        display_name: 'Hero Happy',
        canonical_name: 'Hero Happy',
        metadata: null,
        display_order: 0,
      },
    ],
    characterModulesRows: fixture.characterModulesRows ?? [
      {
        character_id: characterId,
        module_id: 'module-1',
        enabled: true,
        priority: 0,
        modules: {
          id: 'module-1',
          name: 'Legacy Module',
          regex: [
            {
              type: 'extract',
              in: '\\\\[(happy)\\\\]',
              out: '$1',
              ableFlag: true,
              bindings: { emotion: '$1' },
              card_ref: 'emotion',
            },
          ],
          assets: [['legacy.png', 'https://example.com/legacy.png']],
        },
      },
    ],
    moduleAssetsRows: fixture.moduleAssetsRows ?? [
      {
        id: 'module-asset-1',
        module_id: 'module-1',
        user_id: userId,
        file_name: 'module_pose.png',
        storage_path: 'module-1/module_pose.png',
        display_name: null,
        metadata: null,
        display_order: 0,
      },
    ],
    globalVarsRows: fixture.globalVarsRows ?? [
      { chat_id: 'chat-1', user_id: userId, key: 'scene', value: 2 },
    ],
    user: fixture.user,
    globalVarsError: fixture.globalVarsError ?? null,
    tableResolvers: fixture.tableResolvers,
  })

  createClientMock.mockResolvedValue(supabase)
  return supabase
}

async function loadRoute() {
  return import('./route')
}

describe('GET /api/chats/[chatId]/assets', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useRealTimers()
    createClientMock.mockReset()
    consoleErrorSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    buildSupabase({ user: null })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))

    expect(response.status).toBe(401)
  })

  it('returns 404 when the chat is missing', async () => {
    buildSupabase({
      user: { id: 'user-1' },
      chatsRows: [],
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('returns 404 when the chat belongs to another user', async () => {
    buildSupabase({
      user: { id: 'user-1' },
      chatsRows: [
        {
          id: 'chat-1',
          user_id: 'other-user',
          character_id: 'char-1',
          characters: null,
        },
      ],
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('builds alias and stem keys, normalizes metadata, and uses character_list fallback mapping', async () => {
    buildSupabase({
      user: { id: 'user-1' },
      chatsRows: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'char-1',
          characters: [
            {
              id: 'char-1',
              metadata: {
                image_commands: {
                  'Happy Face': 'asset-2',
                  '': 'asset-cover',
                  Missing: 'missing-asset',
                },
                character_list: 'Happy Face, Soft Smile, Ignored Cover',
              },
            },
          ],
        },
      ],
      characterModulesRows: [],
      moduleAssetsRows: [],
      characterAssetsRows: [
        {
          id: 'asset-cover',
          character_id: 'char-1',
          file_name: '1.cover.png',
          storage_path: 'char-1/1.cover.png',
          display_name: 'Cover',
          canonical_name: 'Cover.png',
          metadata: null,
          display_order: 0,
        },
        {
          id: 'asset-2',
          character_id: 'char-1',
          file_name: '2.hero-relaxed.webp',
          storage_path: 'char-1/2.hero-relaxed.webp',
          display_name: 'Hero Relaxed',
          canonical_name: 'Hero Relaxed.webp',
          metadata: { aliases: ['Joy Pose', 7] },
          display_order: 1,
        },
        {
          id: 'asset-3',
          character_id: 'char-1',
          file_name: '3.hero-smile.png',
          storage_path: 'char-1/3.hero-smile.png',
          display_name: 'Hero Smile',
          canonical_name: 'Hero Smile.png',
          metadata: { aliases: 'invalid' },
          display_order: 2,
        },
      ],
      globalVarsRows: [
        { chat_id: 'chat-1', user_id: 'user-1', key: 'scene', value: 2 },
        { chat_id: 'chat-1', user_id: 'user-1', key: '', value: 99 },
      ],
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.globalVariables).toEqual({ scene: 2 })
    expect(body.assetUrlMap['joy_pose']).toBe(
      'https://cdn.test/character-assets/char-1/2.hero-relaxed.webp',
    )
    expect(body.assetUrlMap['hero_relax.webp']).toBe(
      'https://cdn.test/character-assets/char-1/2.hero-relaxed.webp',
    )
    expect(body.imageCommandUrlMap).toMatchObject({
      'Happy Face': 'https://cdn.test/character-assets/char-1/2.hero-relaxed.webp',
      happy_face: 'https://cdn.test/character-assets/char-1/2.hero-relaxed.webp',
      'Soft Smile': 'https://cdn.test/character-assets/char-1/3.hero-smile.png',
      soft_smile: 'https://cdn.test/character-assets/char-1/3.hero-smile.png',
    })
    expect(body.imageCommandUrlMap).not.toHaveProperty('Ignored Cover')
    expect(body.characterAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'asset-2',
          metadata: { aliases: ['Joy Pose'] },
        }),
        expect.objectContaining({
          id: 'asset-3',
          metadata: null,
        }),
      ]),
    )
  })

  it('adds short aliases for multi-word descriptors and tolerates lowercase-to-uppercase canonical duplicates', async () => {
    buildSupabase({
      user: { id: 'user-1' },
      characterModulesRows: [],
      moduleAssetsRows: [],
      globalVarsRows: [],
      characterAssetsRows: [
        {
          id: 'asset-lower',
          character_id: 'char-1',
          file_name: 'hero-very-happy-lower.webp',
          storage_path: 'char-1/hero-very-happy-lower.webp',
          display_name: null,
          canonical_name: 'hero very happy.webp',
          metadata: null,
          display_order: 0,
        },
        {
          id: 'asset-upper',
          character_id: 'char-1',
          file_name: 'hero-very-happy-upper.webp',
          storage_path: 'char-1/hero-very-happy-upper.webp',
          display_name: null,
          canonical_name: 'Hero Very Happy.webp',
          metadata: null,
          display_order: 1,
        },
      ],
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assetUrlMap['hero_very.webp']).toBe(
      'https://cdn.test/character-assets/char-1/hero-very-happy-lower.webp',
    )
    expect(body.assetUrlMap['hero_happy.webp']).toBe(
      'https://cdn.test/character-assets/char-1/hero-very-happy-lower.webp',
    )
  })

  it('builds image command URLs even when referenced assets have no canonical_name', async () => {
    buildSupabase({
      user: { id: 'user-1' },
      chatsRows: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          character_id: 'char-1',
          characters: {
            id: 'char-1',
            metadata: {
              image_commands: {
                'Ako.giggling': 'asset-1',
              },
            },
          },
        },
      ],
      characterModulesRows: [],
      moduleAssetsRows: [],
      globalVarsRows: [],
      characterAssetsRows: [
        {
          id: 'asset-1',
          character_id: 'char-1',
          file_name: '2.ako-giggling.webp',
          storage_path: 'char-1/2.ako-giggling.webp',
          display_name: 'Ako Giggling',
          canonical_name: null,
          metadata: null,
          display_order: 1,
        },
      ],
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.imageCommandUrlMap).toMatchObject({
      'Ako.giggling': 'https://cdn.test/character-assets/char-1/2.ako-giggling.webp',
      'ako.giggling': 'https://cdn.test/character-assets/char-1/2.ako-giggling.webp',
    })
  })

  it('logs global variable failures while omitting unsafe legacy module asset URLs', async () => {
    buildSupabase({
      user: { id: 'user-1' },
      characterAssetsRows: [],
      globalVarsRows: [],
      globalVarsError: { message: 'globals failed' },
      characterModulesRows: [
        {
          character_id: 'char-1',
          module_id: 'module-1',
          enabled: true,
          priority: 1,
          modules: {
            id: 'module-1',
            name: 'Legacy Module',
            regex: [
              {
                type: 'extract',
                comment: 'module regex',
                in: '\\\\[(happy)\\\\]',
                out: '$1',
                bindings: { emotion: '$1' },
                ableFlag: true,
                card_ref: ' emotion-card ',
              },
              {
                in: 'foo',
                out: 'bar',
              },
            ],
            assets: [
              ['legacy pose.png', 'https://example.com/legacy-pose.png'],
              'fallback-only.webp',
            ],
          },
        },
      ],
      moduleAssetsRows: [],
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Chat Assets] Failed to load global variables', {
      message: 'globals failed',
    })
    expect(body.globalVariables).toEqual({})
    expect(body.assetUrlMap['legacy pose.png']).toBeUndefined()
    expect(body.assetUrlMap['legacy pose']).toBeUndefined()
    expect(body.moduleAssetSummary).toEqual([
      {
        moduleId: 'module-1',
        moduleName: 'Legacy Module',
        assetCount: 0,
        expectedAssetCount: 2,
      },
    ])
    expect(body.moduleRegex).toEqual([
      {
        type: 'extract',
        comment: 'module regex',
        in: '\\\\[(happy)\\\\]',
        out: '$1',
        ableFlag: true,
        bindings: { emotion: '$1' },
        card_ref: 'emotion-card',
      },
      {
        type: '',
        comment: '',
        in: 'foo',
        out: 'bar',
        ableFlag: true,
      },
    ])
  })

  it('keeps stored module assets while omitting legacy trigger payloads', async () => {
    buildSupabase({
      user: { id: 'user-1' },
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).not.toHaveProperty('moduleTriggers')
    expect(body.globalVariables).toEqual({ scene: 2 })
    expect(body.moduleRegex).toEqual([
      {
        type: 'extract',
        comment: '',
        in: '\\\\[(happy)\\\\]',
        out: '$1',
        ableFlag: true,
        bindings: { emotion: '$1' },
        card_ref: 'emotion',
      },
    ])
    expect(body.moduleAssetSummary).toEqual([
      {
        moduleId: 'module-1',
        moduleName: 'Legacy Module',
        assetCount: 1,
        expectedAssetCount: 1,
      },
    ])
    expect(body.assetUrlMap['module_pose.png']).toBe(
      'https://cdn.test/module-assets/module-1/module_pose.png',
    )
    expect(body.imageCommandUrlMap).toEqual({
      happy: 'https://cdn.test/character-assets/char-1/hero_happy.png',
    })
  })

  it('retries character asset loading on retriable errors and then succeeds', async () => {
    vi.useFakeTimers()
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characterModulesRows: [],
      moduleAssetsRows: [],
      tableResolvers: {
        character_assets: ({ callIndex }) => {
          if (callIndex === 1) {
            return {
              data: null,
              error: { message: 'server unavailable' },
            }
          }
          return undefined
        },
      },
    })
    const { GET } = await loadRoute()

    const responsePromise = GET(buildRequest(), buildContext('chat-1'))
    await vi.runAllTimersAsync()
    const response = await responsePromise
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.characterAssets).toHaveLength(1)
    expect(supabase.queryCalls.character_assets).toHaveLength(2)
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      '[Assets API] Failed to load character_assets after retries',
      expect.anything(),
    )
  })

  it('stops retrying character asset loading on non-retriable errors', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      characterModulesRows: [],
      moduleAssetsRows: [],
      tableResolvers: {
        character_assets: () => ({
          data: null,
          error: { code: 'XX000', message: 'permission denied' },
        }),
      },
    })
    const { GET } = await loadRoute()

    const response = await GET(buildRequest(), buildContext('chat-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.characterAssets).toEqual([])
    expect(supabase.queryCalls.character_assets).toHaveLength(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Assets API] Failed to load character_assets after retries',
      {
        characterId: 'char-1',
        error: 'permission denied',
      },
    )
  })

  it('logs module asset retry exhaustion without serving unsafe legacy fallback data', async () => {
    vi.useFakeTimers()
    buildSupabase({
      user: { id: 'user-1' },
      characterAssetsRows: [],
      characterModulesRows: [
        {
          character_id: 'char-1',
          module_id: 'module-1',
          enabled: true,
          priority: 1,
          modules: {
            id: 'module-1',
            name: 'Retry Module',
            regex: [],
            assets: [['retry-fallback.webp', 'data:image/webp;base64,abc']],
          },
        },
      ],
      moduleAssetsRows: [],
      tableResolvers: {
        module_assets: () => ({
          data: null,
          error: { code: 'PGRST100', message: 'temporary unavailable' },
        }),
      },
    })
    const { GET } = await loadRoute()

    const responsePromise = GET(buildRequest(), buildContext('chat-1'))
    await vi.runAllTimersAsync()
    const response = await responsePromise
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Assets API] Failed to load module_assets after retries',
      {
        moduleCount: 1,
        error: 'temporary unavailable',
      },
    )
    expect(body.assetUrlMap['retry-fallback.webp']).toBeUndefined()
    expect(body.moduleAssetSummary).toEqual([
      {
        moduleId: 'module-1',
        moduleName: 'Retry Module',
        assetCount: 0,
        expectedAssetCount: 1,
      },
    ])
  })
})
