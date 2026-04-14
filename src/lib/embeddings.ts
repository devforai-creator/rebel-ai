import 'server-only'
import { VoyageAIClient } from 'voyageai'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDecryptedSecret } from '@/lib/supabase/rpc'
import { getDefaultModelForProvider } from '@/lib/models'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKey, Database, Profile } from '@/types/database.types'

type ServerSupabaseClient = SupabaseClient<Database>
export type FactEmbeddingProfileSettings = Pick<
  Profile,
  'voyage_embedding_api_key_id' | 'enable_episodic_rag'
>
type FactEmbeddingAccess = {
  client: VoyageAIClient
}

/** Default embedding model from registry - change in registry.ts to update */
const VOYAGE_EMBEDDING_MODEL = getDefaultModelForProvider('voyage_embeddings')
const EMBEDDINGS_DEBUG_ENABLED = process.env.EMBEDDINGS_DEBUG === 'true'

const clientCache = new Map<string, VoyageAIClient>()
const embeddingAccessCache = new WeakMap<
  ServerSupabaseClient,
  Map<string, Promise<FactEmbeddingAccess | null>>
>()

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

async function loadFactEmbeddingAccess({
  userId,
  supabase,
  profileSettings,
}: {
  userId: string
  supabase: ServerSupabaseClient
  profileSettings?: FactEmbeddingProfileSettings | null
}): Promise<FactEmbeddingAccess | null> {
  const resolvedProfile =
    profileSettings ?? (await loadFactEmbeddingProfileSettings(userId, supabase))

  if (!resolvedProfile?.enable_episodic_rag || !resolvedProfile.voyage_embedding_api_key_id) {
    logEmbeddingsDebug('[Embeddings] Early return: profile check failed', {
      userId,
      enableEpisodicRag: resolvedProfile?.enable_episodic_rag,
      hasVoyageApiKeyId: !!resolvedProfile?.voyage_embedding_api_key_id,
    })
    return null
  }

  const apiKey = await loadVoyageApiKey({
    supabase,
    userId,
    apiKeyId: resolvedProfile.voyage_embedding_api_key_id,
  })
  if (!apiKey) {
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
  const { data: secret, error: decryptError } = await getDecryptedSecret(adminClient, rpcArgs)

  if (decryptError || typeof secret !== 'string' || secret.trim().length === 0) {
    console.error('[Embeddings] Failed to retrieve Voyage API key', {
      userId,
      apiKeyId: resolvedProfile.voyage_embedding_api_key_id,
      error: decryptError?.message,
      secretType: typeof secret,
      secretLength: typeof secret === 'string' ? secret.length : 0,
    })
    return null
  }

  return {
    client: getVoyageClient(secret),
  }
}

async function loadFactEmbeddingProfileSettings(
  userId: string,
  supabase: ServerSupabaseClient,
): Promise<FactEmbeddingProfileSettings | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('voyage_embedding_api_key_id, enable_episodic_rag')
    .eq('id', userId)
    .single<FactEmbeddingProfileSettings>()

  if (profileError || !profile) {
    logEmbeddingsDebug('[Embeddings] Early return: profile lookup failed', {
      userId,
      hasProfileError: !!profileError,
      profileErrorMessage: profileError?.message,
    })
    return null
  }

  return profile
}

async function loadVoyageApiKey({
  supabase,
  userId,
  apiKeyId,
}: {
  supabase: ServerSupabaseClient
  userId: string
  apiKeyId: string
}): Promise<Pick<ApiKey, 'vault_secret_name'> | null> {
  type VoyageApiKeyRow = Pick<ApiKey, 'vault_secret_name' | 'provider' | 'is_active'>
  const { data: apiKey, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('vault_secret_name, provider, is_active')
    .eq('id', apiKeyId)
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

  return apiKey
}

function getCachedFactEmbeddingAccess({
  userId,
  supabase,
  profileSettings,
}: {
  userId: string
  supabase: ServerSupabaseClient
  profileSettings?: FactEmbeddingProfileSettings | null
}): Promise<FactEmbeddingAccess | null> {
  let perClientCache = embeddingAccessCache.get(supabase)
  if (!perClientCache) {
    perClientCache = new Map<string, Promise<FactEmbeddingAccess | null>>()
    embeddingAccessCache.set(supabase, perClientCache)
  }

  const cached = perClientCache.get(userId)
  if (cached) {
    logEmbeddingsDebug('[Embeddings] Reusing cached embedding access', { userId })
    return cached
  }

  const accessPromise = loadFactEmbeddingAccess({
    userId,
    supabase,
    profileSettings,
  })
  perClientCache.set(userId, accessPromise)
  return accessPromise
}

export async function generateFactEmbedding(
  text: string,
  userId: string,
  supabase: ServerSupabaseClient,
  options?: {
    profileSettings?: FactEmbeddingProfileSettings | null
  },
): Promise<number[] | null> {
  if (!text?.trim()) {
    return null
  }

  const access = await getCachedFactEmbeddingAccess({
    userId,
    supabase,
    profileSettings: options?.profileSettings,
  })
  if (!access) {
    return null
  }

  logEmbeddingsDebug('[Embeddings] Vault secret retrieved successfully, generating embedding', {
    userId,
    model: VOYAGE_EMBEDDING_MODEL,
    textLength: text.length,
  })

  try {
    const response = await access.client.embed({
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
