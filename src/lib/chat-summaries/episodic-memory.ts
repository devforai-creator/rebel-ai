import type { FactEmbeddingProfileSettings } from '@/lib/embeddings'
import type { ServerSupabaseClient } from './types'

export type EpisodicMemorySettings = {
  userId: string | null
  enabled: boolean
  profileSettings: FactEmbeddingProfileSettings | null
}

export async function loadUserEpisodicMemorySettings({
  supabase,
  userId,
}: {
  supabase: ServerSupabaseClient
  userId: string
}): Promise<EpisodicMemorySettings> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('enable_episodic_rag, voyage_embedding_api_key_id')
    .eq('id', userId)
    .single<FactEmbeddingProfileSettings>()

  if (!profile) {
    if (profileError) {
      console.error('Failed to load episodic memory profile settings:', profileError.message)
    }
    return {
      userId,
      enabled: false,
      profileSettings: null,
    }
  }

  return {
    userId,
    enabled: profile.enable_episodic_rag === true,
    profileSettings: profile,
  }
}

export async function loadChatEpisodicMemorySettings({
  supabase,
  chatId,
}: {
  supabase: ServerSupabaseClient
  chatId: string
}): Promise<EpisodicMemorySettings> {
  const { data: chatOwner, error: chatOwnerError } = await supabase
    .from('chats')
    .select('user_id')
    .eq('id', chatId)
    .single()

  if (!chatOwner?.user_id) {
    if (chatOwnerError) {
      console.error('Failed to load chat owner for episodic memory:', chatOwnerError.message)
    }
    return {
      userId: null,
      enabled: false,
      profileSettings: null,
    }
  }

  return loadUserEpisodicMemorySettings({
    supabase,
    userId: chatOwner.user_id,
  })
}
