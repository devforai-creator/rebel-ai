import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type RpcFunctions = Database['public']['Functions']
type RpcFunctionName = keyof RpcFunctions & string
type RpcClient = Pick<SupabaseClient<Database>, 'rpc'>

export type TypedRpcError = {
  message: string
  code?: string | null
  details?: string | null
  hint?: string | null
}

type TypedRpcResult<TName extends RpcFunctionName> = Promise<{
  data: RpcFunctions[TName]['Returns'] | null
  error: TypedRpcError | null
}>

function callTypedRpc<TName extends RpcFunctionName>(
  client: RpcClient,
  fn: TName,
  args: RpcFunctions[TName]['Args'],
): TypedRpcResult<TName> {
  return (
    client.rpc as unknown as (fn: TName, args: RpcFunctions[TName]['Args']) => TypedRpcResult<TName>
  )(fn, args)
}

export function getDecryptedSecret(
  client: RpcClient,
  args: RpcFunctions['get_decrypted_secret']['Args'],
) {
  return callTypedRpc(client, 'get_decrypted_secret', args)
}

export function recordServiceHealthStatus(
  client: RpcClient,
  args: RpcFunctions['record_service_health_status']['Args'],
) {
  return callTypedRpc(client, 'record_service_health_status', args)
}
