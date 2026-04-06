-- ============================================
-- Fix RLS policies to use (SELECT auth.uid()) for better performance
-- Prevents re-evaluation of auth.uid() for each row
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
--
-- IMPORTANT: This migration preserves the exact same access logic as before,
-- only wrapping auth.uid() in (SELECT ...) for performance optimization.
-- ============================================

-- ============================================
-- 1. profiles
-- ============================================
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (id = (SELECT auth.uid()));

-- ============================================
-- 2. api_keys
-- ============================================
DROP POLICY IF EXISTS "Users can view their own API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can insert their own API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can update their own API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can delete their own API keys" ON public.api_keys;

CREATE POLICY "Users can view their own API keys" ON public.api_keys
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their own API keys" ON public.api_keys
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own API keys" ON public.api_keys
  FOR UPDATE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own API keys" ON public.api_keys
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 3. characters (preserving visibility/archived_at logic from 05_allow_starter_characters.sql)
-- ============================================
DROP POLICY IF EXISTS "View own or starter characters" ON public.characters;
DROP POLICY IF EXISTS "Users can create own characters" ON public.characters;
DROP POLICY IF EXISTS "Users can update own characters" ON public.characters;
DROP POLICY IF EXISTS "Users can delete own characters" ON public.characters;

CREATE POLICY "View own or starter characters" ON public.characters
  FOR SELECT USING (
    (
      user_id IS NULL
      AND visibility = 'public'
      AND archived_at IS NULL
    )
    OR user_id = (SELECT auth.uid())
    OR (visibility = 'public' AND archived_at IS NULL)
  );

CREATE POLICY "Users can create own characters" ON public.characters
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND user_id = (SELECT auth.uid())
    AND user_id IS NOT NULL
  );

CREATE POLICY "Users can update own characters" ON public.characters
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()) AND user_id IS NOT NULL)
  WITH CHECK (user_id = (SELECT auth.uid()) AND user_id IS NOT NULL);

CREATE POLICY "Users can delete own characters" ON public.characters
  FOR DELETE USING (user_id = (SELECT auth.uid()) AND user_id IS NOT NULL);

-- ============================================
-- 4. chats (preserving public character access from 53_security_immutable_job_fields.sql)
-- ============================================
DROP POLICY IF EXISTS "Users can view their own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can update their own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can delete their own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can create chats with owned or public characters" ON public.chats;

CREATE POLICY "Users can view their own chats" ON public.chats
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own chats" ON public.chats
  FOR UPDATE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own chats" ON public.chats
  FOR DELETE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can create chats with owned or public characters" ON public.chats
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.characters
      WHERE characters.id = character_id
      AND (
        characters.user_id = (SELECT auth.uid())
        OR characters.visibility = 'public'
      )
    )
  );

-- ============================================
-- 5. messages
-- ============================================
DROP POLICY IF EXISTS "Users can view their messages" ON public.messages;
DROP POLICY IF EXISTS "Users can insert their messages" ON public.messages;
DROP POLICY IF EXISTS "Users can delete their messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their messages" ON public.messages;

CREATE POLICY "Users can view their messages" ON public.messages
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their messages" ON public.messages
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their messages" ON public.messages
  FOR DELETE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their messages" ON public.messages
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================
-- 6. chat_summaries
-- ============================================
DROP POLICY IF EXISTS "Users can view their summaries" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can insert their summaries" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can delete their summaries" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can update their summaries" ON public.chat_summaries;

CREATE POLICY "Users can view their summaries" ON public.chat_summaries
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their summaries" ON public.chat_summaries
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their summaries" ON public.chat_summaries
  FOR DELETE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their summaries" ON public.chat_summaries
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================
-- 7. chat_usage_events
-- ============================================
DROP POLICY IF EXISTS "Users can view their usage events" ON public.chat_usage_events;
DROP POLICY IF EXISTS "Users can insert their usage events" ON public.chat_usage_events;

CREATE POLICY "Users can view their usage events" ON public.chat_usage_events
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their usage events" ON public.chat_usage_events
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================
-- 8. presets
-- ============================================
DROP POLICY IF EXISTS "Users can view own presets" ON public.presets;
DROP POLICY IF EXISTS "Users can insert own presets" ON public.presets;
DROP POLICY IF EXISTS "Users can update own presets" ON public.presets;
DROP POLICY IF EXISTS "Users can delete own presets" ON public.presets;

CREATE POLICY "Users can view own presets" ON public.presets
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own presets" ON public.presets
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own presets" ON public.presets
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own presets" ON public.presets
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 9. modules
-- ============================================
DROP POLICY IF EXISTS "Users can view own modules" ON public.modules;
DROP POLICY IF EXISTS "Users can insert own modules" ON public.modules;
DROP POLICY IF EXISTS "Users can update own modules" ON public.modules;
DROP POLICY IF EXISTS "Users can delete own modules" ON public.modules;

CREATE POLICY "Users can view own modules" ON public.modules
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own modules" ON public.modules
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own modules" ON public.modules
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own modules" ON public.modules
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 10. global_variables
-- ============================================
DROP POLICY IF EXISTS "Users can view own global variables" ON public.global_variables;
DROP POLICY IF EXISTS "Users can insert own global variables" ON public.global_variables;
DROP POLICY IF EXISTS "Users can update own global variables" ON public.global_variables;
DROP POLICY IF EXISTS "Users can delete own global variables" ON public.global_variables;

CREATE POLICY "Users can view own global variables" ON public.global_variables
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own global variables" ON public.global_variables
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own global variables" ON public.global_variables
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own global variables" ON public.global_variables
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 11. character_presets
-- ============================================
DROP POLICY IF EXISTS "Users can view own character presets" ON public.character_presets;
DROP POLICY IF EXISTS "Users can manage own character presets" ON public.character_presets;

CREATE POLICY "Users can view own character presets" ON public.character_presets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.characters
      WHERE characters.id = character_presets.character_id
        AND characters.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can manage own character presets" ON public.character_presets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.characters
      WHERE characters.id = character_presets.character_id
        AND characters.user_id = (SELECT auth.uid())
    )
  );

-- ============================================
-- 12. character_modules
-- ============================================
DROP POLICY IF EXISTS "Users can view own character modules" ON public.character_modules;
DROP POLICY IF EXISTS "Users can manage own character modules" ON public.character_modules;

CREATE POLICY "Users can view own character modules" ON public.character_modules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.characters
      WHERE characters.id = character_modules.character_id
        AND characters.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can manage own character modules" ON public.character_modules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.characters
      WHERE characters.id = character_modules.character_id
        AND characters.user_id = (SELECT auth.uid())
    )
  );

-- ============================================
-- 13. lorebook_overrides
-- ============================================
DROP POLICY IF EXISTS "Users can view their own lorebook overrides" ON public.lorebook_overrides;
DROP POLICY IF EXISTS "Users can insert their own lorebook overrides" ON public.lorebook_overrides;
DROP POLICY IF EXISTS "Users can update their own lorebook overrides" ON public.lorebook_overrides;
DROP POLICY IF EXISTS "Users can delete their own lorebook overrides" ON public.lorebook_overrides;

CREATE POLICY "Users can view their own lorebook overrides" ON public.lorebook_overrides
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their own lorebook overrides" ON public.lorebook_overrides
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own lorebook overrides" ON public.lorebook_overrides
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own lorebook overrides" ON public.lorebook_overrides
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 14. lorebook_overrides_v2
-- ============================================
DROP POLICY IF EXISTS "Users can view their own lorebook overrides v2" ON public.lorebook_overrides_v2;
DROP POLICY IF EXISTS "Users can insert their own lorebook overrides v2" ON public.lorebook_overrides_v2;
DROP POLICY IF EXISTS "Users can update their own lorebook overrides v2" ON public.lorebook_overrides_v2;
DROP POLICY IF EXISTS "Users can delete their own lorebook overrides v2" ON public.lorebook_overrides_v2;

CREATE POLICY "Users can view their own lorebook overrides v2" ON public.lorebook_overrides_v2
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their own lorebook overrides v2" ON public.lorebook_overrides_v2
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own lorebook overrides v2" ON public.lorebook_overrides_v2
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own lorebook overrides v2" ON public.lorebook_overrides_v2
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 15. personas
-- ============================================
DROP POLICY IF EXISTS "Users can view their own personas" ON public.personas;
DROP POLICY IF EXISTS "Users can create their own personas" ON public.personas;
DROP POLICY IF EXISTS "Users can update their own personas" ON public.personas;
DROP POLICY IF EXISTS "Users can delete their own personas" ON public.personas;

CREATE POLICY "Users can view their own personas" ON public.personas
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can create their own personas" ON public.personas
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own personas" ON public.personas
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own personas" ON public.personas
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 16. charx_import_jobs (NO UPDATE policy - intentionally blocked)
-- ============================================
DROP POLICY IF EXISTS "Users can access their CharX jobs" ON public.charx_import_jobs;
DROP POLICY IF EXISTS "Users can enqueue CharX jobs" ON public.charx_import_jobs;
DROP POLICY IF EXISTS "Users can delete their CharX jobs" ON public.charx_import_jobs;

CREATE POLICY "Users can access their CharX jobs" ON public.charx_import_jobs
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can enqueue CharX jobs" ON public.charx_import_jobs
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their CharX jobs" ON public.charx_import_jobs
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- Note: UPDATE policy intentionally not created here.
-- "Users can view but not update CharX jobs" with USING(false) from 53_security_immutable_job_fields.sql
-- is preserved for security.

-- ============================================
-- 17. risum_import_jobs (NO UPDATE policy - intentionally blocked)
-- ============================================
DROP POLICY IF EXISTS "Users can access their risum jobs" ON public.risum_import_jobs;
DROP POLICY IF EXISTS "Users can enqueue risum jobs" ON public.risum_import_jobs;
DROP POLICY IF EXISTS "Users can delete their risum jobs" ON public.risum_import_jobs;

CREATE POLICY "Users can access their risum jobs" ON public.risum_import_jobs
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can enqueue risum jobs" ON public.risum_import_jobs
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their risum jobs" ON public.risum_import_jobs
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- Note: UPDATE policy intentionally not created here.
-- "Users can view but not update risum jobs" with USING(false) from 53_security_immutable_job_fields.sql
-- is preserved for security.

-- ============================================
-- 18. chat_generation_jobs (simple user_id check, no character_id)
-- ============================================
DROP POLICY IF EXISTS "Users can view their chat jobs" ON public.chat_generation_jobs;
DROP POLICY IF EXISTS "Users can insert chat jobs" ON public.chat_generation_jobs;

CREATE POLICY "Users can view their chat jobs" ON public.chat_generation_jobs
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert chat jobs" ON public.chat_generation_jobs
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================
-- 19. chat_facts
-- ============================================
DROP POLICY IF EXISTS "Users can view their own chat facts" ON public.chat_facts;
DROP POLICY IF EXISTS "Users can insert their own chat facts" ON public.chat_facts;
DROP POLICY IF EXISTS "Users can delete their own chat facts" ON public.chat_facts;
DROP POLICY IF EXISTS "Users can update their own chat facts" ON public.chat_facts;

CREATE POLICY "Users can view their own chat facts" ON public.chat_facts
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert their own chat facts" ON public.chat_facts
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete their own chat facts" ON public.chat_facts
  FOR DELETE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own chat facts" ON public.chat_facts
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================
-- 20. announcements
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can read announcements" ON public.announcements;

CREATE POLICY "Authenticated users can read announcements" ON public.announcements
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

-- ============================================
-- 21. user_feedback
-- ============================================
DROP POLICY IF EXISTS "users can insert their own feedback" ON public.user_feedback;
DROP POLICY IF EXISTS "users can read their own feedback" ON public.user_feedback;
DROP POLICY IF EXISTS "admins can review all feedback" ON public.user_feedback;

CREATE POLICY "users can insert their own feedback" ON public.user_feedback
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "users can read their own feedback" ON public.user_feedback
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "admins can review all feedback" ON public.user_feedback
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_admin = true
    )
  );

-- ============================================
-- 22. module_assets (preserving AND logic from 51_module_assets.sql)
-- ============================================
DROP POLICY IF EXISTS "Users can view own module assets" ON public.module_assets;
DROP POLICY IF EXISTS "Users can insert own module assets" ON public.module_assets;
DROP POLICY IF EXISTS "Users can update own module assets" ON public.module_assets;
DROP POLICY IF EXISTS "Users can delete own module assets" ON public.module_assets;

CREATE POLICY "Users can view own module assets" ON public.module_assets
  FOR SELECT USING (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.modules
      WHERE modules.id = module_assets.module_id
        AND modules.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own module assets" ON public.module_assets
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.modules
      WHERE modules.id = module_assets.module_id
        AND modules.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own module assets" ON public.module_assets
  FOR UPDATE
  USING (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.modules
      WHERE modules.id = module_assets.module_id
        AND modules.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.modules
      WHERE modules.id = module_assets.module_id
        AND modules.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete own module assets" ON public.module_assets
  FOR DELETE USING (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.modules
      WHERE modules.id = module_assets.module_id
        AND modules.user_id = (SELECT auth.uid())
    )
  );

-- ============================================
-- 23. character_assets
-- ============================================
DROP POLICY IF EXISTS "Users can view own character assets" ON public.character_assets;
DROP POLICY IF EXISTS "Users can insert own character assets" ON public.character_assets;
DROP POLICY IF EXISTS "Users can update own character assets" ON public.character_assets;
DROP POLICY IF EXISTS "Users can delete own character assets" ON public.character_assets;

CREATE POLICY "Users can view own character assets" ON public.character_assets
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can insert own character assets" ON public.character_assets
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own character assets" ON public.character_assets
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own character assets" ON public.character_assets
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================
-- 24. Storage: character-assets bucket (exact names from 08_character_assets_storage.sql)
-- ============================================
DROP POLICY IF EXISTS "Users can upload to their own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;

CREATE POLICY "Users can upload to their own folder" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'character-assets'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own files" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'character-assets'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own files" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'character-assets'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

-- ============================================
-- 25. Storage: charx-uploads bucket (exact names from 20_charx_upload_bucket.sql)
-- ============================================
DROP POLICY IF EXISTS "Users can upload their CharX archives" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their CharX archives" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their CharX archives" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their CharX archives" ON storage.objects;

CREATE POLICY "Users can upload their CharX archives" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'charx-uploads'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their CharX archives" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'charx-uploads'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their CharX archives" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'charx-uploads'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can read their CharX archives" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'charx-uploads'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

-- ============================================
-- 26. Storage: module-assets bucket (exact names from 51_module_assets.sql)
-- ============================================
DROP POLICY IF EXISTS "Module assets: users can upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Module assets: users can update own files" ON storage.objects;
DROP POLICY IF EXISTS "Module assets: users can delete own files" ON storage.objects;

CREATE POLICY "Module assets: users can upload to own folder" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'module-assets'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Module assets: users can update own files" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'module-assets'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Module assets: users can delete own files" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'module-assets'
    AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
  );
