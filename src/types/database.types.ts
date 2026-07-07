// App-facing database types.
// `database.generated.ts` is the reproducible Supabase output.
// This wrapper narrows a few columns to the contracts the app already relies on.

import type { Database as GeneratedDatabase } from './database.generated'

export type { Json } from './database.generated'
export { Constants } from './database.generated'

type PublicSchema = GeneratedDatabase['public']
type PublicTables = PublicSchema['Tables']
type PublicFunctions = PublicSchema['Functions']
type PublicEnums = PublicSchema['Enums']
type PublicCompositeTypes = PublicSchema['CompositeTypes']

type OverrideTable<Table, Row, Insert, Update> = Omit<Table, 'Row' | 'Insert' | 'Update'> & {
  Row: Row
  Insert: Insert
  Update: Update
}

export type CharacterVisibility = PublicEnums['character_visibility']
export type MessageRole = 'system' | 'user' | 'assistant'
export type Provider =
  | 'google'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'openrouter'
  | 'voyage_embeddings'
export type LlmProvider = Exclude<Provider, 'voyage_embeddings'>
export type EmbeddingOnlyProvider = Exclude<Provider, LlmProvider>
export type ApiServiceTier = 'batch' | 'flex' | 'priority' | 'standard'
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'
export type AnnouncementSeverity = 'info' | 'warning' | 'critical'
export type SummaryStatus = 'ok' | 'fallback'

type RawProfileTable = PublicTables['profiles']
type RawApiKeyTable = PublicTables['api_keys']
type RawCharacterTable = PublicTables['characters']
type RawAnnouncementTable = PublicTables['announcements']
type RawMessageTable = PublicTables['messages']
type RawChatFactsTable = PublicTables['chat_facts']
type RawChatSummaryTable = PublicTables['chat_summaries']
type RawChatTurnTable = PublicTables['chat_turns']

type ProfileRow = RawProfileTable['Row']
type ProfileInsertRow = RawProfileTable['Insert']
type ProfileUpdateRow = RawProfileTable['Update']

type ApiKeyRow = RawApiKeyTable['Row']
type ApiKeyInsertRow = RawApiKeyTable['Insert']
type ApiKeyUpdateRow = RawApiKeyTable['Update']

type CharacterRow = RawCharacterTable['Row']
type CharacterInsertRow = RawCharacterTable['Insert']
type CharacterUpdateRow = RawCharacterTable['Update']

type AnnouncementRow = RawAnnouncementTable['Row']
type AnnouncementInsertRow = RawAnnouncementTable['Insert']
type AnnouncementUpdateRow = RawAnnouncementTable['Update']

type MessageRow = RawMessageTable['Row']
type MessageInsertRow = RawMessageTable['Insert']
type MessageUpdateRow = RawMessageTable['Update']

type ChatFactsRow = RawChatFactsTable['Row']
type ChatFactsInsertRow = RawChatFactsTable['Insert']
type ChatFactsUpdateRow = RawChatFactsTable['Update']

type ChatSummaryRow = RawChatSummaryTable['Row']
type ChatSummaryInsertRow = RawChatSummaryTable['Insert']
type ChatSummaryUpdateRow = RawChatSummaryTable['Update']

type ChatTurnRow = RawChatTurnTable['Row']
type ChatTurnInsertRow = RawChatTurnTable['Insert']
type ChatTurnUpdateRow = RawChatTurnTable['Update']

export type Profile = ProfileRow
export type ProfileInsert = ProfileInsertRow
export type ProfileUpdate = ProfileUpdateRow

export type ApiKey = Omit<ApiKeyRow, 'provider' | 'service_tier' | 'reasoning_effort'> & {
  provider: Provider
  service_tier: ApiServiceTier
  reasoning_effort: ReasoningEffort | null
}
export type ApiKeyInsert = Omit<
  ApiKeyInsertRow,
  'provider' | 'service_tier' | 'reasoning_effort'
> & {
  provider: Provider
  service_tier?: ApiServiceTier
  reasoning_effort?: ReasoningEffort | null
}
export type ApiKeyUpdate = Omit<
  ApiKeyUpdateRow,
  'provider' | 'service_tier' | 'reasoning_effort'
> & {
  provider?: Provider
  service_tier?: ApiServiceTier
  reasoning_effort?: ReasoningEffort | null
}

export type Character = Omit<CharacterRow, 'visibility'> & {
  visibility: CharacterVisibility
}
export type CharacterInsert = Omit<CharacterInsertRow, 'visibility'> & {
  visibility?: CharacterVisibility
}
export type CharacterUpdate = Omit<CharacterUpdateRow, 'visibility'> & {
  visibility?: CharacterVisibility
}

export type Announcement = Omit<AnnouncementRow, 'severity'> & {
  severity: AnnouncementSeverity
}
export type AnnouncementInsert = Omit<AnnouncementInsertRow, 'severity'> & {
  severity?: AnnouncementSeverity
}
export type AnnouncementUpdate = Omit<AnnouncementUpdateRow, 'severity'> & {
  severity?: AnnouncementSeverity
}

export type Message = Omit<MessageRow, 'role'> & {
  role: MessageRole
}
export type MessageInsert = Omit<MessageInsertRow, 'role'> & {
  role: MessageRole
}
export type MessageUpdate = Omit<MessageUpdateRow, 'role'> & {
  role?: MessageRole
}

export type ChatTurn = ChatTurnRow
export type ChatTurnInsert = ChatTurnInsertRow
export type ChatTurnUpdate = ChatTurnUpdateRow

export type ChatFacts = Omit<ChatFactsRow, 'embedding'> & {
  embedding: number[] | null
}
export type ChatFactsInsert = Omit<ChatFactsInsertRow, 'embedding'> & {
  embedding?: number[] | null
}
export type ChatFactsUpdate = Omit<ChatFactsUpdateRow, 'embedding'> & {
  embedding?: number[] | null
}

export type ChatSummary = Omit<ChatSummaryRow, 'summary_status'> & {
  summary_status: SummaryStatus
}
export type ChatSummaryInsert = Omit<ChatSummaryInsertRow, 'summary_status'> & {
  summary_status?: SummaryStatus
}
export type ChatSummaryUpdate = Omit<ChatSummaryUpdateRow, 'summary_status'> & {
  summary_status?: SummaryStatus
}

export interface Database extends Omit<GeneratedDatabase, 'public'> {
  public: Omit<PublicSchema, 'Tables' | 'Functions' | 'Enums' | 'CompositeTypes'> & {
    Tables: Omit<
      PublicTables,
      | 'announcements'
      | 'api_keys'
      | 'characters'
      | 'chat_facts'
      | 'chat_summaries'
      | 'messages'
    > & {
      announcements: OverrideTable<
        RawAnnouncementTable,
        Announcement,
        AnnouncementInsert,
        AnnouncementUpdate
      >
      api_keys: OverrideTable<RawApiKeyTable, ApiKey, ApiKeyInsert, ApiKeyUpdate>
      characters: OverrideTable<RawCharacterTable, Character, CharacterInsert, CharacterUpdate>
      chat_facts: OverrideTable<RawChatFactsTable, ChatFacts, ChatFactsInsert, ChatFactsUpdate>
      chat_summaries: OverrideTable<
        RawChatSummaryTable,
        ChatSummary,
        ChatSummaryInsert,
        ChatSummaryUpdate
      >
      messages: OverrideTable<RawMessageTable, Message, MessageInsert, MessageUpdate>
    }
    Functions: Omit<PublicFunctions, 'match_chat_facts' | 'update_character_with_modules'> & {
      match_chat_facts: Omit<PublicFunctions['match_chat_facts'], 'Args'> & {
        Args: Omit<PublicFunctions['match_chat_facts']['Args'], 'query_embedding'> & {
          query_embedding: number[]
        }
      }
      update_character_with_modules: Omit<
        PublicFunctions['update_character_with_modules'],
        'Args'
      > & {
        Args: Omit<
          PublicFunctions['update_character_with_modules']['Args'],
          'p_greeting_message'
        > & {
          p_greeting_message: string | null
        }
      }
    }
    Enums: PublicEnums
    CompositeTypes: PublicCompositeTypes
  }
}

type AppPublicSchema = Database['public']
type AppPublicTables = AppPublicSchema['Tables']
type AppPublicFunctions = AppPublicSchema['Functions']
type AppPublicEnums = AppPublicSchema['Enums']
type AppPublicCompositeTypes = AppPublicSchema['CompositeTypes']

export type Tables<TableName extends keyof AppPublicTables> = AppPublicTables[TableName]['Row']
export type TablesInsert<TableName extends keyof AppPublicTables> =
  AppPublicTables[TableName]['Insert']
export type TablesUpdate<TableName extends keyof AppPublicTables> =
  AppPublicTables[TableName]['Update']
export type Enums<EnumName extends keyof AppPublicEnums> = AppPublicEnums[EnumName]
export type CompositeTypes<CompositeName extends keyof AppPublicCompositeTypes> =
  AppPublicCompositeTypes[CompositeName]

export type Preset = Tables<'presets'>
export type PresetInsert = TablesInsert<'presets'>
export type PresetUpdate = TablesUpdate<'presets'>

export type CharacterPreset = Tables<'character_presets'>
export type CharacterPresetInsert = TablesInsert<'character_presets'>
export type CharacterPresetUpdate = TablesUpdate<'character_presets'>

export type CharacterAsset = Tables<'character_assets'>
export type CharacterAssetInsert = TablesInsert<'character_assets'>
export type CharacterAssetUpdate = TablesUpdate<'character_assets'>

export type Module = Tables<'modules'>
export type ModuleInsert = TablesInsert<'modules'>
export type ModuleUpdate = TablesUpdate<'modules'>

export type CharacterModule = Tables<'character_modules'>
export type CharacterModuleInsert = TablesInsert<'character_modules'>
export type CharacterModuleUpdate = TablesUpdate<'character_modules'>

export type ModuleAsset = Tables<'module_assets'>
export type ModuleAssetInsert = TablesInsert<'module_assets'>
export type ModuleAssetUpdate = TablesUpdate<'module_assets'>

export type GlobalVariable = Tables<'global_variables'>
export type GlobalVariableInsert = TablesInsert<'global_variables'>
export type GlobalVariableUpdate = TablesUpdate<'global_variables'>

export type Chat = Tables<'chats'>
export type ChatInsert = TablesInsert<'chats'>
export type ChatUpdate = TablesUpdate<'chats'>

export type ChatUsageEvent = Tables<'chat_usage_events'>
export type ChatUsageEventInsert = TablesInsert<'chat_usage_events'>
export type ChatUsageEventUpdate = TablesUpdate<'chat_usage_events'>

export type Persona = Tables<'personas'>
export type PersonaInsert = TablesInsert<'personas'>
export type PersonaUpdate = TablesUpdate<'personas'>

export type UserFeedback = Tables<'user_feedback'>
export type UserFeedbackInsert = TablesInsert<'user_feedback'>
export type UserFeedbackUpdate = TablesUpdate<'user_feedback'>

export type CharacterWithOwner = Character & {
  profiles: Profile
}

export type ChatWithCharacter = Chat & {
  characters: Character
}

export type ChatWithMessages = Chat & {
  messages: Message[]
}

export type MessageWithChat = Message & {
  chats: Chat
}

export type DatabaseFunctionArgs<FunctionName extends keyof AppPublicFunctions> =
  AppPublicFunctions[FunctionName]['Args']

export type DatabaseFunctionReturns<FunctionName extends keyof AppPublicFunctions> =
  AppPublicFunctions[FunctionName]['Returns']
