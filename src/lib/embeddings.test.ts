/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to create mocks that work with hoisting
const { mockEmbed } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
}))

// Mock server-only (must be first)
vi.mock('server-only', () => ({}))

// Mock VoyageAIClient
vi.mock('voyageai', () => ({
  VoyageAIClient: class {
    embed = mockEmbed
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/models', () => ({
  getDefaultModelForProvider: vi.fn(() => 'voyage-3'),
}))

// Import after mocks
import { generateFactEmbedding } from './embeddings'
import { createAdminClient } from '@/lib/supabase/admin'

const mockCreateAdminClient = createAdminClient as ReturnType<typeof vi.fn>

interface MockSupabaseConfig {
  profileResult?: {
    data: { voyage_embedding_api_key_id: string | null; enable_episodic_rag: boolean } | null
    error: { message: string } | null
  }
  apiKeyResult?: {
    data: { vault_secret_name: string; provider: string; is_active: boolean } | null
    error: { message: string } | null
  }
}

function createMockSupabase(config: MockSupabaseConfig = {}) {
  const defaultProfile = {
    data: { voyage_embedding_api_key_id: 'api-key-123', enable_episodic_rag: true },
    error: null,
  }
  const defaultApiKey = {
    data: { vault_secret_name: 'voyage_secret', provider: 'voyage_embeddings', is_active: true },
    error: null,
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve(config.profileResult ?? defaultProfile)),
            })),
          })),
        }
      }
      if (table === 'api_keys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(config.apiKeyResult ?? defaultApiKey)),
              })),
            })),
          })),
        }
      }
      return {}
    }),
  }

  return client as any
}

function createMockAdminClient(rpcResult?: {
  data: string | null
  error: { message: string } | null
}) {
  return {
    rpc: vi.fn(() =>
      Promise.resolve(
        rpcResult ?? {
          data: 'sk-voyage-test-key',
          error: null,
        },
      ),
    ),
  }
}

function setupVoyageEmbed(embedResult?: { data: Array<{ embedding: number[] }> | null }) {
  mockEmbed.mockResolvedValue(
    embedResult ?? {
      data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
    },
  )
}

describe('generateFactEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('input validation', () => {
    it('returns null for empty text', async () => {
      const supabase = createMockSupabase()
      const result = await generateFactEmbedding('', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null for whitespace-only text', async () => {
      const supabase = createMockSupabase()
      const result = await generateFactEmbedding('   ', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null for null text', async () => {
      const supabase = createMockSupabase()
      const result = await generateFactEmbedding(null as any, 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null for undefined text', async () => {
      const supabase = createMockSupabase()
      const result = await generateFactEmbedding(undefined as any, 'user-123', supabase)
      expect(result).toBeNull()
    })
  })

  describe('profile validation', () => {
    it('returns null when profile query fails', async () => {
      const supabase = createMockSupabase({
        profileResult: { data: null, error: { message: 'Profile not found' } },
      })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when episodic RAG is disabled', async () => {
      const supabase = createMockSupabase({
        profileResult: {
          data: { voyage_embedding_api_key_id: 'key-123', enable_episodic_rag: false },
          error: null,
        },
      })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when voyage API key ID is missing', async () => {
      const supabase = createMockSupabase({
        profileResult: {
          data: { voyage_embedding_api_key_id: null, enable_episodic_rag: true },
          error: null,
        },
      })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })
  })

  describe('API key validation', () => {
    it('returns null when API key query fails', async () => {
      const supabase = createMockSupabase({
        apiKeyResult: { data: null, error: { message: 'Key not found' } },
      })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when API key is inactive', async () => {
      const supabase = createMockSupabase({
        apiKeyResult: {
          data: { vault_secret_name: 'secret', provider: 'voyage_embeddings', is_active: false },
          error: null,
        },
      })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when API key provider is not voyage_embeddings', async () => {
      const supabase = createMockSupabase({
        apiKeyResult: {
          data: { vault_secret_name: 'secret', provider: 'openai', is_active: true },
          error: null,
        },
      })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })
  })

  describe('vault secret retrieval', () => {
    it('returns null when vault decryption fails', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient({
        data: null,
        error: { message: 'Decryption failed' },
      })
      mockCreateAdminClient.mockReturnValue(adminClient)

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when secret is empty string', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient({
        data: '',
        error: null,
      })
      mockCreateAdminClient.mockReturnValue(adminClient)

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when secret is whitespace only', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient({
        data: '   ',
        error: null,
      })
      mockCreateAdminClient.mockReturnValue(adminClient)

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when secret is not a string', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient({
        data: null,
        error: null,
      })
      mockCreateAdminClient.mockReturnValue(adminClient)

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })
  })

  describe('Voyage API calls', () => {
    it('returns embedding on success', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient()
      mockCreateAdminClient.mockReturnValue(adminClient)
      setupVoyageEmbed()

      const result = await generateFactEmbedding('test text', 'user-123', supabase)

      expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
      expect(mockEmbed).toHaveBeenCalledWith({
        model: 'voyage-3',
        input: 'test text',
      })
    })

    it('returns null when Voyage API throws error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient()
      mockCreateAdminClient.mockReturnValue(adminClient)
      mockEmbed.mockRejectedValue(new Error('API rate limit exceeded'))

      const result = await generateFactEmbedding('test text', 'user-123', supabase)

      expect(result).toBeNull()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Embeddings] Failed to generate embedding',
        expect.objectContaining({ error: 'API rate limit exceeded' }),
      )

      consoleErrorSpy.mockRestore()
    })

    it('returns null when Voyage API returns empty data', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient()
      mockCreateAdminClient.mockReturnValue(adminClient)
      setupVoyageEmbed({ data: [] })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when embedding is not an array', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient()
      mockCreateAdminClient.mockReturnValue(adminClient)
      mockEmbed.mockResolvedValue({ data: [{ embedding: 'not-an-array' }] })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })

    it('returns null when data is null', async () => {
      const supabase = createMockSupabase()
      const adminClient = createMockAdminClient()
      mockCreateAdminClient.mockReturnValue(adminClient)
      setupVoyageEmbed({ data: null })

      const result = await generateFactEmbedding('test text', 'user-123', supabase)
      expect(result).toBeNull()
    })
  })
})
