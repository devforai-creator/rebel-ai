'use server'

import { removeStorageObjects } from '@/lib/assets/storage-cleanup'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getFormDataErrorMessage, safeParseFormData } from '@/lib/form-data'
import { IMPORT_UPLOAD_BUCKET } from '@/lib/import/constants'
import type { Profile } from '@/types/database.types'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'

const optionalTrimmedStringSchema = z
  .string()
  .optional()
  .transform((value) => normalizeOptionalString(value))

const ragSettingsFormSchema = z.object({
  enable_rag: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
  voyage_key_id: optionalTrimmedStringSchema,
})

const summaryModelPreferenceFormSchema = z.object({
  summary_key_id: optionalTrimmedStringSchema,
})

const reprocessSettingsFormSchema = z.object({
  reprocess_prompt: optionalTrimmedStringSchema,
  reprocess_key_id: optionalTrimmedStringSchema,
})

const translationModelPreferenceFormSchema = z.object({
  translation_key_id: optionalTrimmedStringSchema,
})

const changePasswordFormSchema = z.object({
  new_password: z.string().min(6, 'Password must be at least 6 characters.'),
})

export async function deleteAccount() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    console.error('[Account] Failed to load current user for deletion', {
      error: userError?.message,
    })
    return { error: 'Unable to verify current user information.' }
  }

  const { data: apiKeys, error: apiKeysError } = await supabase
    .from('api_keys')
    .select('vault_secret_name')
    .eq('user_id', user.id)

  if (apiKeysError) {
    console.error('[Account] Failed to load API keys before deletion', {
      userId: user.id,
      error: apiKeysError.message,
    })
    return {
      error: 'An error occurred while preparing account deletion. Please try again later.',
    }
  }

  let characterAssetPaths: string[] = []
  let moduleAssetPaths: string[] = []
  let importUploadPaths: string[] = []

  try {
    ;[characterAssetPaths, moduleAssetPaths, importUploadPaths] = await Promise.all([
      listCharacterAssetStoragePathsForUser(supabase, user.id),
      listModuleAssetStoragePathsForUser(supabase, user.id),
      listImportUploadStoragePathsForUser(supabase, user.id),
    ])
  } catch (error) {
    console.error('[Account] Failed to prepare storage cleanup before deletion', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      error: 'An error occurred while preparing account deletion. Please try again later.',
    }
  }

  const admin = createAdminClient()
  const secretNames = extractVaultSecretNames(apiKeys ?? [])

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)

  if (deleteError) {
    console.error('[Account] deleteUser failed', {
      userId: user.id,
      error: deleteError.message,
    })
    return { error: 'An error occurred while deleting account. Please try again later.' }
  }

  let warning: string | undefined

  for (const [bucket, paths] of [
    ['character-assets', characterAssetPaths],
    ['module-assets', moduleAssetPaths],
    [IMPORT_UPLOAD_BUCKET, importUploadPaths],
  ] as const) {
    try {
      await removeStorageObjects(admin, bucket, paths, {
        entityId: user.id,
        entityType: 'user',
        operation: 'deleteAccount',
      })
    } catch (error) {
      console.error('[Account] Account deleted but storage cleanup failed', {
        userId: user.id,
        bucket,
        error: error instanceof Error ? error.message : String(error),
      })
      warning =
        'Account deleted, but some storage cleanup failed. The storage janitor can remove leftovers.'
    }
  }

  await deleteVaultSecretsAfterAccountDeletion(admin, user.id, secretNames)

  const { error: signOutError } = await supabase.auth.signOut()

  if (signOutError) {
    console.error('[Account] signOut after deletion failed', {
      userId: user.id,
      error: signOutError.message,
    })
  }

  return warning ? { success: true, warning } : { success: true }
}

type DeleteAccountApiKeyRow = {
  vault_secret_name: string | null
}

type DeleteAccountStorageRow = {
  storage_path: string
}

type DeleteAccountStorageSupabase = Awaited<ReturnType<typeof createClient>>
type DeleteAccountAdminSupabase = ReturnType<typeof createAdminClient>
type AccountActionSupabase = Awaited<ReturnType<typeof createClient>>
type AccountActionFailureResult = { error: string; success: false }
type BasicAccountActionResult =
  | { success: true; error?: undefined }
  | { error: string; success?: false }

function revalidateAccountSettingsPage() {
  revalidatePath('/dashboard/account')
}

async function createAuthenticatedAccountContext<TResult extends { error: string }>(
  failureResult: TResult,
): Promise<
  | {
      supabase: AccountActionSupabase
      userId: string
    }
  | TResult
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return failureResult
  }

  return {
    supabase,
    userId: user.id,
  }
}

async function validateSelectedApiKey({
  supabase,
  userId,
  apiKeyId,
  missingMessage,
  providerMismatchMessage,
  inactiveMessage,
  lookupMode = 'maybeSingle',
  isProviderAllowed,
}: {
  supabase: Pick<AccountActionSupabase, 'from'>
  userId: string
  apiKeyId: string | null
  missingMessage: string
  providerMismatchMessage: string
  inactiveMessage: string
  lookupMode?: 'single' | 'maybeSingle'
  isProviderAllowed: (provider: string) => boolean
}): Promise<AccountActionFailureResult | null> {
  if (!apiKeyId) {
    return null
  }

  const query = supabase
    .from('api_keys')
    .select('id, provider, is_active')
    .eq('id', apiKeyId)
    .eq('user_id', userId)

  const { data: apiKey, error: keyError } =
    lookupMode === 'single' ? await query.single() : await query.maybeSingle()

  if (keyError || !apiKey) {
    return { error: missingMessage, success: false }
  }

  if (!isProviderAllowed(apiKey.provider)) {
    return { error: providerMismatchMessage, success: false }
  }

  if (!apiKey.is_active) {
    return { error: inactiveMessage, success: false }
  }

  return null
}

async function updateProfileForUser({
  supabase,
  userId,
  updates,
  logLabel,
}: {
  supabase: Pick<AccountActionSupabase, 'from'>
  userId: string
  updates: Partial<Profile>
  logLabel: string
}) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId)

  if (error) {
    console.error(logLabel, error)
  }

  return error
}

async function listCharacterAssetStoragePathsForUser(
  supabase: Pick<DeleteAccountStorageSupabase, 'from'>,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('character_assets')
    .select('storage_path')
    .eq('user_id', userId)

  if (error) {
    throw error
  }

  return dedupeStoragePaths(data ?? [])
}

async function listModuleAssetStoragePathsForUser(
  supabase: Pick<DeleteAccountStorageSupabase, 'from'>,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('module_assets')
    .select('storage_path')
    .eq('user_id', userId)

  if (error) {
    throw error
  }

  return dedupeStoragePaths(data ?? [])
}

async function listImportUploadStoragePathsForUser(
  supabase: Pick<DeleteAccountStorageSupabase, 'from'>,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('charx_import_jobs')
    .select('storage_path')
    .eq('user_id', userId)

  if (error) {
    throw error
  }

  return dedupeStoragePaths(data ?? [])
}

function dedupeStoragePaths(rows: DeleteAccountStorageRow[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => row.storage_path)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
}

function extractVaultSecretNames(rows: DeleteAccountApiKeyRow[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => row.vault_secret_name)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
}

async function deleteVaultSecretsAfterAccountDeletion(
  admin: Pick<DeleteAccountAdminSupabase, 'rpc'>,
  userId: string,
  secretNames: string[],
): Promise<void> {
  for (const secretName of secretNames) {
    const { error } = await admin.rpc('delete_secret', {
      secret_name: secretName,
      requester: userId,
    })

    if (!error) {
      continue
    }

    const message = error.message?.toLowerCase() ?? ''
    if (message.includes('secret not found')) {
      console.warn('[Account] delete_secret reported missing secret after account removal', {
        userId,
        secretName,
      })
      continue
    }

    console.error('[Account] delete_secret failed after account removal', {
      userId,
      secretName,
      error: error.message,
    })
  }
}

/**
 * Update user's custom summary prompts
 */
export async function updateSummaryPrompts(
  chunkPrompt: string | null,
  metaPrompt: string | null,
  factPrompt: string | null,
): Promise<BasicAccountActionResult> {
  const context = await createAuthenticatedAccountContext({ error: 'Unauthorized' })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: {
      chunk_summary_prompt: chunkPrompt,
      meta_summary_prompt: metaPrompt,
      fact_extraction_prompt: factPrompt,
    },
    logLabel: '[Account] Failed to update summary prompts:',
  })

  if (error) {
    return { error: 'Failed to update summary prompts' }
  }

  revalidateAccountSettingsPage()
  return { success: true }
}

export type RagSettingsState = {
  error: string | null
  success: boolean
}

export async function updateRagSettings(
  _prevState: RagSettingsState,
  formData: FormData,
): Promise<RagSettingsState> {
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    ragSettingsFormSchema,
    'Please check your RAG settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const enableRag = parsedForm.data.enable_rag
  const selectedKeyId = parsedForm.data.voyage_key_id

  if (enableRag) {
    if (!selectedKeyId) {
      return { error: 'Please select a Voyage Embeddings key.', success: false }
    }

    const keyValidation = await validateSelectedApiKey({
      supabase,
      userId,
      apiKeyId: selectedKeyId,
      missingMessage: 'Could not find the selected Voyage key.',
      providerMismatchMessage: 'Only Voyage Embeddings keys can be used.',
      inactiveMessage: 'Inactive API keys cannot be used.',
      lookupMode: 'single',
      isProviderAllowed: (provider) => provider === 'voyage_embeddings',
    })

    if (keyValidation) {
      return keyValidation
    }
  }

  const updates: Partial<Profile> = {
    enable_episodic_rag: enableRag,
    voyage_embedding_api_key_id: selectedKeyId,
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates,
    logLabel: '[Account] Failed to update RAG settings:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
  return { error: null, success: true }
}

export type SummaryModelPreferenceState = {
  error: string | null
  success: boolean
}

export async function updateSummaryModelPreference(
  _prevState: SummaryModelPreferenceState,
  formData: FormData,
): Promise<SummaryModelPreferenceState> {
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    summaryModelPreferenceFormSchema,
    'Please check your summary model settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const summaryKeyId = parsedForm.data.summary_key_id

  const keyValidation = await validateSelectedApiKey({
    supabase,
    userId,
    apiKeyId: summaryKeyId,
    missingMessage: 'Could not find the selected API key.',
    providerMismatchMessage: 'Only LLM provider keys can be selected.',
    inactiveMessage: 'Inactive API keys cannot be used.',
    isProviderAllowed: isLLMProvider,
  })

  if (keyValidation) {
    return keyValidation
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: { summary_api_key_id: summaryKeyId },
    logLabel: '[Account] Failed to update summary model preference:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
  return { error: null, success: true }
}

export type ReprocessSettingsState = {
  error: string | null
  success: boolean
}

export async function updateReprocessSettings(
  _prevState: ReprocessSettingsState,
  formData: FormData,
): Promise<ReprocessSettingsState> {
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    reprocessSettingsFormSchema,
    'Please check your reprocess settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const reprocessPrompt = parsedForm.data.reprocess_prompt
  const reprocessKeyId = parsedForm.data.reprocess_key_id

  const keyValidation = await validateSelectedApiKey({
    supabase,
    userId,
    apiKeyId: reprocessKeyId,
    missingMessage: 'Could not find the selected API key.',
    providerMismatchMessage: 'Only LLM provider keys can be selected.',
    inactiveMessage: 'Inactive API keys cannot be used.',
    isProviderAllowed: isLLMProvider,
  })

  if (keyValidation) {
    return keyValidation
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: {
      reprocess_prompt: reprocessPrompt,
      reprocess_api_key_id: reprocessKeyId,
    },
    logLabel: '[Account] Failed to update reprocess settings:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
  return { error: null, success: true }
}

export type TranslationModelPreferenceState = {
  error: string | null
  success: boolean
}

export async function updateTranslationModelPreference(
  _prevState: TranslationModelPreferenceState,
  formData: FormData,
): Promise<TranslationModelPreferenceState> {
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    translationModelPreferenceFormSchema,
    'Please check your translation model settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const translationKeyId = parsedForm.data.translation_key_id

  const keyValidation = await validateSelectedApiKey({
    supabase,
    userId,
    apiKeyId: translationKeyId,
    missingMessage: 'Could not find the selected API key.',
    providerMismatchMessage: 'Only LLM provider keys can be selected.',
    inactiveMessage: 'Inactive API keys cannot be used.',
    isProviderAllowed: isLLMProvider,
  })

  if (keyValidation) {
    return keyValidation
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: {
      translation_api_key_id: translationKeyId,
    },
    logLabel: '[Account] Failed to update translation model preference:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
  return { error: null, success: true }
}

export async function changePassword(formData: FormData): Promise<BasicAccountActionResult> {
  const context = await createAuthenticatedAccountContext({ error: 'Login required.' })

  if ('error' in context) {
    return context
  }

  const { supabase } = context
  const parsedForm = parsePasswordFormData(formData)

  if ('error' in parsedForm) {
    return parsedForm
  }

  const { error } = await supabase.auth.updateUser({
    password: parsedForm.data.new_password,
  })

  if (error) {
    console.error('[Account] Failed to change password:', error)
    return { error: 'An error occurred while changing password.' }
  }

  return { success: true }
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function parseAccountFormData<TSchema extends z.ZodTypeAny>(
  formData: FormData,
  schema: TSchema,
  fallbackMessage: string,
): { data: z.infer<TSchema> } | { error: string; success: false } {
  const parsed = safeParseFormData(formData, schema)

  if (!parsed.success) {
    return {
      error: getFormDataErrorMessage(parsed.error, fallbackMessage),
      success: false,
    }
  }

  return { data: parsed.data }
}

function parsePasswordFormData(
  formData: FormData,
): { data: z.infer<typeof changePasswordFormSchema> } | { error: string } {
  const parsed = safeParseFormData(formData, changePasswordFormSchema)

  if (!parsed.success) {
    return {
      error: getAccountFormErrorMessage(parsed.error, 'Please check your password input.'),
    }
  }

  return { data: parsed.data }
}

function getAccountFormErrorMessage(error: z.ZodError, fallbackMessage: string): string {
  const firstIssue = error.issues[0]
  const field = typeof firstIssue?.path[0] === 'string' ? firstIssue.path[0] : null

  if (field === 'new_password') {
    return 'Password must be at least 6 characters.'
  }

  return getFormDataErrorMessage(error, fallbackMessage)
}
