import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createSignedAssetUrlMap } from '@/lib/assets/signed-asset-url'
import { buildChatAssetPayload } from '@/app/api/chats/[chatId]/assets/asset-payload'
import {
  fetchCharacterAssetsWithRetry,
  fetchModuleData,
} from '@/app/api/chats/[chatId]/assets/asset-queries'
import type { Character } from '@/types/database.types'

// Call only after the page has verified access to the character.
export async function loadGreetingPreviewData(
  character: Pick<Character, 'id' | 'user_id' | 'metadata'>,
) {
  try {
    const admin = createAdminClient()
    const [characterAssets, moduleData] = await Promise.all([
      fetchCharacterAssetsWithRetry(admin, character.id, character.user_id),
      fetchModuleData(admin, character.id, character.user_id),
    ])
    const characterAssetUrlMapByPath = await createSignedAssetUrlMap(
      admin,
      'character-assets',
      characterAssets.map((asset) => asset.storage_path),
    )

    return buildChatAssetPayload({
      characterAssets,
      characterAssetUrlMapByPath,
      characterMetadata: character.metadata as Record<string, unknown> | null,
      moduleAssetUrls: moduleData.moduleAssetUrls,
      moduleRegex: moduleData.allRegex,
      moduleAssetSummary: moduleData.moduleAssetSummary,
      globalVariables: {},
    })
  } catch (error) {
    console.error('[Greeting Preview] Failed to load assets', error)
    return null
  }
}
