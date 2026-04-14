import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSignedAssetUrlMap } from '@/lib/assets/signed-asset-url'
import {
  buildChatAssetPayload,
  reduceGlobalVariables,
  type GlobalVariableRecord,
} from './asset-payload'
import { fetchCharacterAssetsWithRetry, fetchModuleData } from './asset-queries'

export async function GET(_req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  const supabase = await createClient()
  const adminSupabase = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: chat } = await supabase
    .from('chats')
    .select(
      `
      id,
      user_id,
      character_id,
      characters (
        id,
        metadata
      )
    `,
    )
    .eq('id', chatId)
    .single()

  if (!chat || chat.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fetch character assets, module data, and global variables in parallel
  const [characterAssets, moduleData, { data: globalVars, error: globalVarsError }] =
    await Promise.all([
      fetchCharacterAssetsWithRetry(adminSupabase, chat.character_id),
      fetchModuleData(adminSupabase, chat.character_id),
      supabase
        .from('global_variables')
        .select('key, value')
        .eq('chat_id', chatId)
        .eq('user_id', user.id),
    ])

  if (globalVarsError) {
    console.error('[Chat Assets] Failed to load global variables', globalVarsError)
  }

  const { allRegex: moduleRegex, moduleAssetUrls, moduleAssetSummary } = moduleData
  const characterData = Array.isArray(chat.characters) ? chat.characters[0] : chat.characters
  const globalVariables = reduceGlobalVariables(globalVars as GlobalVariableRecord[] | null)

  const characterAssetUrlMapByPath = await createSignedAssetUrlMap(
    adminSupabase,
    'character-assets',
    (characterAssets || []).map((asset) => asset.storage_path),
    {
      logContext: '[Chat Assets] Failed to sign character assets',
    },
  )
  const payload = buildChatAssetPayload({
    characterAssets: characterAssets || [],
    characterAssetUrlMapByPath,
    characterMetadata:
      (characterData?.metadata as Record<string, unknown> | null | undefined) ?? null,
    moduleAssetUrls,
    moduleRegex,
    moduleAssetSummary,
    globalVariables,
  })

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'private, no-store',
    },
  })
}
