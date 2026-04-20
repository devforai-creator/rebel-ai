import {
  CHUNK_SIZE,
  DEFAULT_CHUNK_SUMMARY_PROMPT,
  DEFAULT_FACT_EXTRACTION_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  SUMMARY_LEVEL_CHUNK,
} from './config'
import { getLastSummaryEnd } from './db-helpers'
import { processChunkSummaries } from './chunk-summarizer'
import { processMetaSummaries } from './meta-summarizer'
import { processRegenerationRequests } from './regeneration'
import type { ServerSupabaseClient, UpdateSummariesOptions } from './types'

export type SummaryPromptConfig = {
  chunkPrompt: string
  metaPrompt: string
  factPrompt: string
}

export async function loadSummaryPromptConfig(
  supabase: ServerSupabaseClient,
  userId: string,
): Promise<SummaryPromptConfig> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('chunk_summary_prompt, meta_summary_prompt, fact_extraction_prompt')
    .eq('id', userId)
    .single()

  return {
    chunkPrompt: profile?.chunk_summary_prompt || DEFAULT_CHUNK_SUMMARY_PROMPT,
    metaPrompt: profile?.meta_summary_prompt || DEFAULT_META_SUMMARY_PROMPT,
    factPrompt: profile?.fact_extraction_prompt || DEFAULT_FACT_EXTRACTION_PROMPT,
  }
}

type UpdateCanonicalSealedMemoryArtifactsOptions = UpdateSummariesOptions & {
  sealedThroughSeq: number
}

export async function updateCanonicalSealedMemoryArtifacts({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  regenerate,
  sealedThroughSeq,
}: UpdateCanonicalSealedMemoryArtifactsOptions): Promise<void> {
  const normalizedSealedThroughSeq = Math.max(0, Math.trunc(sealedThroughSeq))
  const prompts = await loadSummaryPromptConfig(supabase, userId)

  if (regenerate) {
    await processRegenerationRequests({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      chunkPrompt: prompts.chunkPrompt,
      metaPrompt: prompts.metaPrompt,
      factPrompt: prompts.factPrompt,
      regenerate,
      chunkSize: CHUNK_SIZE,
    })
  }

  if (normalizedSealedThroughSeq < CHUNK_SIZE) {
    return
  }

  const lastProcessedChunkEnd = await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)

  await processChunkSummaries({
    supabase,
    chatId,
    userId,
    model,
    provider,
    modelName,
    totalMessages: normalizedSealedThroughSeq + CHUNK_SIZE,
    previousEnd: lastProcessedChunkEnd ?? 0,
    chunkPrompt: prompts.chunkPrompt,
    factPrompt: prompts.factPrompt,
  })

  await processMetaSummaries({
    supabase,
    chatId,
    userId,
    model,
    provider,
    modelName,
    metaPrompt: prompts.metaPrompt,
  })
}
