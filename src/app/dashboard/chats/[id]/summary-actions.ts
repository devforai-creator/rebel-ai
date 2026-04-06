'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateFactEmbedding } from '@/lib/embeddings'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import { resolveSummaryModelPreference } from '@/lib/chat/summary-model-preference'
import { getDefaultModelForProvider } from '@/lib/llm/default-model'

/**
 * Delete a chat summary
 */
export async function deleteSummary(summaryId: string, chatId: string) {
  const supabase = await createClient()

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  // Verify chat ownership
  const { data: chat } = await supabase
    .from('chats')
    .select('id, user_id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    return { error: 'Chat not found' }
  }

  // Delete summary
  const { error } = await supabase
    .from('chat_summaries')
    .delete()
    .eq('id', summaryId)
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Summary Actions] Delete failed:', error)
    return { error: 'Failed to delete summary' }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}

/**
 * Update a chat summary's content
 */
export async function updateSummary(summaryId: string, chatId: string, newSummary: string) {
  const supabase = await createClient()

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  // Verify chat ownership
  const { data: chat } = await supabase
    .from('chats')
    .select('id, user_id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    return { error: 'Chat not found' }
  }

  // Update summary
  const { error } = await supabase
    .from('chat_summaries')
    .update({ summary: newSummary })
    .eq('id', summaryId)
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Summary Actions] Update failed:', error)
    return { error: 'Failed to update summary' }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}

export async function updateFact(factId: string, chatId: string, newFacts: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { data: chat } = await supabase
    .from('chats')
    .select('id, user_id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    return { error: 'Chat not found' }
  }

  const trimmedFacts = newFacts.trim()
  if (!trimmedFacts) {
    return { error: 'Please enter content.' }
  }

  const { data: fact } = await supabase
    .from('chat_facts')
    .select('id')
    .eq('id', factId)
    .eq('chat_id', chatId)
    .single()

  if (!fact) {
    return { error: 'Record not found.' }
  }

  const updatePayload: {
    facts: string
    embedding?: number[] | null
  } = {
    facts: trimmedFacts,
  }

  const embedding = await generateFactEmbedding(trimmedFacts, user.id, supabase)
  updatePayload.embedding = embedding

  const { error } = await supabase
    .from('chat_facts')
    .update(updatePayload)
    .eq('id', factId)
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Fact Actions] Update failed:', error)
    return { error: 'Failed to update record.' }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}

export async function reembedFact(factId: string, chatId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { data: chat } = await supabase
    .from('chats')
    .select('id, user_id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    return { error: 'Chat not found' }
  }

  const { data: fact } = await supabase
    .from('chat_facts')
    .select('facts')
    .eq('id', factId)
    .eq('chat_id', chatId)
    .single()

  if (!fact) {
    return { error: 'Record not found.' }
  }

  const embedding = await generateFactEmbedding(fact.facts, user.id, supabase)

  const { error } = await supabase
    .from('chat_facts')
    .update({ embedding })
    .eq('id', factId)
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Fact Actions] Re-embed update failed:', {
      factId,
      error: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return { error: 'Failed to update embedding.' }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}

export async function regenerateSummary(summaryId: string, chatId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const ownsChat = await ensureChatOwnership(supabase, chatId, user.id)
  if (!ownsChat) {
    return { error: 'Chat not found' }
  }

  const { data: summary, error: summaryError } = await supabase
    .from('chat_summaries')
    .select('id, level, start_seq, end_seq')
    .eq('id', summaryId)
    .eq('chat_id', chatId)
    .maybeSingle()

  if (summaryError) {
    console.error('[Summary Actions] Failed to load summary for regeneration', summaryError)
  }

  if (!summary) {
    return { error: 'Summary not found.' }
  }

  if (summary.level !== 0 && summary.level !== 1) {
    return { error: 'This summary type does not support regeneration.' }
  }

  const regeneratePayload =
    summary.level === 0
      ? { chunkRanges: [{ startSeq: summary.start_seq, endSeq: summary.end_seq }] }
      : { metaRanges: [{ startSeq: summary.start_seq, endSeq: summary.end_seq }] }

  const modelConfig = await resolveModelConfig(supabase, chatId, user.id)
  if ('error' in modelConfig) {
    return { error: modelConfig.error }
  }

  const triggerResult = await triggerSummaryRegeneration({
    chatId,
    userId: user.id,
    regenerate: regeneratePayload,
    ...modelConfig,
  })

  if ('error' in triggerResult) {
    return { error: triggerResult.error }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}

export async function regenerateFacts(factId: string, chatId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const ownsChat = await ensureChatOwnership(supabase, chatId, user.id)
  if (!ownsChat) {
    return { error: 'Chat not found' }
  }

  const { data: fact, error: factError } = await supabase
    .from('chat_facts')
    .select('id, start_seq, end_seq')
    .eq('id', factId)
    .eq('chat_id', chatId)
    .maybeSingle()

  if (factError) {
    console.error('[Summary Actions] Failed to load facts for regeneration', factError)
  }

  if (!fact) {
    return { error: 'Record not found.' }
  }

  const regeneratePayload = {
    factRanges: [{ startSeq: fact.start_seq, endSeq: fact.end_seq }],
  }

  const modelConfig = await resolveModelConfig(supabase, chatId, user.id)
  if ('error' in modelConfig) {
    return { error: modelConfig.error }
  }

  const triggerResult = await triggerSummaryRegeneration({
    chatId,
    userId: user.id,
    regenerate: regeneratePayload,
    ...modelConfig,
  })

  if ('error' in triggerResult) {
    return { error: triggerResult.error }
  }

  revalidatePath(`/dashboard/chats/${chatId}`)
  return { success: true }
}

async function ensureChatOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chatId: string,
  userId: string,
): Promise<boolean> {
  const { data: chat } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', userId)
    .maybeSingle()

  return !!chat
}

async function resolveModelConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chatId: string,
  userId: string,
): Promise<{ provider: string; modelName: string; apiKeyId: string } | { error: string }> {
  const summaryPreference = await resolveSummaryModelPreference({ supabase, userId })
  if (summaryPreference) {
    return summaryPreference
  }

  const { data: usage, error: usageError } = await supabase
    .from('chat_usage_events')
    .select('api_key_id, model_provider, model_name')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (usageError) {
    console.error('[Summary Actions] Failed to resolve usage event', usageError)
  }

  if (!usage || !usage.api_key_id) {
    return {
      error: 'Could not find a recently used API key. Please run a chat first and try again.',
    }
  }

  const { data: apiKeyRow, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('id, provider, model_preference, is_active')
    .eq('id', usage.api_key_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (apiKeyError) {
    console.error('[Summary Actions] Failed to resolve API key for regeneration', apiKeyError)
  }

  if (!apiKeyRow || !apiKeyRow.is_active) {
    return { error: 'Could not find an active API key for regeneration.' }
  }

  const provider = usage.model_provider || apiKeyRow.provider
  const modelName =
    usage.model_name ||
    apiKeyRow.model_preference ||
    (provider ? getDefaultModelForProvider(provider) : null)

  if (!provider || !modelName) {
    return {
      error: 'Cannot proceed with regeneration because model information could not be verified.',
    }
  }

  return {
    provider,
    modelName,
    apiKeyId: apiKeyRow.id,
  }
}

async function triggerSummaryRegeneration({
  chatId,
  userId,
  provider,
  modelName,
  apiKeyId,
  regenerate,
}: {
  chatId: string
  userId: string
  provider: string
  modelName: string
  apiKeyId: string
  regenerate: Record<string, unknown>
}): Promise<{ success: true } | { error: string }> {
  const summarySecret = process.env.SUMMARY_GENERATION_SECRET

  if (!summarySecret) {
    console.error('[Summary Actions] SUMMARY_GENERATION_SECRET is not configured')
    return { error: 'Cannot proceed with regeneration due to server configuration error.' }
  }

  const url = buildInternalApiUrl('/api/summaries/generate')

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${summarySecret}`,
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chatId,
        userId,
        provider,
        modelName,
        apiKeyId,
        regenerate,
      }),
      cache: 'no-store',
    })
  } catch (error) {
    console.error('[Summary Actions] Failed to call summaries endpoint', error)
    return { error: 'Failed to request summary regeneration.' }
  }

  if (!response.ok) {
    const text = await response.text()
    console.error('[Summary Actions] Summaries endpoint returned an error', {
      status: response.status,
      body: text,
    })
    return { error: text || 'An error occurred during summary regeneration.' }
  }

  return { success: true }
}
