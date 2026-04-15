# Database Schema Documentation

This document provides a comprehensive reference for the RebelAI database schema. It covers all tables, relationships, storage buckets, RPC functions, and security policies.

**Last Updated:** 2025-11-19 (v0.7.4)

---

## Table of Contents

1. [Overview](#overview)
2. [Core Tables](#core-tables)
3. [Compatibility & Extension Tables](#compatibility--extension-tables)
4. [Feature Tables](#feature-tables)
5. [Storage Buckets](#storage-buckets)
6. [RPC Functions](#rpc-functions)
7. [Security & RLS](#security--rls)
8. [Migration History](#migration-history)

---

## Overview

RebelAI uses a PostgreSQL database hosted on Supabase with the following key features:

- **Row Level Security (RLS)**: All tables have RLS enabled for security
- **Supabase Vault**: API keys are encrypted in Vault (never stored in plain text)
- **BYOK Architecture**: Users bring their own API keys (Google, OpenAI, Anthropic)
- **Compatibility Tables**: Preset/module tables remain available for archived imports and optional compatibility workflows
- **Hierarchical Memory**: Chat summaries with 3-level hierarchy for long-term context

---

## Core Tables

### `profiles`

User profile information (extends `auth.users`).

**Columns:**

- `id` (uuid, PK): References `auth.users(id)`
- `username` (text, unique): User's unique username
- `display_name` (text): Display name
- `avatar_url` (text): Profile picture URL
- `chunk_summary_prompt` (text, nullable): Custom prompt for chunk summaries
- `meta_summary_prompt` (text, nullable): Custom prompt for meta summaries
- `fact_extraction_prompt` (text, nullable): Custom prompt for episodic fact extraction
- `voyage_embedding_api_key_id` (uuid, nullable): Voyage Embeddings API key reference
- `summary_api_key_id` (uuid, nullable, FK → api_keys): Optional API key dedicated to summary generation
- `enable_episodic_rag` (boolean, default `false`): Whether to enable episodic RAG via Voyage embeddings
- `is_admin` (boolean, default `false`): Access to operator-only dashboard/actions
- `created_at`, `updated_at` (timestamptz)

**Relationships:**

- 1:many with `api_keys`, `characters`, `chats`, `personas`

**RLS:**

- Users can view/update/insert their own profile only

**Triggers:**

- `handle_new_user()`: Auto-creates profile when user signs up

---

### `api_keys`

Encrypted API key storage using Supabase Vault.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles): Owner of the API key
- `provider` (text): 'google' | 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'voyage_embeddings'
- `key_name` (text): User-friendly name
- `vault_secret_name` (text, unique): Reference to Vault secret (NEVER exposed to client)
- `model_preference` (text): User's preferred model for this key
- `service_tier` (text): OpenAI service tier ('standard' | 'flex' | 'priority' | 'batch'), defaults to `standard`
- `is_active` (boolean): Whether this key is active
- `usage_notes` (text): Optional notes
- `last_used_at` (timestamptz)
- `created_at`, `updated_at` (timestamptz)

**Security:**

- Actual API key values are stored in `vault.secrets` table (encrypted)
- `vault_secret_name` is NEVER sent to client (server-side lookups only)
- Decryption requires `service_role` access (see RPC Functions)

**Constraints:**

- Unique per user: `(user_id, key_name)`

**RLS:**

- Users can CRUD their own API keys only

---

### `characters`

AI character definitions with system prompts.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles): Creator of the character
- `name` (text): Character name
- `avatar_url` (text): Character avatar image URL (Supabase Storage)
- `description` (text): Short description/summary
- `system_prompt` (text): Core AI instructions
- `greeting_message` (text): First message (optional)
- `visibility` (enum): 'private' | 'draft' | 'public'
- `metadata` (jsonb): Additional runtime/import metadata (post-history instructions, SUU UI payloads validated during RBX import, compatibility fields, etc.)
- `archived_at` (timestamptz): Soft delete timestamp
- `created_at`, `updated_at` (timestamptz)

**Metadata Structure:**

```json
{
  "post_history_instructions": "string",
  "alternate_greetings": ["greeting1", "greeting2"],
  "default_variables": {
    "mood": "calm"
  },
  "lorebook": [...],  // Legacy compatibility field for imported content
  "ui_card": { "...": "..." },
  "ui_cards": {
    "status": { "...": "..." }
  },
  "image_display": { "...": "..." }
}
```

**Relationships:**

- Many:many with `presets` via `character_presets`
- Many:many with `modules` via `character_modules`
- 1:many with `chats`

**RLS:**

- Users can view their own + public characters
- Users can CRUD their own characters only

---

### `charx_import_jobs`

Legacy-named queue backing the current character import pipeline. Each job is user-scoped and stores staged import metadata plus provenance fields for auditing.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles): Owner/uploader of the staged import file
- `storage_path` (text): Supabase Storage path inside legacy `charx-uploads/{user_id}/...`
- `original_filename` (text)
- `file_type` (text, nullable): MIME type detected during upload
- `preset_id` (uuid, nullable): Preset to apply after import (ownership validated)
- `module_ids` (text[], default `[]`): Modules to enable after import (ownership validated)
- `rights_status` (text, enum): `'self_owned'` or `'third_party_with_license'`
- `rights_attested` (boolean): Whether the user confirmed redistribution rights
- `license_type` (text, nullable): Human-readable license label (e.g., `CC BY 4.0`)
- `license_url` (text, nullable): Link to the license text or proof of permission
- `license_notes` (text, nullable): Free-form attribution or approval notes
- `source_url` (text, nullable): Original source link for third-party imports
- `source_label` (text, nullable): Friendly label for the source or uploader
- `status` (text): `'pending' | 'processing' | 'success' | 'error'`
- `error_message` (text, nullable)
- `result` (jsonb, nullable): Import stats payload
- `created_at`, `updated_at`, `started_at`, `completed_at` (timestamptz)

**RLS:**

- Users can only insert/select/delete jobs where `user_id = auth.uid()`
- User updates are blocked after enqueue; status transitions are handled by privileged workers
- Storage path is validated to ensure users cannot reference another user's staged upload

**Notes:**

- Runner claims jobs FIFO and deletes staged uploads after processing
- Rights metadata enables DMCA responses and ensures third-party imports document redistribution permission before processing

---

### `chats`

Chat sessions linking users, characters, and personas.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles)
- `character_id` (uuid, FK → characters)
- `persona_id` (uuid, FK → personas, nullable): Optional persona for this chat
- `title` (text): Chat title
- `custom_system_prompt` (text, nullable): User-provided override for the global system prompt (per chat)
- `max_context_messages` (int, default 20): Context window size
- `model_config` (jsonb): Model settings for this chat
- `created_at`, `updated_at` (timestamptz)

**Relationships:**

- 1:many with `messages`
- 1:many with `chat_summaries`
- 1:many with `global_variables`
- 1:many with `lorebook_overrides`

**RLS:**

- Users can CRUD their own chats only

---

### `messages`

Individual chat messages with token tracking.

**Columns:**

- `id` (uuid, PK)
- `chat_id` (uuid, FK → chats)
- `sequence` (bigint, auto-increment): Message order within chat
- `role` (text): 'system' | 'user' | 'assistant'
- `content` (text): Message text. The active chat UI renders constrained markdown, asset tokens, and RBX/SUU inline UI; raw HTML is not part of the supported authoring contract.
- `model_used` (text): Which model generated this response
- `prompt_tokens` (int): Tokens in prompt
- `completion_tokens` (int): Tokens in completion
- `latency_ms` (int): Response time
- `error_code` (text): Error identifier if failed
- `created_at` (timestamptz)

**Indexes:**

- `(chat_id, sequence DESC)`: Fast retrieval of recent messages
- `(chat_id, created_at DESC)`: Chronological ordering

**RLS:**

- Users can view/insert/delete messages in their own chats only

**Note:** Messages can contain HTML (v0.4.7+) which is sanitized with `isomorphic-dompurify` before display.

---

## Compatibility & Extension Tables

These tables support optional preset/module workflows and archived compatibility data. They remain part of the schema, but they are not the primary public product identity.

### `presets`

Preset records containing template-based prompt assembly data. In current RebelAI framing, treat them as optional compatibility/extension tables rather than the primary authoring path.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `name` (text): Preset name
- `description` (text)
- `prompt_template` (jsonb): Array of template blocks
- `config` (jsonb): Model configuration
- `toggle_definitions` (jsonb): Ordered array of toggle definitions (v0.4.8+)
- `source_file` (text): Original imported preset filename
- `risup_version` (int): Compatibility version marker for imported preset data
- `created_at`, `updated_at` (timestamptz)

**Template Block Structure:**

```json
{
  "type": "plain" | "chat" | "jailbreak",
  "text": "template content with {{variables}}",
  "role": "system" | "user" | "assistant",
  "type2": "normal" | "globalNote" | "main",
  "name": "block name"
}
```

**Config Fields:**

- `temperature`, `maxContext`, `maxResponse`
- `frequencyPenalty`, `presencePenalty`
- `formattingOrder`: Array of prompt component order
- `mainPrompt`, `jailbreak`, `globalNote`, `authorNote`
- `apiModel`, `subModel`, `apiType`

**RLS:**

- Users can CRUD their own presets only

---

### `modules`

Module records providing toggleable lorebook/regex/asset extensions. These remain useful for compatibility and migration workflows, but new RebelAI-native packaging should prefer RBX.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `name` (text)
- `description` (text)
- `toggle_definitions` (jsonb): Module-specific toggles
- `lorebook` (jsonb[]): Array of lorebook entries
- `regex` (jsonb[]): Input/output transformations
- `triggers` (jsonb[]): Event-triggered scripts
- `assets` (jsonb[]): Module asset metadata (names/types). Binary assets live in `module_assets`.
- `hide_icon` (boolean)
- `source_file` (text)
- `created_at`, `updated_at` (timestamptz)

**Lorebook Entry Structure:**

```json
{
  "key": "trigger,keywords",
  "content": "template content",
  "comment": "description",
  "insertorder": 100,
  "alwaysActive": false,
  "selective": true,
  "secondkey": "additional,keywords",
  "useRegex": false,
  "probability": 100,
  "activationMsg": 0,
  "scanDepth": 5
}
```

**Regex Entry:**

```json
{
  "type": "editinput" | "editoutput",
  "script": "text.replace(/pattern/g, 'replacement')",
  "ableFlag": true
}
```

**Trigger Entry:**

```json
{
  "type": "start" | "manual" | "aftergen",
  "script": "JavaScript code",
  "comment": "description"
}
```

**RLS:**

- Users can CRUD their own modules only

---

### `module_assets`

Module-level assets stored once and shared across characters.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `module_id` (uuid, FK → modules)
- `file_name` (text): Original filename from .risum
- `storage_path` (text): Path in `module-assets` storage bucket
- `content_type` (text)
- `file_size` (int)
- `display_name` (text)
- `display_order` (int)
- `metadata` (jsonb): aliases, generation info
- `created_at`, `updated_at` (timestamptz)

**RLS:**

- Users can manage assets for their own modules only

---

### `character_presets`

Links characters to presets (1:1 relationship).

**Columns:**

- `character_id` (uuid, PK, FK → characters)
- `preset_id` (uuid, PK, FK → presets)
- `active` (boolean): Whether preset is active
- `created_at` (timestamptz)

**RLS:**

- Users can manage links for their own characters only

---

### `character_modules`

Links characters to modules (many:many with priority).

**Columns:**

- `id` (uuid, PK)
- `character_id` (uuid, FK → characters)
- `module_id` (uuid, FK → modules)
- `enabled` (boolean): Whether module is enabled
- `priority` (int, default 0): Higher = applied first
- `created_at`, `updated_at` (timestamptz)

**Constraints:**

- Unique per character-module pair

**RLS:**

- Users can manage links for their own characters only

---

### `global_variables`

Runtime state for template variables (chat-scoped).

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `chat_id` (uuid, FK → chats)
- `key` (text): Variable name (e.g., `toggle_use_chapters`)
- `value` (jsonb): Supports string, number, boolean
- `updated_at` (timestamptz)

**Constraints:**

- Unique per chat: `(chat_id, key)`

**Usage:**

- Module toggles are stored here (prefixed with `toggle_`)
- Template functions like `{{getglobalvar::key}}` read from this table

**RLS:**

- Users can CRUD their own variables only

---

## Feature Tables

### `chat_facts`

Episodic memory for chats - stores concrete facts extracted from conversations.

**Columns:**

- `id` (uuid, PK)
- `chat_id` (uuid, FK → chats)
- `user_id` (uuid, FK → auth.users)
- `start_seq` (int): Starting message sequence number
- `end_seq` (int): Ending message sequence number
- `facts` (text): Plain text bullet points of concrete facts
- `created_at` (timestamptz)

**Purpose:**

- Complements `chat_summaries` (semantic memory) by preserving detailed information
- Stores specific dates, places, foods, preferences, promises, and emotionally significant moments
- Facts are extracted by LLM from message chunks (same 10-message boundaries as summaries)
- Prevents loss of concrete details that would be abstracted away in summaries

**Example facts:**

```
- First meeting on November 10, 2025, eating tteokbokki at 'Meko Restaurant'
- User said they enjoy spicy food
- Character is afraid of cats
```

**Constraints:**

- Unique per chat: `(chat_id, start_seq, end_seq)`

**RLS:**

- Users can view/insert/delete facts for their own chats only

---

### `chat_summaries`

Hierarchical long-term memory for chats (semantic memory).

**Columns:**

- `id` (uuid, PK)
- `chat_id` (uuid, FK → chats)
- `level` (int): 0 (base), 1 (mid), 2 (top)
- `start_seq` (int): Starting message sequence
- `end_seq` (int): Ending message sequence
- `summary` (text): AI-generated summary
- `token_count` (int): Estimated token count
- `created_at` (timestamptz)

**Hierarchy:**

- Level 0: Summaries of 20 messages
- Level 1: Summaries of 5 Level-0 summaries (100 messages)
- Level 2: Summaries of 5 Level-1 summaries (500 messages)

**Constraints:**

- Unique per chat: `(chat_id, level, start_seq)`

**RLS:**

- Users can view/insert/delete summaries for their own chats

---

### `lorebook_overrides`

Per-chat overrides for lorebook entry activation.

**Columns:**

- `id` (uuid, PK)
- `chat_id` (uuid, FK → chats)
- `user_id` (uuid, FK → auth.users)
- `entry_key` (text): Lorebook entry key (keywords)
- `entry_insertorder` (int): Lorebook entry insertorder
- `enabled` (boolean): Force enable (true) or disable (false)
- `created_at`, `updated_at` (timestamptz)

**Constraints:**

- Unique per entry per chat: `(chat_id, entry_key, entry_insertorder)`

**Behavior:**

- Default: Use module's lorebook settings
- Override: Use user's explicit preference
- Priority: Override > AlwaysActive > Keyword Matching

**RLS:**

- Users can CRUD their own overrides only

---

### `personas`

User-created persona profiles for roleplay.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `name` (text, 1-100 chars): Short name (e.g., "Student Mode")
- `description` (text, 1-5000 chars, nullable): Free-text persona details
- `created_at`, `updated_at` (timestamptz)

**Usage:**

- Users can create multiple personas
- Selected when starting a new chat
- Injected into system prompt as `[User Information]` section
- `{{user}}` placeholder in greetings is replaced with persona name

**RLS:**

- Users can CRUD their own personas only

---

### `announcements`

Broadcast table for system-wide emergency announcements. All authenticated users can read, but writing/updating is restricted to service role (or Supabase Dashboard).

**Columns:**

- `id` (uuid, PK)
- `message` (text): Announcement body. Rendered with `whitespace-pre-line` on client to preserve line breaks.
- `cta_label` (text, nullable): Button label (e.g., "Learn more")
- `cta_url` (text, nullable): External link. If not provided, button is not rendered.
- `severity` (enum text): `'info' | 'warning' | 'critical'`. Affects banner color/icon.
- `is_active` (boolean): Whether currently visible
- `starts_at` (timestamptz): Visibility start time (default: now())
- `ends_at` (timestamptz, nullable): Auto-hides after this time
- `author_user_id` (uuid, nullable, FK → profiles): Operator who created the announcement
- `created_at`, `updated_at` (timestamptz)

**Usage:**

- Manage emergency patches/pricing changes/service outage announcements as data
- Use `starts_at`/`ends_at` to schedule in advance or auto-terminate

**RLS:**

- Select: `auth.uid() IS NOT NULL` (only logged-in users can view)
- Insert/Update: No policy → only service_role (admin client, Supabase Dashboard) allowed

**Indexes & Triggers:**

- `idx_announcements_active_window`: `(is_active, starts_at DESC, ends_at)`
- `update_announcements_updated_at` trigger keeps `updated_at` fresh

---

### `user_feedback`

Simple feedback portal. Collects feedback from anywhere in the dashboard.

**Columns:**

- `id` (uuid, PK)
- `user_id` (uuid, FK → profiles, cascade delete): Author
- `message` (text): 500 character limit. Whitespace trimmed before saving on server
- `source_page` (text, nullable): Input location (`/dashboard`, `/chats/:id`, etc.)
- `created_at` (timestamptz): Default `now()`

**Usage:**

- Saved via server action from client (no `/api/internal` bypass needed)
- Future Admin Dashboard will filter by `profiles.is_admin` for full viewing
- Quickly identify retention barriers, reflect in roadmap/announcements

**RLS:**

- Insert: `auth.uid() = user_id`
- Select: Only the author can view their own
- Select (admins): Accounts with `profiles.is_admin = true` can view all

**Indexes:**

- `idx_user_feedback_user_created_at`: User/time reverse index

---

## Storage Buckets

### `character-assets`

Stores imported character card assets.

**Settings:**

- Public read access
- 20MB per file limit
- Allowed types: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`

**Structure:**

```
character-assets/
  {user_id}/
    {timestamp}-avatar-{filename}.png
    {timestamp}-background-{filename}.jpg
    {timestamp}-{emotion_name}.png
```

**RLS Policies:**

- Users can upload to their own folder: `{user_id}/*`
- Users can update/delete their own files
- Everyone can read (public bucket)

---

## RPC Functions

### Vault Helper Functions

All Vault functions are `SECURITY DEFINER` and restricted to authenticated users.

#### `create_secret(secret_name text, secret_value text)`

**Purpose:** Store an API key in Supabase Vault (encrypted).

**Returns:** `uuid` (secret ID)

**Security:**

- Requires authentication
- No ownership check (used during API key creation)

**Usage:**

```sql
SELECT create_secret('api_key_userid_google_1234567890', 'actual-api-key-here');
```

---

#### `get_decrypted_secret(secret_name text, requester uuid)`

**Purpose:** Retrieve decrypted API key from Vault.

**Returns:** `text` (decrypted API key)

**Security:**

- **v0.1.5+**: Restricted to `service_role` ONLY
- Blocks `authenticated` and `anon` roles
- Explicit `requester` parameter for ownership validation
- Server-side only (prevents XSS/browser exfiltration)

**Error Codes:**

- `42501`: Not authorized (wrong user)
- `P0002`: Secret not found

**Usage (server-side with admin client):**

```typescript
const adminSupabase = createAdminClient()
const { data } = await adminSupabase.rpc('get_decrypted_secret', {
  secret_name: apiKeyData.vault_secret_name,
  requester: user.id,
})
```

---

#### `delete_secret(secret_name text)`

**Purpose:** Delete a secret from Vault.

**Returns:** `void`

**Security:**

- Requires authentication
- Verifies user owns the API key associated with `secret_name`

**Error Codes:**

- `42501`: Not authorized

---

## Security & RLS

### Row Level Security (RLS)

All tables have RLS enabled with policies enforcing:

1. **User Isolation**: Users can only access their own data
2. **Chat Ownership**: Messages/summaries verified via `chats.user_id`
3. **Character Access**: Own characters + public characters
4. **Vault Security**: API keys never exposed to client

### Security Patterns

#### Server Actions

```typescript
'use server'
import { createClient } from '@/lib/supabase/server'

export async function myAction(formData: FormData) {
  const supabase = await createClient()

  // ALWAYS verify authentication
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  // Use user_id filter for ownership
  const { data } = await supabase.from('table').select().eq('user_id', user.id)
}
```

#### API Key Decryption

```typescript
// ONLY in Node.js Runtime routes with admin client
import { createAdminClient } from '@/lib/supabase/admin'

const adminSupabase = createAdminClient() // Uses SERVICE_ROLE_KEY
const { data: secretData } = await adminSupabase.rpc('get_decrypted_secret', {
  secret_name: apiKeyData.vault_secret_name,
  requester: user.id, // Explicit ownership validation
})
```

#### Realtime + RLS (v0.6.2+)

**Critical**: Supabase Realtime **cannot evaluate complex RLS policies** with subqueries or JOINs.

❌ **Won't work with Realtime**:

```sql
-- RLS policy with JOIN/subquery
CREATE POLICY "policy_name" ON messages
USING (
  EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
);
```

✅ **Required for Realtime**:

```sql
-- Direct column comparison
CREATE POLICY "policy_name" ON messages
USING (user_id = auth.uid());
```

**Pattern**: Denormalize `user_id` to child tables:

- Add `user_id` column (references `auth.users`)
- Create trigger to auto-populate from parent table
- Use simple `user_id = auth.uid()` RLS policy
- Set `REPLICA IDENTITY FULL` for RLS evaluation

**Client-side requirements**:

```typescript
const setupChannel = async () => {
  // REQUIRED: Refresh auth session before channel creation
  await supabase.auth.getSession()

  const channel = supabase.channel(name, {
    config: {
      broadcast: { self: true },
      presence: { key: '' },
    },
  })
  // ...
}
```

**Reference**: Keep deployment-specific debugging notes in a separate operator runbook if you maintain one.

### Security Checklist

**Server Action:**

- [ ] `auth.getUser()` verification
- [ ] `user_id` filtering
- [ ] Client input validation

**RPC Function:**

- [ ] `SECURITY DEFINER` with `auth.uid()` check
- [ ] Ownership verification
- [ ] Service role restriction (for sensitive operations)

**API Route:**

- [ ] Input validation (zod recommended)
- [ ] Authentication check
- [ ] Resource ownership verification

---

## Migration History

| File                                     | Version | Description                                                   |
| ---------------------------------------- | ------- | ------------------------------------------------------------- |
| `00_initial_schema.sql`                  | 0.1.0   | Core tables (profiles, api_keys, characters, chats, messages) |
| `01_vault_helpers.sql`                   | 0.1.0   | Vault RPC functions for API key encryption                    |
| `02_update_vault_delete_secret.sql`      | 0.1.2   | Added ownership check to `delete_secret()`                    |
| `03_chat_summaries.sql`                  | 0.1.1   | Hierarchical long-term memory system                          |
| `04_secure_get_decrypted_secret.sql`     | 0.1.5   | Restricted `get_decrypted_secret` to service_role             |
| `05_allow_starter_characters.sql`        | 0.2.0   | Allow NULL user_id for starter characters                     |
| `06_rate_limit_and_vault_audit.sql`      | 0.2.0   | Rate limiting + vault audit logging                           |
| `07_persistent_anon_rate_limit.sql`      | 0.2.0   | Anonymous rate limiting with persistent storage               |
| `08_character_assets_storage.sql`        | 0.2.0   | Storage bucket for character avatars/assets                   |
| `09_risuai_preset_module_system.sql`     | 0.3.0   | Compatibility preset/module system tables                     |
| `10_preset_toggle_definitions.sql`       | 0.3.0   | Ordered toggle definitions in presets                         |
| `11_message_debug_info.sql`              | 0.3.0   | Debug info for LLM I/O inspection                             |
| `12_simulation_characters_support.sql`   | 0.4.0   | Multi-character simulation metadata                           |
| `13_lorebook_overrides.sql`              | 0.4.0   | Per-chat lorebook entry overrides                             |
| `14_personas.sql`                        | 0.4.7   | User persona profiles                                         |
| `14_personas_fix.sql`                    | 0.4.7   | Fix persona table constraints                                 |
| `27_chat_facts_table.sql`                | 0.6.6   | Episodic memory system (chat_facts table)                     |
| `28_fact_extraction_prompt.sql`          | 0.6.6   | Custom fact extraction prompt in profiles                     |
| `37_announcements.sql`                   | 0.7.3   | Broadcast announcements table for emergency notices           |
| `38_profiles_admin_flag.sql`             | 0.7.3   | Admin flag on profiles for operator dashboards                |
| `39_user_feedback.sql`                   | 0.7.4   | Lightweight in-product feedback inbox                         |
| `40_api_key_service_tier.sql`            | 0.8.0   | API key service tier support                                  |
| `41_chat_usage_event_costs.sql`          | 0.8.0   | Chat usage event cost tracking                                |
| `42_profiles_summary_api_key.sql`        | 0.8.0   | Profile summary API key preference                            |
| `43_character_assets_canonical_name.sql` | 0.9.x   | Canonical name column for {{assetlist}} template              |
| `51_module_assets.sql`                   | 0.9.x   | Module assets bucket + module_assets table                    |

---

## Quick Reference

### Entity Relationships

```
auth.users (Supabase Auth)
  └─→ profiles (1:1)
       ├─→ api_keys (1:many)
       ├─→ characters (1:many)
       │    ├─→ character_presets (many:many via presets)
       │    ├─→ character_modules (many:many via modules)
       │    └─→ chats (1:many)
       │         ├─→ messages (1:many)
       │         ├─→ chat_facts (1:many - episodic memory)
       │         ├─→ chat_summaries (1:many - semantic memory)
       │         ├─→ global_variables (1:many)
       │         └─→ lorebook_overrides (1:many)
       ├─→ modules (1:many)
       │    └─→ module_assets (1:many)
       └─→ personas (1:many)

vault.secrets (Supabase Vault)
  ←─ api_keys.vault_secret_name (reference only, never exposed)

storage.objects (Supabase Storage)
  ├─→ character-assets bucket
       └─→ {user_id}/* (avatars, emotions, backgrounds)
  └─→ module-assets bucket
       └─→ {user_id}/{module_id}/* (shared module assets)
```

### Common Queries

**Get character with all relations:**

```sql
SELECT
  c.*,
  cp.preset_id,
  p.name as preset_name,
  array_agg(m.name) as module_names
FROM characters c
LEFT JOIN character_presets cp ON cp.character_id = c.id
LEFT JOIN presets p ON p.id = cp.preset_id
LEFT JOIN character_modules cm ON cm.character_id = c.id
LEFT JOIN modules m ON m.id = cm.module_id
WHERE c.user_id = auth.uid()
GROUP BY c.id, cp.preset_id, p.name;
```

**Get chat with recent messages:**

```sql
SELECT
  c.*,
  ch.name as character_name,
  (
    SELECT json_agg(m.* ORDER BY m.sequence DESC)
    FROM messages m
    WHERE m.chat_id = c.id
    LIMIT 20
  ) as recent_messages
FROM chats c
JOIN characters ch ON ch.id = c.character_id
WHERE c.user_id = auth.uid()
ORDER BY c.updated_at DESC;
```

**Get active modules for a character:**

```sql
SELECT m.*
FROM modules m
JOIN character_modules cm ON cm.module_id = m.id
WHERE cm.character_id = $1
  AND cm.enabled = true
ORDER BY cm.priority DESC;
```

---

## Notes for Developers

1. **Never expose `vault_secret_name` to client** - Server lookups only
2. **Always use RLS policies** - Don't bypass with service_role unless necessary
3. **Token counting**: Use conservative estimation (char_length ÷ 3) for mixed Korean/English
4. **Active rendering surface**: Keep new content on plain text, asset tokens, and Safe UGC UI surfaces; do not reintroduce raw HTML execution paths.
5. **Lorebook activation order**: Override > AlwaysActive > Keyword Matching
6. **System prompt order**: compatibility preset blocks (when used) → `post_history_instructions` → `character.system_prompt` → `[User Information]` (persona)

---

**For more implementation details, see:**

- `SUPABASE_SETUP.md` - Initial setup instructions
- `SECURITY.md` - Current security boundaries and operational safeguards
- `docs/rbx-spec.md` - RBX notes and implementation entrypoint
