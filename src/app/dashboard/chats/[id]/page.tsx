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
import ChatSettingsButton from './ChatSettingsButton'
import { CHAT_MESSAGE_PAGE_SIZE } from '@/lib/chat/constants'
import SystemPromptEditorButton from './SystemPromptEditorButton'
import ChatPersonaWidget from './ChatPersonaWidget'
import { BASE_GLOBAL_SYSTEM_PROMPT } from '@/lib/chat/global-system-prompt'
import { normalizeChatModelConfig } from '@/lib/chat/model-config'
import { isKnownLLMProvider } from '@/lib/api-keys/provider-utils'
import { loadProjectedChatWindow } from '@/lib/chat/turns'
import type { Persona } from '@/types/database.types'
import { CHAT_RUNTIME_API_KEY_OPTION_COLUMNS } from '../api-key-options'
import {
  buildInitialActiveChatJob,
  pickChatCharacterMetadata,
  stripInitialMessageDebugInfo,
} from './rsc-payload'
import { ACTIVE_QUEUE_JOB_STATUSES } from '@/lib/queue/admission'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ apiKey?: string; model?: string }>
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
  // Resolve active work before loading messages so a completion racing with refresh is either
  // restored as pending work or included by the subsequent message-window query.
  const activeJobPromise = supabase
    .from('chat_generation_jobs')
    .select('id, delivery_mode, payload')
    .eq('chat_id', id)
    .eq('user_id', user.id)
    .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
    .limit(1)
    .maybeSingle()
  const [characterAvatarUrl, { data: activeJob, error: activeJobError }] = await Promise.all([
    resolveSingleCharacterAvatarUrl(
      adminSupabase,
      character
        ? {
            id: character.id,
            avatar_url: character.avatar_url ?? null,
          }
        : null,
    ),
    activeJobPromise,
  ])

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

  const profileSettingsPromise = supabase
    .from('profiles')
    .select('enable_chat_usage_stats, enable_agentic_transcript_recall_default')
    .eq('id', user.id)
    .maybeSingle<{
      enable_chat_usage_stats: boolean
      enable_agentic_transcript_recall_default: boolean
    }>()

  const availablePersonasPromise = supabase
    .from('personas')
    .select('id, name')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('name', { ascending: true })

  const [
    { data: apiKeys },
    persona,
    { data: profileSettings },
    { data: availablePersonas },
    initialWindow,
  ] = await Promise.all([
    supabase
      .from('api_keys')
      .select(CHAT_RUNTIME_API_KEY_OPTION_COLUMNS)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('key_name', { ascending: true }),
    personaPromise,
    profileSettingsPromise,
    availablePersonasPromise,
    loadProjectedChatWindow({
      supabase,
      chatId: id,
      limitTurns: CHAT_MESSAGE_PAGE_SIZE,
    }),
  ])

  const initialMessages = stripInitialMessageDebugInfo(initialWindow.messages)
  const initialActiveJob = buildInitialActiveChatJob(activeJob)
  const historyCursor = initialWindow.nextCursor
  const normalizedModelConfig = normalizeChatModelConfig(chat.model_config)

  if (activeJobError) {
    console.warn('[ChatPage] Failed to restore active chat job', {
      chatId: id,
      message: activeJobError.message,
    })
  }

  // Filter to only include LLM providers (exclude embedding-only providers)
  const apiKeyList = (apiKeys ?? []).flatMap((key) =>
    isKnownLLMProvider(key.provider)
      ? [
          {
            ...key,
            provider: key.provider,
          },
        ]
      : [],
  )
  const preselectedApiKeyId = search.apiKey || apiKeyList[0]?.id
  const preselectedModelName = search.model?.trim()

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <ChatHeader
        characterId={chat.character_id}
        characterName={character?.name || 'AI'}
        chatTitle={chat.title}
      >
        <ChatSettingsButton
          chatId={id}
          initialModelConfig={normalizedModelConfig}
          accountAgenticTranscriptRecallDefaultEnabled={
            profileSettings?.enable_agentic_transcript_recall_default ?? false
          }
        />
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
          <div className="flex flex-1 min-w-0 min-h-0">
            <ChatInterface
              chatId={chat.id}
              initialMessages={initialMessages}
              initialActiveJob={initialActiveJob}
              apiKeys={apiKeyList}
              preselectedApiKeyId={preselectedApiKeyId}
              preselectedModelName={preselectedModelName}
              initialModelConfig={normalizedModelConfig}
              initialUsageStats={null}
              usageStatsEnabled={profileSettings?.enable_chat_usage_stats ?? false}
              character={{
                name: character?.name || 'AI',
                avatar_url: characterAvatarUrl,
                metadata: pickChatCharacterMetadata(character?.metadata ?? null),
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
