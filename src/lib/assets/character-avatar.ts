import type { createAdminClient } from '@/lib/supabase/admin'
import { createSignedAssetUrlMap } from './signed-asset-url'

type CharacterAvatarSupabase = Pick<ReturnType<typeof createAdminClient>, 'from' | 'storage'>

type CharacterAvatarInput = {
  id: string
  avatar_url: string | null
}

type CharacterAvatarRow = {
  character_id: string
  storage_path: string
  display_order: number | null
}

export async function resolveCharacterAvatarUrlMap(
  supabase: CharacterAvatarSupabase,
  characters: CharacterAvatarInput[],
): Promise<Record<string, string | null>> {
  const fallbackMap = characters.reduce<Record<string, string | null>>((result, character) => {
    result[character.id] = character.avatar_url ?? null
    return result
  }, {})

  const characterIds = Array.from(
    new Set(
      characters
        .map((character) => character.id)
        .filter((characterId): characterId is string => characterId.trim().length > 0),
    ),
  )

  if (characterIds.length === 0) {
    return fallbackMap
  }

  const { data, error } = await supabase
    .from('character_assets')
    .select('character_id, storage_path, display_order')
    .in('character_id', characterIds)
    .eq('asset_type', 'icon')
    .order('character_id', { ascending: true })
    .order('display_order', { ascending: true })

  if (error) {
    console.error('[Character Avatar] Failed to load icon assets', {
      characterCount: characterIds.length,
      error: error.message,
    })
    return fallbackMap
  }

  const firstIconPathByCharacterId = new Map<string, string>()
  for (const row of (data ?? []) as CharacterAvatarRow[]) {
    if (
      !row.character_id ||
      !row.storage_path ||
      firstIconPathByCharacterId.has(row.character_id)
    ) {
      continue
    }
    firstIconPathByCharacterId.set(row.character_id, row.storage_path)
  }

  const signedUrlByPath = await createSignedAssetUrlMap(
    supabase,
    'character-assets',
    [...firstIconPathByCharacterId.values()],
    {
      logContext: '[Character Avatar] Failed to sign icon assets',
    },
  )

  const resolvedMap = { ...fallbackMap }
  for (const [characterId, storagePath] of firstIconPathByCharacterId) {
    resolvedMap[characterId] = signedUrlByPath[storagePath] ?? fallbackMap[characterId] ?? null
  }

  return resolvedMap
}

export async function resolveSingleCharacterAvatarUrl(
  supabase: CharacterAvatarSupabase,
  character: CharacterAvatarInput | null,
): Promise<string | null> {
  if (!character) {
    return null
  }

  const avatarUrlMap = await resolveCharacterAvatarUrlMap(supabase, [character])
  return avatarUrlMap[character.id] ?? character.avatar_url ?? null
}

export function applyCharacterAvatarUrlMap<T extends CharacterAvatarInput>(
  characters: T[],
  avatarUrlMap: Record<string, string | null>,
): T[] {
  return characters.map((character) => ({
    ...character,
    avatar_url: avatarUrlMap[character.id] ?? character.avatar_url ?? null,
  }))
}
