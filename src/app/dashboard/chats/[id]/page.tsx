import { Suspense } from 'react'
import LoadingState from '@/app/dashboard/components/LoadingState'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSingleCharacterAvatarUrl } from '@/lib/assets/character-avatar'
import { redirect } from 'next/navigation'
import ChatInterface from './ChatInterface'
import DeleteChatButton from './DeleteChatButton'
import LorebookPanelLoader from './LorebookPanelLoader'
import ChatSummariesPanelLoader from './ChatSummariesPanelLoader'
import ChatSummariesToggle from './ChatSummariesToggle'
import ChatHeader from './ChatHeader'
import { CHAT_MESSAGE_PAGE_SIZE } from '@/lib/chat/constants'
import SystemPromptEditorButton from './SystemPromptEditorButton'
import ChatPersonaWidget from './ChatPersonaWidget'
import { BASE_GLOBAL_SYSTEM_PROMPT } from '@/lib/chat/global-system-prompt'
import { normalizeChatModelConfig } from '@/lib/chat/model-config'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'
import { loadProjectedChatWindow } from '@/lib/chat/turns'
import type { Persona } from '@/types/database.types'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ apiKey?: string }>
}

export default async function ChatPage({ params, searchParams }: Props) {
  const { id } = await params
  const search = await searchParams
  const supabase = await createClient()
  const adminSupabase = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check if user is a developer
  const developerEmails = process.env.DEVELOPER_EMAILS?.split(',').map((e) => e.trim()) || []
  const isDeveloper = developerEmails.includes(user.email || '')

  const { data: chat } = await supabase
    .from('chats')
    .select(
      `
      id,
      title,
      character_id,
      persona_id,
      model_config,
      custom_system_prompt,
      characters (
        id,
        name,
        avatar_url,
        metadata
      )
    `,
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    redirect('/dashboard/characters')
  }

  // Handle Supabase nested select which returns array for single relations
  const character = Array.isArray(chat.characters) ? chat.characters[0] : chat.characters
  const characterAvatarUrl = await resolveSingleCharacterAvatarUrl(
    adminSupabase,
    character
      ? {
          id: character.id,
          avatar_url: character.avatar_url ?? null,
        }
      : null,
  )

  const personaPromise: Promise<Persona | null> = (async () => {
    if (!chat.persona_id) return null

    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('id, user_id, name, description, created_at, updated_at')
      .eq('id', chat.persona_id)
      .eq('user_id', user.id)
      .single()

    if (personaError) {
      console.error('[ChatPage] Failed to load persona for chat', {
        chatId: id,
        personaId: chat.persona_id,
        message: personaError.message,
      })
      return null
    }

    return persona
  })()

  const availablePersonasPromise = supabase
    .from('personas')
    .select('id, name')
    .eq('user_id', user.id)
    .order('name', { ascending: true })

  const [{ data: apiKeys }, persona, { data: availablePersonas }, initialWindow] =
    await Promise.all([
      supabase
        .from('api_keys')
        .select('id, key_name, provider, model_preference, service_tier')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('key_name', { ascending: true }),
      personaPromise,
      availablePersonasPromise,
      loadProjectedChatWindow({
        supabase,
        chatId: id,
        limitTurns: CHAT_MESSAGE_PAGE_SIZE,
      }),
    ])

  const initialMessages = initialWindow.messages
  const historyCursor = initialWindow.nextCursor

  // Filter to only include LLM providers (exclude embedding-only providers)
  const apiKeyList = (apiKeys || []).filter((key) => isLLMProvider(key.provider))
  const preselectedApiKeyId = search.apiKey || apiKeyList[0]?.id

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <ChatHeader
        characterId={chat.character_id}
        characterName={character?.name || 'AI'}
        chatTitle={chat.title}
      >
        <ChatPersonaWidget
          chatId={id}
          personaId={chat.persona_id}
          initialName={persona?.name || null}
          initialDescription={persona?.description || null}
          availablePersonas={availablePersonas || []}
        />
        <SystemPromptEditorButton
          chatId={id}
          initialPrompt={chat.custom_system_prompt}
          defaultPrompt={BASE_GLOBAL_SYSTEM_PROMPT}
        />
        <DeleteChatButton chatId={id} chatTitle={chat.title} />
      </ChatHeader>

      {/* Chat interface */}
      <main className="flex-1 overflow-hidden">
        <div className="flex h-full">
          <Suspense fallback={<LorebookPanelFallback />}>
            <LorebookPanelLoader chatId={chat.id} characterId={chat.character_id} />
          </Suspense>
          <div className="flex flex-1 min-h-0">
            <ChatInterface
              chatId={chat.id}
              initialMessages={initialMessages}
              apiKeys={apiKeyList}
              preselectedApiKeyId={preselectedApiKeyId}
              initialModelConfig={normalizeChatModelConfig(chat.model_config)}
              initialUsageStats={null}
              character={{
                name: character?.name || 'AI',
                avatar_url: characterAvatarUrl,
                metadata: character?.metadata || null,
              }}
              initialHistoryCursor={historyCursor}
              hasMoreHistory={initialWindow.hasMore}
              isDeveloper={isDeveloper}
            />
          </div>
          <ChatSummariesToggle>
            <Suspense fallback={<ChatSummariesFallback />}>
              <ChatSummariesPanelLoader chatId={chat.id} />
            </Suspense>
          </ChatSummariesToggle>
        </div>
      </main>
    </div>
  )
}

function LorebookPanelFallback() {
  return (
    <div className="hidden lg:block w-12 border-r border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-900" />
  )
}

function ChatSummariesFallback() {
  return (
    <aside className="h-full w-full border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="p-4 lg:p-6">
        <LoadingState
          title="Loading long-term memory"
          description="Preparing summaries, facts, and memory checkpoints for this chat."
        />
      </div>
    </aside>
  )
}
