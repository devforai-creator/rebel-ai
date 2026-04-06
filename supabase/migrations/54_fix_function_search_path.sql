-- ============================================
-- Fix function search_path for all public functions
-- Sets search_path = '' to prevent search path hijacking
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
-- ============================================

-- 1. update_updated_at_column (from 00_initial_schema.sql)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. handle_new_user (from 00_initial_schema.sql)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

-- 3. get_decrypted_secret (from 04_secure_get_decrypted_secret.sql)
CREATE OR REPLACE FUNCTION public.get_decrypted_secret(
  secret_name text,
  requester uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  effective_requester uuid;
  secret_value text;
BEGIN
  effective_requester := coalesce(requester, auth.uid());

  IF effective_requester IS NULL THEN
    RAISE EXCEPTION 'Not authorized'
      USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.api_keys
    WHERE vault_secret_name = secret_name
      AND user_id = effective_requester
  ) THEN
    RAISE EXCEPTION 'Not authorized'
      USING errcode = '42501';
  END IF;

  SELECT decrypted_secret
    INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name;

  IF secret_value IS NULL THEN
    RAISE EXCEPTION 'Secret not found'
      USING errcode = 'P0002';
  END IF;

  RETURN secret_value;
END;
$$;

-- 4. update_updated_at (from 09_risuai_preset_module_system.sql)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 5. get_character_asset_url (from 12_simulation_characters_support.sql)
CREATE OR REPLACE FUNCTION public.get_character_asset_url(asset_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  storage_path_val text;
  bucket_name text := 'character-assets';
BEGIN
  SELECT storage_path INTO storage_path_val
  FROM public.character_assets
  WHERE id = asset_id;

  IF storage_path_val IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN current_setting('app.settings.supabase_url', true)
    || '/storage/v1/object/public/'
    || bucket_name
    || '/'
    || storage_path_val;
END;
$$;

-- 6. get_character_assets (from 12_simulation_characters_support.sql)
CREATE OR REPLACE FUNCTION public.get_character_assets(p_character_id uuid)
RETURNS TABLE (
  id uuid,
  asset_type text,
  file_name text,
  display_name text,
  public_url text,
  content_type text,
  file_size integer,
  metadata jsonb,
  display_order integer
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.id,
    ca.asset_type,
    ca.file_name,
    ca.display_name,
    public.get_character_asset_url(ca.id) AS public_url,
    ca.content_type,
    ca.file_size,
    ca.metadata,
    ca.display_order
  FROM public.character_assets ca
  WHERE ca.character_id = p_character_id
  ORDER BY ca.asset_type, ca.display_order, ca.file_name;
END;
$$;

-- 7. update_lorebook_overrides_updated_at (from 13_lorebook_overrides.sql)
CREATE OR REPLACE FUNCTION public.update_lorebook_overrides_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 8. update_personas_updated_at (from 14_personas.sql)
CREATE OR REPLACE FUNCTION public.update_personas_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 9. set_charx_import_job_updated_at (from 21_charx_import_jobs.sql)
CREATE OR REPLACE FUNCTION public.set_charx_import_job_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 10. set_message_user_id (from 26_fix_realtime_rls.sql)
CREATE OR REPLACE FUNCTION public.set_message_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 11. set_chat_summary_user_id (from 26_fix_realtime_rls.sql)
CREATE OR REPLACE FUNCTION public.set_chat_summary_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 12. update_lorebook_overrides_v2_updated_at (from 48_lorebook_overrides_v2.sql)
CREATE OR REPLACE FUNCTION public.update_lorebook_overrides_v2_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 13. set_risum_import_job_updated_at (from 49_risum_import_jobs.sql)
CREATE OR REPLACE FUNCTION public.set_risum_import_job_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
