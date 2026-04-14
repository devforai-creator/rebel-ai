import { buildContext } from '@/lib/chat-summaries'
import type { BuildContextOptions } from '@/lib/chat-summaries/types'
import type { MemoryPlan, MemoryPromptBlock } from './types'

export async function buildSummaryWindowMemoryPlan({
  supabase,
  chatId,
  sanitizedMessages,
  baseSystemPrompt,
  extraDynamicContext,
}: BuildContextOptions): Promise<MemoryPlan> {
  const result = await buildContext({
    supabase,
    chatId,
    sanitizedMessages,
    baseSystemPrompt,
    extraDynamicContext,
  })

  const promptBlocks: MemoryPromptBlock[] = []
  const staticSystemPrompt = baseSystemPrompt.trim()

  if (staticSystemPrompt) {
    promptBlocks.push({
      role: 'system',
      content: staticSystemPrompt,
      cachePreference: 'prefer-cache',
      stability: 'static',
    })
  }

  if (result.dynamicContext) {
    promptBlocks.push({
      role: 'system',
      content: result.dynamicContext,
      cachePreference: 'avoid-cache',
      stability: 'sealed',
    })
  }

  for (const message of result.recentMessages) {
    promptBlocks.push({
      role: message.role,
      content: message.content,
      cachePreference: 'avoid-cache',
      stability: 'live',
    })
  }

  return {
    mode: 'summary_window',
    promptBlocks,
    fallbackSystemPrompt: result.systemPrompt,
    fallbackMessages: result.recentMessages,
    staticSystemPrompt,
    dynamicContext: result.dynamicContext,
    ragInfo: result.ragInfo,
  }
}
