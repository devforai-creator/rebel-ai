-- Make fresh projects and resets independent of Supabase's former automatic
-- public-schema table grants. Keep RLS and existing RPC grants unchanged.
-- Use an explicit inventory so future tables still require an access decision.

grant select on table public.characters to anon;

grant select, insert, update, delete on table
  public.api_keys,
  public.character_assets,
  public.character_modules,
  public.character_presets,
  public.characters,
  public.chat_facts,
  public.chat_summaries,
  public.chat_turns,
  public.chats,
  public.global_variables,
  public.lorebook_overrides,
  public.lorebook_overrides_v2,
  public.messages,
  public.module_assets,
  public.modules,
  public.personas,
  public.presets
to authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select on table public.announcements to authenticated;
grant select, insert on table
  public.chat_generation_jobs,
  public.chat_usage_events,
  public.user_feedback
to authenticated;

-- Import status/payload updates remain runner-only, as required by their RLS.
grant select, insert, delete on table
  public.charx_import_jobs,
  public.risum_import_jobs
to authenticated;

-- Internal ledgers and worker state have no client-facing access path.
revoke all on table
  public.anon_rate_limits,
  public.chat_rate_limits,
  public.local_chat_worker_status,
  public.service_health_status,
  public.vault_secret_audit
from public, anon, authenticated;

-- BYPASSRLS does not bypass table ACLs: server supabase-js clients need grants too.
grant select, insert, update, delete on table
  public.announcements,
  public.anon_rate_limits,
  public.api_keys,
  public.character_assets,
  public.character_modules,
  public.character_presets,
  public.characters,
  public.charx_import_jobs,
  public.chat_facts,
  public.chat_generation_jobs,
  public.chat_rate_limits,
  public.chat_summaries,
  public.chat_turns,
  public.chat_usage_events,
  public.chats,
  public.global_variables,
  public.local_chat_worker_status,
  public.lorebook_overrides,
  public.lorebook_overrides_v2,
  public.messages,
  public.module_assets,
  public.modules,
  public.personas,
  public.presets,
  public.profiles,
  public.risum_import_jobs,
  public.user_feedback,
  public.vault_secret_audit
to service_role;

grant select, insert, update on table public.service_health_status to service_role;

-- Sequence privileges are separate from table privileges.
grant usage, select on sequence public.messages_sequence_seq to authenticated, service_role;
