import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ChatTurn, Message, MessageInsert } from '@/types/database.types'

export type TurnClient = Pick<SupabaseClient<Database>, 'from'>

export type TurnSequenceRow = Pick<ChatTurn, 'turn_index'>
export type PersistedTurnRow = Pick<
  ChatTurn,
  'id' | 'turn_index' | 'user_message_id' | 'active_assistant_message_id'
>
export type ProjectedTurnMessage = Pick<
  Message,
  | 'id'
  | 'role'
  | 'content'
  | 'chat_id'
  | 'user_id'
  | 'sequence'
  | 'model_used'
  | 'prompt_tokens'
  | 'completion_tokens'
  | 'latency_ms'
  | 'error_code'
  | 'debug_info'
  | 'content_en'
  | 'created_at'
  | 'turn_id'
  | 'variant_index'
  | 'supersedes_message_id'
  | 'message_status'
>
export type ProjectedConversationMessage = ProjectedTurnMessage & {
  role: 'user' | 'assistant'
}

export type OrderedChatMessageDraft = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
  model_used?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
}

export type OrderedChatMessageInsert = Omit<MessageInsert, 'sequence'> & {
  id: string
  role: 'user' | 'assistant' | 'system'
}

export type ProjectedChatWindow = {
  messages: ProjectedTurnMessage[]
  hasMore: boolean
  nextCursor: number | null
}

export const PROJECTED_CHAT_MESSAGE_COLUMNS =
  'id, role, content, chat_id, user_id, sequence, model_used, prompt_tokens, completion_tokens, latency_ms, error_code, debug_info, content_en, created_at, turn_id, variant_index, supersedes_message_id, message_status'
