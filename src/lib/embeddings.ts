import 'server-only'
import { VoyageAIClient } from 'voyageai'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultModelForProvider } from '@/lib/models'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKey, Database, Profile } from '@/types/database.types'

type ServerSupabaseClient = SupabaseClient<Database>
type VaultRpcClient = {
  rpc: (
    fn: 'get_decrypted_secret',
    args: Database['public']['Functions']['get_decrypted_secret']['Args'],
  ) => Promise<{
    data: Database['public']['Functions']['get_decrypted_secret']['Returns'] | null
    error: { message: string; code?: string | null; details?: string | null } | null
  }>
}

/** Default embedding model from registry - change in registry.ts to update */
const VOYAGE_EMBEDDING_MODEL = getDefaultModelForProvider('voyage_embeddings')
const EMBEDDINGS_DEBUG_ENABLED = process.env.EMBEDDINGS_DEBUG === 'true'

const clientCache = new Map<string, VoyageAIClient>()

function logEmbeddingsDebug(...args: unknown[]): void {
  if (EMBEDDINGS_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function getVoyageClient(apiKey: string): VoyageAIClient {
  let client = clientCache.get(apiKey)
  if (!client) {
    client = new VoyageAIClient({ apiKey })
    clientCache.set(apiKey, client)
  }
  return client
}

export async function generateFactEmbedding(
  text: string,
  userId: string,
  supabase: ServerSupabaseClient,
): Promise<number[] | null> {
  if (!text?.trim()) {
    return null
  }

  type ProfileRagSettings = Pick<Profile, 'voyage_embedding_api_key_id' | 'enable_episodic_rag'>
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('voyage_embedding_api_key_id, enable_episodic_rag')
    .eq('id', userId)
    .single<ProfileRagSettings>()

  if (profileError || !profile?.enable_episodic_rag || !profile.voyage_embedding_api_key_id) {
    logEmbeddingsDebug('[Embeddings] Early return: profile check failed', {
      userId,
      hasProfileError: !!profileError,
      profileErrorMessage: profileError?.message,
      enableEpisodicRag: profile?.enable_episodic_rag,
      hasVoyageApiKeyId: !!profile?.voyage_embedding_api_key_id,
    })
    return null
  }

  type VoyageApiKeyRow = Pick<ApiKey, 'vault_secret_name' | 'provider' | 'is_active'>
  const { data: apiKey, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('vault_secret_name, provider, is_active')
    .eq('id', profile.voyage_embedding_api_key_id)
    .eq('user_id', userId)
    .single<VoyageApiKeyRow>()

  if (apiKeyError || !apiKey || !apiKey.is_active || apiKey.provider !== 'voyage_embeddings') {
    logEmbeddingsDebug('[Embeddings] Early return: API key check failed', {
      userId,
      hasApiKeyError: !!apiKeyError,
      apiKeyErrorMessage: apiKeyError?.message,
      hasApiKey: !!apiKey,
      isActive: apiKey?.is_active,
      provider: apiKey?.provider,
      expectedProvider: 'voyage_embeddings',
    })
    return null
  }

  logEmbeddingsDebug('[Embeddings] Starting Vault secret retrieval', {
    userId,
    environment: process.env.NODE_ENV,
  })

  const adminClient = createAdminClient()
  const rpcArgs: Database['public']['Functions']['get_decrypted_secret']['Args'] = {
    secret_name: apiKey.vault_secret_name,
    requester: userId,
  }
  const adminRpc = adminClient as unknown as VaultRpcClient
  const { data: secret, error: decryptError } = await adminRpc.rpc('get_decrypted_secret', rpcArgs)

  if (decryptError || typeof secret !== 'string' || secret.trim().length === 0) {
    console.error('[Embeddings] Failed to retrieve Voyage API key', {
      userId,
      apiKeyId: profile.voyage_embedding_api_key_id,
      error: decryptError?.message,
      secretType: typeof secret,
      secretLength: typeof secret === 'string' ? secret.length : 0,
    })
    return null
  }

  logEmbeddingsDebug('[Embeddings] Vault secret retrieved successfully, generating embedding', {
    userId,
    model: VOYAGE_EMBEDDING_MODEL,
    textLength: text.length,
  })

  try {
    const client = getVoyageClient(secret)
    const response = await client.embed({
      model: VOYAGE_EMBEDDING_MODEL,
      input: text,
    })

    const embedding = response.data?.[0]?.embedding
    const success = Array.isArray(embedding)

    logEmbeddingsDebug('[Embeddings] Embedding generation result', {
      userId,
      success,
      embeddingDimensions: success ? embedding.length : 0,
      responseKeys: Object.keys(response),
      dataLength: response.data?.length,
    })

    return success ? embedding : null
  } catch (error) {
    console.error('[Embeddings] Failed to generate embedding', {
      userId,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined,
    })
    return null
  }
}
