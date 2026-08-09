export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      announcements: {
        Row: {
          author_user_id: string | null
          created_at: string
          cta_label: string | null
          cta_url: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          message: string
          severity: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          author_user_id?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          message: string
          severity?: string
          starts_at?: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          message?: string
          severity?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'announcements_author_user_id_fkey'
            columns: ['author_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      anon_rate_limits: {
        Row: {
          identifier: string
          request_count: number
          window_start: string
        }
        Insert: {
          identifier: string
          request_count?: number
          window_start: string
        }
        Update: {
          identifier?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_name: string
          last_used_at: string | null
          model_preference: string | null
          provider: string
          reasoning_effort: string | null
          service_tier: string
          updated_at: string
          usage_notes: string | null
          user_id: string
          vault_secret_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_name: string
          last_used_at?: string | null
          model_preference?: string | null
          provider: string
          reasoning_effort?: string | null
          service_tier?: string
          updated_at?: string
          usage_notes?: string | null
          user_id: string
          vault_secret_name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_name?: string
          last_used_at?: string | null
          model_preference?: string | null
          provider?: string
          reasoning_effort?: string | null
          service_tier?: string
          updated_at?: string
          usage_notes?: string | null
          user_id?: string
          vault_secret_name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'api_keys_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      character_assets: {
        Row: {
          asset_type: string
          canonical_name: string | null
          character_id: string
          content_type: string | null
          created_at: string
          display_name: string | null
          display_order: number | null
          file_name: string
          file_size: number | null
          id: string
          metadata: Json | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_type: string
          canonical_name?: string | null
          character_id: string
          content_type?: string | null
          created_at?: string
          display_name?: string | null
          display_order?: number | null
          file_name: string
          file_size?: number | null
          id?: string
          metadata?: Json | null
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_type?: string
          canonical_name?: string | null
          character_id?: string
          content_type?: string | null
          created_at?: string
          display_name?: string | null
          display_order?: number | null
          file_name?: string
          file_size?: number | null
          id?: string
          metadata?: Json | null
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'character_assets_character_id_fkey'
            columns: ['character_id']
            isOneToOne: false
            referencedRelation: 'characters'
            referencedColumns: ['id']
          },
        ]
      }
      character_modules: {
        Row: {
          character_id: string
          created_at: string
          enabled: boolean
          id: string
          module_id: string
          priority: number
          updated_at: string
        }
        Insert: {
          character_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          module_id: string
          priority?: number
          updated_at?: string
        }
        Update: {
          character_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          module_id?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'character_modules_character_id_fkey'
            columns: ['character_id']
            isOneToOne: false
            referencedRelation: 'characters'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'character_modules_module_id_fkey'
            columns: ['module_id']
            isOneToOne: false
            referencedRelation: 'modules'
            referencedColumns: ['id']
          },
        ]
      }
      character_presets: {
        Row: {
          active: boolean
          character_id: string
          created_at: string
          preset_id: string
        }
        Insert: {
          active?: boolean
          character_id: string
          created_at?: string
          preset_id: string
        }
        Update: {
          active?: boolean
          character_id?: string
          created_at?: string
          preset_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'character_presets_character_id_fkey'
            columns: ['character_id']
            isOneToOne: false
            referencedRelation: 'characters'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'character_presets_preset_id_fkey'
            columns: ['preset_id']
            isOneToOne: false
            referencedRelation: 'presets'
            referencedColumns: ['id']
          },
        ]
      }
      characters: {
        Row: {
          archived_at: string | null
          avatar_url: string | null
          created_at: string
          description: string | null
          greeting_message: string | null
          id: string
          metadata: Json
          name: string
          system_prompt: string
          updated_at: string
          user_id: string | null
          visibility: Database['public']['Enums']['character_visibility']
        }
        Insert: {
          archived_at?: string | null
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          greeting_message?: string | null
          id?: string
          metadata?: Json
          name: string
          system_prompt: string
          updated_at?: string
          user_id?: string | null
          visibility?: Database['public']['Enums']['character_visibility']
        }
        Update: {
          archived_at?: string | null
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          greeting_message?: string | null
          id?: string
          metadata?: Json
          name?: string
          system_prompt?: string
          updated_at?: string
          user_id?: string | null
          visibility?: Database['public']['Enums']['character_visibility']
        }
        Relationships: [
          {
            foreignKeyName: 'characters_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      charx_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          file_type: string | null
          id: string
          license_notes: string | null
          license_type: string | null
          license_url: string | null
          module_ids: string[] | null
          original_filename: string
          preset_id: string | null
          result: Json | null
          rights_attested: boolean
          rights_status: string
          source_label: string | null
          source_url: string | null
          started_at: string | null
          status: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          id?: string
          license_notes?: string | null
          license_type?: string | null
          license_url?: string | null
          module_ids?: string[] | null
          original_filename: string
          preset_id?: string | null
          result?: Json | null
          rights_attested?: boolean
          rights_status?: string
          source_label?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          id?: string
          license_notes?: string | null
          license_type?: string | null
          license_url?: string | null
          module_ids?: string[] | null
          original_filename?: string
          preset_id?: string | null
          result?: Json | null
          rights_attested?: boolean
          rights_status?: string
          source_label?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'charx_import_jobs_preset_id_fkey'
            columns: ['preset_id']
            isOneToOne: false
            referencedRelation: 'presets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'charx_import_jobs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      chat_facts: {
        Row: {
          chat_id: string
          created_at: string | null
          embedding: string | null
          end_seq: number
          facts: string
          id: string
          start_seq: number
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string | null
          embedding?: string | null
          end_seq: number
          facts: string
          id?: string
          start_seq: number
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string | null
          embedding?: string | null
          end_seq?: number
          facts?: string
          id?: string
          start_seq?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_facts_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
        ]
      }
      chat_generation_jobs: {
        Row: {
          chat_id: string
          created_at: string
          delivery_mode: string
          error: string | null
          external_provider_job_id: string | null
          external_provider_last_checked_at: string | null
          external_provider_metadata: Json | null
          external_provider_result_url: string | null
          external_provider_status: string | null
          external_provider_submitted_at: string | null
          failure_stage: string | null
          id: string
          lifecycle_stage: string
          payload: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          delivery_mode?: string
          error?: string | null
          external_provider_job_id?: string | null
          external_provider_last_checked_at?: string | null
          external_provider_metadata?: Json | null
          external_provider_result_url?: string | null
          external_provider_status?: string | null
          external_provider_submitted_at?: string | null
          failure_stage?: string | null
          id?: string
          lifecycle_stage?: string
          payload: Json
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          delivery_mode?: string
          error?: string | null
          external_provider_job_id?: string | null
          external_provider_last_checked_at?: string | null
          external_provider_metadata?: Json | null
          external_provider_result_url?: string | null
          external_provider_status?: string | null
          external_provider_submitted_at?: string | null
          failure_stage?: string | null
          id?: string
          lifecycle_stage?: string
          payload?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_generation_jobs_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_generation_jobs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      chat_rate_limits: {
        Row: {
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          request_count?: number
          user_id: string
          window_start: string
        }
        Update: {
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_rate_limits_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      chat_summaries: {
        Row: {
          chat_id: string
          created_at: string
          end_seq: number
          id: string
          level: number
          start_seq: number
          summary: string
          summary_status: string
          token_count: number | null
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          end_seq: number
          id?: string
          level: number
          start_seq: number
          summary: string
          summary_status?: string
          token_count?: number | null
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          end_seq?: number
          id?: string
          level?: number
          start_seq?: number
          summary?: string
          summary_status?: string
          token_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_summaries_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
        ]
      }
      chat_turns: {
        Row: {
          active_assistant_message_id: string | null
          chat_id: string
          created_at: string
          id: string
          turn_index: number
          updated_at: string
          user_id: string
          user_message_id: string | null
        }
        Insert: {
          active_assistant_message_id?: string | null
          chat_id: string
          created_at?: string
          id?: string
          turn_index: number
          updated_at?: string
          user_id: string
          user_message_id?: string | null
        }
        Update: {
          active_assistant_message_id?: string | null
          chat_id?: string
          created_at?: string
          id?: string
          turn_index?: number
          updated_at?: string
          user_id?: string
          user_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'chat_turns_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_turns_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      chat_usage_events: {
        Row: {
          api_key_id: string | null
          cached_input_cost_usd: number
          cached_input_tokens: number | null
          chat_id: string
          completion_cost_usd: number
          completion_tokens: number | null
          created_at: string
          id: string
          model_name: string | null
          model_provider: string
          prompt_cost_usd: number
          prompt_tokens: number | null
          reasoning_cost_usd: number
          reasoning_tokens: number | null
          request_id: string
          total_cost_usd: number
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          api_key_id?: string | null
          cached_input_cost_usd?: number
          cached_input_tokens?: number | null
          chat_id: string
          completion_cost_usd?: number
          completion_tokens?: number | null
          created_at?: string
          id?: string
          model_name?: string | null
          model_provider: string
          prompt_cost_usd?: number
          prompt_tokens?: number | null
          reasoning_cost_usd?: number
          reasoning_tokens?: number | null
          request_id: string
          total_cost_usd?: number
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          api_key_id?: string | null
          cached_input_cost_usd?: number
          cached_input_tokens?: number | null
          chat_id?: string
          completion_cost_usd?: number
          completion_tokens?: number | null
          created_at?: string
          id?: string
          model_name?: string | null
          model_provider?: string
          prompt_cost_usd?: number
          prompt_tokens?: number | null
          reasoning_cost_usd?: number
          reasoning_tokens?: number | null
          request_id?: string
          total_cost_usd?: number
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_usage_events_api_key_id_fkey'
            columns: ['api_key_id']
            isOneToOne: false
            referencedRelation: 'api_keys'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_usage_events_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_usage_events_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      chats: {
        Row: {
          character_id: string
          created_at: string
          custom_system_prompt: string | null
          id: string
          last_message_at: string | null
          max_context_messages: number
          model_config: Json | null
          persona_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string
          custom_system_prompt?: string | null
          id?: string
          last_message_at?: string | null
          max_context_messages?: number
          model_config?: Json | null
          persona_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string
          custom_system_prompt?: string | null
          id?: string
          last_message_at?: string | null
          max_context_messages?: number
          model_config?: Json | null
          persona_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chats_character_id_fkey'
            columns: ['character_id']
            isOneToOne: false
            referencedRelation: 'characters'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chats_persona_id_fkey'
            columns: ['persona_id']
            isOneToOne: false
            referencedRelation: 'personas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chats_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      global_variables: {
        Row: {
          chat_id: string
          id: string
          key: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          chat_id: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
          value: Json
        }
        Update: {
          chat_id?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'global_variables_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
        ]
      }
      lorebook_overrides: {
        Row: {
          chat_id: string
          created_at: string
          enabled: boolean
          entry_insertorder: number
          entry_key: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          enabled: boolean
          entry_insertorder: number
          entry_key: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          enabled?: boolean
          entry_insertorder?: number
          entry_key?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lorebook_overrides_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
        ]
      }
      lorebook_overrides_v2: {
        Row: {
          chat_id: string
          created_at: string
          enabled: boolean
          entry_fingerprint: string
          entry_insertorder: number
          entry_key: string
          id: string
          module_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          enabled: boolean
          entry_fingerprint: string
          entry_insertorder: number
          entry_key: string
          id?: string
          module_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          enabled?: boolean
          entry_fingerprint?: string
          entry_insertorder?: number
          entry_key?: string
          id?: string
          module_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lorebook_overrides_v2_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lorebook_overrides_v2_module_id_fkey'
            columns: ['module_id']
            isOneToOne: false
            referencedRelation: 'modules'
            referencedColumns: ['id']
          },
        ]
      }
      messages: {
        Row: {
          chat_id: string
          completion_tokens: number | null
          content: string
          content_en: string | null
          created_at: string
          debug_info: Json | null
          error_code: string | null
          id: string
          latency_ms: number | null
          message_status: string
          model_used: string | null
          prompt_tokens: number | null
          role: string
          sequence: number
          supersedes_message_id: string | null
          turn_id: string | null
          user_id: string
          variant_index: number | null
        }
        Insert: {
          chat_id: string
          completion_tokens?: number | null
          content: string
          content_en?: string | null
          created_at?: string
          debug_info?: Json | null
          error_code?: string | null
          id?: string
          latency_ms?: number | null
          message_status?: string
          model_used?: string | null
          prompt_tokens?: number | null
          role: string
          sequence?: never
          supersedes_message_id?: string | null
          turn_id?: string | null
          user_id: string
          variant_index?: number | null
        }
        Update: {
          chat_id?: string
          completion_tokens?: number | null
          content?: string
          content_en?: string | null
          created_at?: string
          debug_info?: Json | null
          error_code?: string | null
          id?: string
          latency_ms?: number | null
          message_status?: string
          model_used?: string | null
          prompt_tokens?: number | null
          role?: string
          sequence?: never
          supersedes_message_id?: string | null
          turn_id?: string | null
          user_id?: string
          variant_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'messages_chat_id_fkey'
            columns: ['chat_id']
            isOneToOne: false
            referencedRelation: 'chats'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'messages_supersedes_message_id_fkey'
            columns: ['supersedes_message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'messages_turn_id_fkey'
            columns: ['turn_id']
            isOneToOne: false
            referencedRelation: 'chat_turns'
            referencedColumns: ['id']
          },
        ]
      }
      module_assets: {
        Row: {
          content_type: string | null
          created_at: string
          display_name: string | null
          display_order: number | null
          file_name: string
          file_size: number | null
          id: string
          metadata: Json | null
          module_id: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          display_name?: string | null
          display_order?: number | null
          file_name: string
          file_size?: number | null
          id?: string
          metadata?: Json | null
          module_id: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          display_name?: string | null
          display_order?: number | null
          file_name?: string
          file_size?: number | null
          id?: string
          metadata?: Json | null
          module_id?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'module_assets_module_id_fkey'
            columns: ['module_id']
            isOneToOne: false
            referencedRelation: 'modules'
            referencedColumns: ['id']
          },
        ]
      }
      modules: {
        Row: {
          assets: Json[] | null
          created_at: string
          description: string | null
          hide_icon: boolean | null
          id: string
          lorebook: Json[] | null
          name: string
          regex: Json[] | null
          source_file: string | null
          toggle_definitions: Json | null
          triggers: Json[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assets?: Json[] | null
          created_at?: string
          description?: string | null
          hide_icon?: boolean | null
          id?: string
          lorebook?: Json[] | null
          name: string
          regex?: Json[] | null
          source_file?: string | null
          toggle_definitions?: Json | null
          triggers?: Json[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assets?: Json[] | null
          created_at?: string
          description?: string | null
          hide_icon?: boolean | null
          id?: string
          lorebook?: Json[] | null
          name?: string
          regex?: Json[] | null
          source_file?: string | null
          toggle_definitions?: Json | null
          triggers?: Json[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      personas: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      presets: {
        Row: {
          config: Json | null
          created_at: string
          description: string | null
          id: string
          name: string
          prompt_template: Json
          risup_version: number | null
          source_file: string | null
          toggle_definitions: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          prompt_template?: Json
          risup_version?: number | null
          source_file?: string | null
          toggle_definitions?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          prompt_template?: Json
          risup_version?: number | null
          source_file?: string | null
          toggle_definitions?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          chunk_summary_prompt: string | null
          created_at: string
          display_name: string | null
          enable_agentic_transcript_recall_default: boolean
          enable_chat_usage_stats: boolean
          enable_episodic_rag: boolean
          fact_extraction_prompt: string | null
          id: string
          is_admin: boolean
          meta_summary_prompt: string | null
          reprocess_api_key_id: string | null
          reprocess_model_name: string | null
          reprocess_prompt: string | null
          summary_api_key_id: string | null
          summary_model_name: string | null
          translation_api_key_id: string | null
          translation_model_name: string | null
          updated_at: string
          username: string | null
          voyage_embedding_api_key_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          chunk_summary_prompt?: string | null
          created_at?: string
          display_name?: string | null
          enable_agentic_transcript_recall_default?: boolean
          enable_chat_usage_stats?: boolean
          enable_episodic_rag?: boolean
          fact_extraction_prompt?: string | null
          id: string
          is_admin?: boolean
          meta_summary_prompt?: string | null
          reprocess_api_key_id?: string | null
          reprocess_model_name?: string | null
          reprocess_prompt?: string | null
          summary_api_key_id?: string | null
          summary_model_name?: string | null
          translation_api_key_id?: string | null
          translation_model_name?: string | null
          updated_at?: string
          username?: string | null
          voyage_embedding_api_key_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          chunk_summary_prompt?: string | null
          created_at?: string
          display_name?: string | null
          enable_agentic_transcript_recall_default?: boolean
          enable_chat_usage_stats?: boolean
          enable_episodic_rag?: boolean
          fact_extraction_prompt?: string | null
          id?: string
          is_admin?: boolean
          meta_summary_prompt?: string | null
          reprocess_api_key_id?: string | null
          reprocess_model_name?: string | null
          reprocess_prompt?: string | null
          summary_api_key_id?: string | null
          summary_model_name?: string | null
          translation_api_key_id?: string | null
          translation_model_name?: string | null
          updated_at?: string
          username?: string | null
          voyage_embedding_api_key_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_reprocess_api_key_id_fkey'
            columns: ['reprocess_api_key_id']
            isOneToOne: false
            referencedRelation: 'api_keys'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_summary_api_key_id_fkey'
            columns: ['summary_api_key_id']
            isOneToOne: false
            referencedRelation: 'api_keys'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_translation_api_key_id_fkey'
            columns: ['translation_api_key_id']
            isOneToOne: false
            referencedRelation: 'api_keys'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_voyage_embedding_api_key_id_fkey'
            columns: ['voyage_embedding_api_key_id']
            isOneToOne: false
            referencedRelation: 'api_keys'
            referencedColumns: ['id']
          },
        ]
      }
      risum_import_jobs: {
        Row: {
          character_id: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          file_type: string | null
          id: string
          license_notes: string | null
          license_type: string | null
          license_url: string | null
          original_filename: string
          result: Json | null
          rights_attested: boolean
          rights_status: string
          source_label: string | null
          source_url: string | null
          started_at: string | null
          status: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          character_id: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          id?: string
          license_notes?: string | null
          license_type?: string | null
          license_url?: string | null
          original_filename: string
          result?: Json | null
          rights_attested?: boolean
          rights_status?: string
          source_label?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          character_id?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          id?: string
          license_notes?: string | null
          license_type?: string | null
          license_url?: string | null
          original_filename?: string
          result?: Json | null
          rights_attested?: boolean
          rights_status?: string
          source_label?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'risum_import_jobs_character_id_fkey'
            columns: ['character_id']
            isOneToOne: false
            referencedRelation: 'characters'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'risum_import_jobs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      service_health_status: {
        Row: {
          consecutive_failures: number
          created_at: string
          last_error_message: string | null
          last_failure_at: string | null
          last_metadata: Json | null
          last_success_at: string | null
          service_label: string
          total_failures: number
          total_successes: number
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          last_error_message?: string | null
          last_failure_at?: string | null
          last_metadata?: Json | null
          last_success_at?: string | null
          service_label: string
          total_failures?: number
          total_successes?: number
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          last_error_message?: string | null
          last_failure_at?: string | null
          last_metadata?: Json | null
          last_success_at?: string | null
          service_label?: string
          total_failures?: number
          total_successes?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_feedback: {
        Row: {
          created_at: string
          id: string
          message: string
          source_page: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          source_page?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          source_page?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_feedback_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      vault_secret_audit: {
        Row: {
          action: string
          created_at: string
          details: string | null
          id: string
          secret_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: string | null
          id?: string
          secret_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: string | null
          id?: string
          secret_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_anon_rate_limit: {
        Args: {
          identifier: string
          max_requests: number
          window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after: number
        }[]
      }
      check_chat_rate_limit: {
        Args: {
          max_requests: number
          target_user_id: string
          window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after: number
        }[]
      }
      claim_pending_chat_job: {
        Args: never
        Returns: {
          id: string
          payload: Json
        }[]
      }
      create_secret:
        | {
            Args: { secret_name: string; secret_value: string }
            Returns: string
          }
        | {
            Args: {
              requester?: string
              secret_name: string
              secret_value: string
            }
            Returns: string
          }
      delete_api_key: {
        Args: { api_key_id: string; requester?: string }
        Returns: undefined
      }
      delete_orphaned_modules: {
        Args: { module_ids: string[]; requester?: string }
        Returns: number
      }
      delete_secret:
        | { Args: { secret_name: string }; Returns: undefined }
        | {
            Args: { requester?: string; secret_name: string }
            Returns: undefined
          }
      get_chat_token_totals: {
        Args: { p_chat_id: string; p_requester: string }
        Returns: {
          completion_tokens: number
          prompt_tokens: number
        }[]
      }
      get_chat_usage_costs: {
        Args: { p_chat_id: string; p_requester: string }
        Returns: {
          cached_input_cost_usd: number
          cached_input_tokens: number
          completion_cost_usd: number
          completion_tokens: number
          prompt_cost_usd: number
          prompt_tokens: number
          reasoning_cost_usd: number
          reasoning_tokens: number
          total_cost_usd: number
        }[]
      }
      get_decrypted_secret: {
        Args: { requester?: string; secret_name: string }
        Returns: string
      }
      list_current_user_modules: {
        Args: never
        Returns: {
          asset_count: number
          created_at: string
          description: string
          hide_icon: boolean
          id: string
          lorebook_count: number
          name: string
          regex_count: number
          source_file: string
          updated_at: string
        }[]
      }
      match_chat_facts: {
        Args: {
          chat_id: string
          match_count: number
          match_threshold: number
          query_embedding: string
          target_user_id: string
        }
        Returns: {
          end_seq: number
          facts: string
          similarity: number
          start_seq: number
        }[]
      }
      recalculate_chat_last_message_at: {
        Args: { p_chat_id: string }
        Returns: undefined
      }
      record_service_health_status: {
        Args: {
          p_error_message?: string
          p_metadata?: Json
          p_service_label: string
          p_was_success: boolean
        }
        Returns: undefined
      }
      submit_chat_generation_job: {
        Args: {
          p_chat_id: string
          p_delivery_mode: string
          p_is_regeneration: boolean
          p_job_payload: Json
          p_regenerate_assistant_message_id: string
          p_requester: string
          p_turn_id: string
          p_user_message_content: string
          p_user_message_id: string
        }
        Returns: {
          job_id: string
          turn_id: string
          user_message_id: string
        }[]
      }
      update_character_with_modules: {
        Args: {
          p_character_id: string
          p_description: string
          p_greeting_message: string
          p_module_ids?: string[]
          p_name: string
          p_requester?: string
          p_system_prompt: string
        }
        Returns: undefined
      }
      validate_chat_turn_message_pointer: {
        Args: {
          p_chat_id: string
          p_expected_role: string
          p_message_id: string
          p_pointer_name: string
          p_turn_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      character_visibility: 'private' | 'draft' | 'public'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      character_visibility: ['private', 'draft', 'public'],
    },
  },
} as const
