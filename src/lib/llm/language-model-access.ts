import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LanguageModel } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model-factory'
import { getDecryptedSecret } from '@/lib/supabase/rpc'
import type { ApiServiceTier, Database, LlmProvider } from '@/types/database.types'

type RpcClient = Pick<SupabaseClient<Database>, 'rpc'>

export type SecretBackedLanguageModelConfig = {
  provider: LlmProvider
  modelName: string
  serviceTier?: ApiServiceTier | null
  vaultSecretName: string
}

export async function resolveLanguageModelApiKey({
  supabase,
  requester,
  vaultSecretName,
  logPrefix,
}: {
  supabase: RpcClient
  requester: string
  vaultSecretName: string
  logPrefix: string
}): Promise<string> {
  const { data, error } = await getDecryptedSecret(supabase, {
    secret_name: vaultSecretName,
    requester,
  })

  if (error) {
    console.error(`${logPrefix} Vault decryption failed`, {
      secretName: vaultSecretName,
      requester,
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.details,
    })
    throw new Error('Vault decryption failed')
  }

  if (!data) {
    console.error(`${logPrefix} Vault decryption returned empty`, {
      secretName: vaultSecretName,
      requester,
    })
    throw new Error('Vault returned empty secret')
  }

  return data
}

export async function createLanguageModelFromSecretConfig({
  supabase,
  requester,
  config,
  logPrefix,
}: {
  supabase: RpcClient
  requester: string
  config: SecretBackedLanguageModelConfig
  logPrefix: string
}): Promise<LanguageModel> {
  const apiKey = await resolveLanguageModelApiKey({
    supabase,
    requester,
    vaultSecretName: config.vaultSecretName,
    logPrefix,
  })
  return buildLanguageModel({
    provider: config.provider,
    modelName: config.modelName,
    apiKey,
    serviceTier: config.serviceTier,
  })
}
