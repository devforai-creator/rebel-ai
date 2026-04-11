'use server'

import { z } from 'zod'
import { safeParseFormData } from '@/lib/form-data'
import { removeStorageObjects } from '@/lib/assets/storage-cleanup'
import { IMPORT_UPLOAD_BUCKET } from '@/lib/import/constants'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  createAuthenticatedAccountContext,
  getAccountFormErrorMessage,
  type BasicAccountActionResult,
} from './account-action-helpers'

const changePasswordFormSchema = z.object({
  new_password: z.string().min(6, 'Password must be at least 6 characters.'),
})

type DeleteAccountApiKeyRow = {
  vault_secret_name: string | null
}

type DeleteAccountStorageRow = {
  storage_path: string
}

type DeleteAccountStorageSupabase = Awaited<ReturnType<typeof createClient>>
type DeleteAccountAdminSupabase = ReturnType<typeof createAdminClient>

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
