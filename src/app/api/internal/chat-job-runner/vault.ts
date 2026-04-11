import type { Database } from '@/types/database.types'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>

type VaultRpcClient = {
  rpc: (
    fn: 'get_decrypted_secret',
    args: Database['public']['Functions']['get_decrypted_secret']['Args'],
  ) => Promise<{
    data: Database['public']['Functions']['get_decrypted_secret']['Returns'] | null
    error: { message: string; code?: string | null; details?: string | null } | null
  }>
}

export async function decryptSecret({
  supabase,
  secretName,
  requester,
}: {
  supabase: AdminSupabaseClient
  secretName: string
  requester: string
}): Promise<string> {
  const rpcArgs: Database['public']['Functions']['get_decrypted_secret']['Args'] = {
    secret_name: secretName,
    requester,
  }
  const adminRpc = supabase as unknown as VaultRpcClient
  const { data, error } = await adminRpc.rpc('get_decrypted_secret', rpcArgs)

  if (error) {
    console.error('[Chat Job Runner] Vault decryption RPC failed', {
      secretName,
      requester,
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.details,
    })
    throw new Error(
      `Failed to decrypt API key: ${error.message || error.code || 'Unknown RPC error'}`,
    )
  }

  if (!data) {
    console.error('[Chat Job Runner] Vault decryption returned empty', {
      secretName,
      requester,
    })
    throw new Error(
      'API key decryption returned empty result. Secret may have been deleted or access denied.',
    )
  }
  return data
}
