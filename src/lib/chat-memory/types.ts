import type { ChatModelConfig } from '@/lib/chat/model-config'
import type {
  BuildContextOptions,
  RagResultInfo,
  RegenerateConfig,
  SanitizedMessage,
  ServerSupabaseClient,
  UpdateSummariesOptions,
} from '@/lib/chat-summaries/types'

export type MemoryPromptBlock = {
  role: 'system' | 'user' | 'assistant'
  content: string
  cachePreference: 'prefer-cache' | 'no-preference' | 'avoid-cache'
  stability: 'static' | 'sealed' | 'live'
}

export type MemoryTranscriptCoverage = 'full' | 'window'

export type MemoryPlan = {
  mode: 'summary_window' | 'prefix_live_blocks'
  promptBlocks: MemoryPromptBlock[]
  fallbackSystemPrompt: string
  fallbackMessages: SanitizedMessage[]
  staticSystemPrompt: string
  dynamicContext: string | null
  ragInfo?: RagResultInfo
}

export type BuildMemoryPlanOptions = BuildContextOptions & {
  modelConfig?: ChatModelConfig | null
  transcriptCoverage?: MemoryTranscriptCoverage
  transcriptStartOrdinal?: number
}

export type UpdateMemoryStateOptions = UpdateSummariesOptions & {
  modelConfig?: ChatModelConfig | null
}

export type HasMemoryUpdateWorkOptions = {
  supabase: ServerSupabaseClient
  chatId: string
  regenerate?: RegenerateConfig
  modelConfig?: ChatModelConfig | null
}
