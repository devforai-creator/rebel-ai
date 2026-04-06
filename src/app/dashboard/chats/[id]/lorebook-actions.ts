'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  computeLorebookEntryFingerprint,
  getLorebookOverrideKeyV2,
} from '@/lib/lorebook/override-identity'

/**
 * Toggle a lorebook entry for a specific chat
 * Creates or updates an override in the database
 */
export async function toggleLorebookEntry(params: {
  chatId: string
  entryKey: string
  entryInsertorder: number
  enabled: boolean
}) {
  const supabase = await createClient()

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { chatId, entryKey, entryInsertorder, enabled } = params

  // Verify chat ownership
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (chatError || !chat) {
    return { error: 'Chat not found or unauthorized' }
  }

  // Upsert the override
  const { error: upsertError } = await supabase.from('lorebook_overrides').upsert(
    {
      chat_id: chatId,
      user_id: user.id,
      entry_key: entryKey,
      entry_insertorder: entryInsertorder,
      enabled,
    },
    {
      onConflict: 'chat_id,entry_key,entry_insertorder',
    },
  )

  if (upsertError) {
    console.error('[Lorebook Override] Failed to upsert:', upsertError)
    return { error: 'Failed to save preference' }
  }

  // Revalidate the chat page to reflect changes
  revalidatePath(`/dashboard/chats/${chatId}`)

  return { success: true }
}

export type LorebookOverrideMode = 'auto' | 'pinned' | 'disabled'

/**
 * Set a chat-scoped lorebook override for a single entry.
 *
 * Modes:
 * - auto: clear override (default activation rules apply)
 * - pinned: force activation (acts like always-active for this chat)
 * - disabled: never activate for this chat
 */
export async function setLorebookEntryOverride(params: {
  chatId: string
  moduleId: string
  entryKey: string
  entryInsertorder: number
  entryContent: string
  entryComment?: string
  entrySecondkey?: string
  entryMode?: 'normal' | 'folder'
  entryAlwaysActive?: boolean
  entrySelective?: boolean
  entryFolder?: string
  entryUseRegex?: boolean
  mode: LorebookOverrideMode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const {
    chatId,
    moduleId,
    entryKey,
    entryInsertorder,
    entryContent,
    entryComment,
    entrySecondkey,
    entryMode,
    entryAlwaysActive,
    entrySelective,
    entryFolder,
    entryUseRegex,
    mode,
  } = params

  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (chatError || !chat) {
    return { error: 'Chat not found or unauthorized' }
  }

  if (mode === 'auto') {
    const { error: deleteError } = await supabase
      .from('lorebook_overrides_v2')
      .delete()
      .eq('chat_id', chatId)
      .eq('module_id', moduleId)
      .eq(
        'entry_fingerprint',
        computeLorebookEntryFingerprint(moduleId, {
          key: entryKey,
          secondkey: entrySecondkey,
          comment: entryComment ?? '',
          content: entryContent,
          mode: entryMode ?? 'normal',
          insertorder: entryInsertorder,
          alwaysActive: entryAlwaysActive ?? false,
          selective: entrySelective ?? false,
          folder: entryFolder,
          useRegex: entryUseRegex,
        }),
      )

    if (deleteError) {
      console.error('[Lorebook Override] Failed to delete:', deleteError)
      return { error: 'Failed to clear preference' }
    }

    revalidatePath(`/dashboard/chats/${chatId}`)
    return { success: true }
  }

  const enabled = mode === 'pinned'
  const fingerprint = computeLorebookEntryFingerprint(moduleId, {
    key: entryKey,
    secondkey: entrySecondkey,
    comment: entryComment ?? '',
    content: entryContent,
    mode: entryMode ?? 'normal',
    insertorder: entryInsertorder,
    alwaysActive: entryAlwaysActive ?? false,
    selective: entrySelective ?? false,
    folder: entryFolder,
    useRegex: entryUseRegex,
  })

  const { error: upsertError } = await supabase.from('lorebook_overrides_v2').upsert(
    {
      chat_id: chatId,
      user_id: user.id,
      module_id: moduleId,
      entry_key: entryKey,
      entry_insertorder: entryInsertorder,
      entry_fingerprint: fingerprint,
      enabled,
    },
    { onConflict: 'chat_id,module_id,entry_fingerprint' },
  )

  if (upsertError) {
    console.error('[Lorebook Override] Failed to upsert:', upsertError)
    return { error: 'Failed to save preference' }
  }

  // Useful to the client for optimistic cache updates if needed.
  const v2Key = getLorebookOverrideKeyV2(moduleId, fingerprint)

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true, key: v2Key }
}

/**
 * Get all lorebook overrides for a chat
 */
export async function getLorebookOverrides(chatId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized', data: null }
  }

  // Verify chat ownership
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (chatError || !chat) {
    return { error: 'Chat not found or unauthorized', data: null }
  }

  // Fetch overrides
  const { data: overrides, error } = await supabase
    .from('lorebook_overrides')
    .select('entry_key, entry_insertorder, enabled')
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Lorebook Override] Failed to fetch:', error)
    return { error: 'Failed to load preferences', data: null }
  }

  return { data: overrides, error: null }
}

/**
 * Reset all overrides for a chat (back to defaults)
 */
export async function resetLorebookOverrides(chatId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  // Verify chat ownership
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (chatError || !chat) {
    return { error: 'Chat not found or unauthorized' }
  }

  // Delete all overrides for this chat
  const [{ error: deleteV2Error }, { error: deleteV1Error }] = await Promise.all([
    supabase.from('lorebook_overrides_v2').delete().eq('chat_id', chatId),
    supabase.from('lorebook_overrides').delete().eq('chat_id', chatId),
  ])

  if (deleteV2Error || deleteV1Error) {
    console.error('[Lorebook Override] Failed to reset:', { deleteV2Error, deleteV1Error })
    return { error: 'Failed to reset preferences' }
  }

  // Revalidate the chat page
  revalidatePath(`/dashboard/chats/${chatId}`)

  return { success: true }
}
