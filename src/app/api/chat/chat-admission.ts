import { createClient } from '@/lib/supabase/server'
import {
  ACTIVE_CHAT_JOB_CONFLICT_MESSAGE,
  ACTIVE_QUEUE_JOB_STATUSES,
  MAX_ACTIVE_CHAT_JOBS_PER_USER,
  buildActiveChatJobLimitMessage,
} from '@/lib/queue/admission'
import { createErrorResponse } from './responses'

type RouteSupabaseClient = Awaited<ReturnType<typeof createClient>>

type AdmissionResult =
  | {
      status: 'success'
    }
  | {
      status: 'error'
      response: Response
    }

type RegenerationTargetResult =
  | {
      status: 'success'
      turnId: string | null
    }
  | {
      status: 'error'
      response: Response
    }

export async function ensureChatRequestAdmission({
  supabase,
  chatId,
  userId,
  requestId,
}: {
  supabase: RouteSupabaseClient
  chatId: string
  userId: string
  requestId: string
}): Promise<AdmissionResult> {
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', userId)
    .single()

  if (chatError || !chat) {
    return {
      status: 'error',
      response: createErrorResponse('Chat not found', 404),
    }
  }

  const [existingActiveJobResult, activeUserJobsResult] = await Promise.all([
    supabase
      .from('chat_generation_jobs')
      .select('id, status')
      .eq('chat_id', chatId)
      .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
      .limit(1),
    supabase
      .from('chat_generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .in('status', [...ACTIVE_QUEUE_JOB_STATUSES]),
  ])

  if (existingActiveJobResult.error) {
    console.error('[Chat API] Failed to check active chat job', {
      chatId,
      requestId,
      error: existingActiveJobResult.error.message,
    })
    return {
      status: 'error',
      response: createErrorResponse('Failed to inspect active chat jobs', 500),
    }
  }

  if ((existingActiveJobResult.data?.length ?? 0) > 0) {
    return {
      status: 'error',
      response: createErrorResponse(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, 409),
    }
  }

  if (activeUserJobsResult.error) {
    console.error('[Chat API] Failed to count active user jobs', {
      chatId,
      requestId,
      error: activeUserJobsResult.error.message,
    })
    return {
      status: 'error',
      response: createErrorResponse('Failed to inspect active chat jobs', 500),
    }
  }

  if ((activeUserJobsResult.data?.length ?? 0) >= MAX_ACTIVE_CHAT_JOBS_PER_USER) {
    return {
      status: 'error',
      response: createErrorResponse(buildActiveChatJobLimitMessage(), 429),
    }
  }

  return { status: 'success' }
}

export async function resolveRegenerationTargetTurnId({
  supabase,
  chatId,
  regenerateAssistantMessageId,
  requestId,
}: {
  supabase: RouteSupabaseClient
  chatId: string
  regenerateAssistantMessageId: string | null
  requestId: string
}): Promise<RegenerationTargetResult> {
  if (!regenerateAssistantMessageId) {
    return { status: 'success', turnId: null }
  }

  const [
    { data: targetTurn, error: targetTurnError },
    { data: latestTurn, error: latestTurnError },
  ] = await Promise.all([
    supabase
      .from('chat_turns')
      .select('id, turn_index, active_assistant_message_id')
      .eq('chat_id', chatId)
      .eq('active_assistant_message_id', regenerateAssistantMessageId)
      .single(),
    supabase
      .from('chat_turns')
      .select('id, turn_index')
      .eq('chat_id', chatId)
      .order('turn_index', { ascending: false })
      .limit(1)
      .single(),
  ])

  if (targetTurnError || !targetTurn || latestTurnError || !latestTurn) {
    console.warn('[Chat API] Invalid regeneration target', {
      chatId,
      requestId,
      targetId: regenerateAssistantMessageId,
    })
    return {
      status: 'error',
      response: createErrorResponse('Invalid regeneration target', 400),
    }
  }

  if (latestTurn.id !== targetTurn.id) {
    return {
      status: 'error',
      response: createErrorResponse('Only the latest assistant message can be regenerated', 400),
    }
  }

  return {
    status: 'success',
    turnId: targetTurn.id,
  }
}
