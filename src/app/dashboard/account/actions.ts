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
) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      chunk_summary_prompt: chunkPrompt,
      meta_summary_prompt: metaPrompt,
      fact_extraction_prompt: factPrompt,
    })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update summary prompts:', error)
    return { error: 'Failed to update summary prompts' }
  }

  revalidatePath('/dashboard/account')
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
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

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

    const { data: key, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', selectedKeyId)
      .eq('user_id', user.id)
      .single()

    if (keyError || !key) {
      return { error: 'Could not find the selected Voyage key.', success: false }
    }

    if (key.provider !== 'voyage_embeddings') {
      return { error: 'Only Voyage Embeddings keys can be used.', success: false }
    }

    if (!key.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const updates: Partial<Profile> = {
    enable_episodic_rag: enableRag,
    voyage_embedding_api_key_id: selectedKeyId,
  }

  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update RAG settings:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
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
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const parsedForm = parseAccountFormData(
    formData,
    summaryModelPreferenceFormSchema,
    'Please check your summary model settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const summaryKeyId = parsedForm.data.summary_key_id

  if (summaryKeyId) {
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', summaryKeyId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (keyError || !apiKey) {
      return { error: 'Could not find the selected API key.', success: false }
    }

    if (!isLLMProvider(apiKey.provider)) {
      return { error: 'Only LLM provider keys can be selected.', success: false }
    }

    if (!apiKey.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ summary_api_key_id: summaryKeyId })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update summary model preference:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
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
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

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

  if (reprocessKeyId) {
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', reprocessKeyId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (keyError || !apiKey) {
      return { error: 'Could not find the selected API key.', success: false }
    }

    if (!isLLMProvider(apiKey.provider)) {
      return { error: 'Only LLM provider keys can be selected.', success: false }
    }

    if (!apiKey.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      reprocess_prompt: reprocessPrompt,
      reprocess_api_key_id: reprocessKeyId,
    })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update reprocess settings:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
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
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const parsedForm = parseAccountFormData(
    formData,
    translationModelPreferenceFormSchema,
    'Please check your translation model settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const translationKeyId = parsedForm.data.translation_key_id

  if (translationKeyId) {
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', translationKeyId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (keyError || !apiKey) {
      return { error: 'Could not find the selected API key.', success: false }
    }

    if (!isLLMProvider(apiKey.provider)) {
      return { error: 'Only LLM provider keys can be selected.', success: false }
    }

    if (!apiKey.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      translation_api_key_id: translationKeyId,
    })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update translation model preference:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
  return { error: null, success: true }
}

export async function changePassword(formData: FormData) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.' }
  }

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
