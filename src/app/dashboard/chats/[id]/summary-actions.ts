'use server'

import { generateFactEmbedding } from '@/lib/embeddings'
import { revalidateSummaryChatPath, requireOwnedChatActionContext } from './summary-action-support'
import {
  buildFactRegenerationPayload,
  buildSummaryRegenerationPayload,
  requestSummaryRegeneration,
  resolveSummaryRegenerationModelConfig,
} from './summary-regeneration'

/**
 * Delete a chat summary
 */
export async function deleteSummary(summaryId: string, chatId: string) {
  const context = await requireOwnedChatActionContext(chatId)
  if ('error' in context) {
    return context
  }

  const { error } = await context.supabase
    .from('chat_summaries')
    .delete()
    .eq('id', summaryId)
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Summary Actions] Delete failed:', error)
    return { error: 'Failed to delete summary' }
  }

  revalidateSummaryChatPath(chatId)
  return { success: true }
}

/**
 * Update a chat summary's content
 */
export async function updateSummary(summaryId: string, chatId: string, newSummary: string) {
  const context = await requireOwnedChatActionContext(chatId)
  if ('error' in context) {
    return context
  }

  const { error } = await context.supabase
    .from('chat_summaries')
    .update({ summary: newSummary })
    .eq('id', summaryId)
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Summary Actions] Update failed:', error)
    return { error: 'Failed to update summary' }
  }

  revalidateSummaryChatPath(chatId)
  return { success: true }
}

export async function updateFact(factId: string, chatId: string, newFacts: string) {
  const context = await requireOwnedChatActionContext(chatId)
  if ('error' in context) {
    return context
  }

  const trimmedFacts = newFacts.trim()
  if (!trimmedFacts) {
    return { error: 'Please enter content.' }
  }

  const { data: fact } = await context.supabase
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

  const embedding = await generateFactEmbedding(trimmedFacts, context.userId, context.supabase)
  updatePayload.embedding = embedding

  const { error } = await context.supabase
    .from('chat_facts')
    .update(updatePayload)
    .eq('id', factId)
    .eq('chat_id', chatId)

  if (error) {
    console.error('[Fact Actions] Update failed:', error)
    return { error: 'Failed to update record.' }
  }

  revalidateSummaryChatPath(chatId)
  return { success: true }
}

export async function reembedFact(factId: string, chatId: string) {
  const context = await requireOwnedChatActionContext(chatId)
  if ('error' in context) {
    return context
  }

  const { data: fact } = await context.supabase
    .from('chat_facts')
    .select('facts')
    .eq('id', factId)
    .eq('chat_id', chatId)
    .single()

  if (!fact) {
    return { error: 'Record not found.' }
  }

  const embedding = await generateFactEmbedding(fact.facts, context.userId, context.supabase)

  const { error } = await context.supabase
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

  revalidateSummaryChatPath(chatId)
  return { success: true }
}

export async function regenerateSummary(summaryId: string, chatId: string) {
  const context = await requireOwnedChatActionContext(chatId)
  if ('error' in context) {
    return context
  }

  const { data: summary, error: summaryError } = await context.supabase
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

  const regeneratePayload = buildSummaryRegenerationPayload(summary)
  if ('error' in regeneratePayload) {
    return regeneratePayload
  }

  const modelConfig = await resolveSummaryRegenerationModelConfig(
    context.supabase,
    chatId,
    context.userId,
  )
  if ('error' in modelConfig) {
    return modelConfig
  }

  const triggerResult = await requestSummaryRegeneration({
    chatId,
    userId: context.userId,
    regenerate: regeneratePayload.regenerate,
    ...modelConfig,
  })

  if ('error' in triggerResult) {
    return triggerResult
  }

  revalidateSummaryChatPath(chatId)
  return { success: true }
}

export async function regenerateFacts(factId: string, chatId: string) {
  const context = await requireOwnedChatActionContext(chatId)
  if ('error' in context) {
    return context
  }

  const { data: fact, error: factError } = await context.supabase
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

  const modelConfig = await resolveSummaryRegenerationModelConfig(
    context.supabase,
    chatId,
    context.userId,
  )
  if ('error' in modelConfig) {
    return modelConfig
  }

  const triggerResult = await requestSummaryRegeneration({
    chatId,
    userId: context.userId,
    regenerate: buildFactRegenerationPayload(fact),
    ...modelConfig,
  })

  if ('error' in triggerResult) {
    return triggerResult
  }

  revalidateSummaryChatPath(chatId)
  return { success: true }
}
