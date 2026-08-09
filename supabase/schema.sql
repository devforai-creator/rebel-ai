-- RebelAI hosted bootstrap schema
-- Generated from supabase/migrations by scripts/build-hosted-schema.sh.
-- Source of truth: supabase/migrations
-- For hosted Supabase SQL Editor setup, enable Vault / pgsodium first if your
-- project does not already have them available.


-- >>> 00_initial_schema.sql

-- ============================================
-- CharacterChat Platform - Initial Schema
-- Phase 0 MVP Database Schema
-- ============================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- 1. Profiles (사용자 확장 정보)
-- ============================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- RLS 활성화
alter table public.profiles enable row level security;

-- RLS 정책
create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================
-- 2. API Keys (BYOK - 암호화 저장)
-- ============================================
create table public.api_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  provider text not null check (provider in ('google', 'openai', 'anthropic')),
  key_name text not null,

  -- Supabase Vault에 저장된 시크릿 이름
  vault_secret_name text unique not null,

  -- 설정
  model_preference text,
  is_active boolean default true not null,
  usage_notes text,

  -- 추적
  last_used_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,

  -- 제약
  unique(user_id, key_name)
);

-- RLS 활성화
alter table public.api_keys enable row level security;

-- RLS 정책
create policy "Users can view their own API keys"
  on public.api_keys for select
  using (auth.uid() = user_id);

create policy "Users can insert their own API keys"
  on public.api_keys for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own API keys"
  on public.api_keys for update
  using (auth.uid() = user_id);

create policy "Users can delete their own API keys"
  on public.api_keys for delete
  using (auth.uid() = user_id);

-- 인덱스
create index api_keys_user_id_idx on public.api_keys(user_id);

-- ============================================
-- 3. Characters (캐릭터)
-- ============================================
create type character_visibility as enum ('private', 'draft', 'public');

create table public.characters (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,

  -- 기본 정보
  name text not null,
  avatar_url text,
  description text,
  system_prompt text not null,
  greeting_message text,

  -- 공유 & 상태
  visibility character_visibility default 'private' not null,
  metadata jsonb default '{}'::jsonb not null,
  archived_at timestamptz,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- RLS 활성화
alter table public.characters enable row level security;

-- RLS 정책
create policy "Users can view their own and public characters"
  on public.characters for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
  );

create policy "Users can insert their own characters"
  on public.characters for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own characters"
  on public.characters for update
  using (auth.uid() = user_id);

create policy "Users can delete their own characters"
  on public.characters for delete
  using (auth.uid() = user_id);

-- 인덱스
create index characters_user_id_visibility_idx on public.characters(user_id, visibility);
create index characters_visibility_idx on public.characters(visibility) where visibility = 'public';

-- ============================================
-- 4. Chats (채팅 세션)
-- ============================================
create table public.chats (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  character_id uuid references public.characters(id) on delete cascade not null,
  title text,

  -- 컨텍스트 설정
  max_context_messages int default 20 not null check (max_context_messages > 0),

  -- 모델 설정 (챗 단위 고정)
  model_config jsonb,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- RLS 활성화
alter table public.chats enable row level security;

-- RLS 정책
create policy "Users can view their own chats"
  on public.chats for select
  using (auth.uid() = user_id);

create policy "Users can create their own chats"
  on public.chats for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own chats"
  on public.chats for update
  using (auth.uid() = user_id);

create policy "Users can delete their own chats"
  on public.chats for delete
  using (auth.uid() = user_id);

-- 인덱스
create index chats_user_id_updated_at_idx on public.chats(user_id, updated_at desc);
create index chats_character_id_idx on public.chats(character_id);

-- ============================================
-- 5. Messages (메시지)
-- ============================================
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid references public.chats(id) on delete cascade not null,

  -- 정렬 안전성 보장
  sequence bigint generated always as identity,

  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,

  -- 과금/통계 대비 메타데이터
  model_used text,
  prompt_tokens int,
  completion_tokens int,
  latency_ms int,
  error_code text,

  created_at timestamptz default now() not null
);

-- RLS 활성화
alter table public.messages enable row level security;

-- RLS 정책
create policy "Users can view messages in their chats"
  on public.messages for select
  using (
    exists (
      select 1 from public.chats
      where chats.id = messages.chat_id
      and chats.user_id = auth.uid()
    )
  );

create policy "Users can insert messages in their chats"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.chats
      where chats.id = messages.chat_id
      and chats.user_id = auth.uid()
    )
  );

create policy "Users can delete messages in their chats"
  on public.messages for delete
  using (
    exists (
      select 1 from public.chats
      where chats.id = messages.chat_id
      and chats.user_id = auth.uid()
    )
  );

-- 인덱스
create index messages_chat_id_sequence_idx on public.messages(chat_id, sequence desc);
create index messages_chat_id_created_at_idx on public.messages(chat_id, created_at desc);

-- ============================================
-- 6. Triggers (updated_at 자동 갱신)
-- ============================================
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 각 테이블에 트리거 적용
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function update_updated_at_column();

create trigger update_api_keys_updated_at
  before update on public.api_keys
  for each row execute function update_updated_at_column();

create trigger update_characters_updated_at
  before update on public.characters
  for each row execute function update_updated_at_column();

create trigger update_chats_updated_at
  before update on public.chats
  for each row execute function update_updated_at_column();

-- ============================================
-- 7. 신규 사용자 자동 프로필 생성
-- ============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

-- Auth 테이블에 트리거 생성
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- Schema Setup Complete!
-- ============================================



-- >>> 01_vault_helpers.sql

-- ============================================
-- Supabase Vault Helper Functions
-- API 키 암호화 저장을 위한 Vault RPC 함수
-- ============================================

-- 1. Vault에 시크릿 생성
create or replace function public.create_secret(secret_name text, secret_value text)
returns uuid
language plpgsql
security definer
as $$
declare
  secret_id uuid;
begin
  -- vault.create_secret 호출
  select vault.create_secret(secret_value, secret_name) into secret_id;
  return secret_id;
end;
$$;

-- 2. Vault에서 시크릿 삭제
create or replace function public.delete_secret(secret_name text)
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = auth.uid()
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  delete from vault.secrets where name = secret_name;
end;
$$;

-- 3. Vault에서 복호화된 시크릿 가져오기 (서버 전용)
create or replace function public.get_decrypted_secret(secret_name text)
returns text
language plpgsql
security definer
as $$
declare
  secret_value text;
begin
  if auth.uid() is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = auth.uid()
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select decrypted_secret into secret_value
  from vault.decrypted_secrets
  where name = secret_name;

  if secret_value is null then
    raise exception 'Secret not found'
      using errcode = 'P0002';
  end if;

  return secret_value;
end;
$$;

-- 보안: 이 함수들은 인증된 사용자만 호출 가능
revoke execute on function public.create_secret from anon, public;
revoke execute on function public.delete_secret from anon, public;
revoke execute on function public.get_decrypted_secret from anon, public;

grant execute on function public.create_secret to authenticated;
grant execute on function public.delete_secret to authenticated;
grant execute on function public.get_decrypted_secret to authenticated;



-- >>> 02_update_vault_delete_secret.sql

-- ============================================
-- Vault delete_secret ownership check refinement
-- Allows cleanup after api_keys row deletion while
-- still restricting access to the owning user.
-- ============================================

create or replace function public.delete_secret(secret_name text)
returns void
language plpgsql
security definer
as $$
declare
  requester uuid;
  expected_prefix text;
begin
  requester := auth.uid();

  if requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  expected_prefix := 'apikey_' || requester::text || '_';

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = requester
  )
  and left(secret_name, length(expected_prefix)) <> expected_prefix then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  delete from vault.secrets
  where name = secret_name;
end;
$$;



-- >>> 03_chat_summaries.sql

-- ============================================
-- Chat Summaries Table for Hierarchical Memory
-- ============================================

create table public.chat_summaries (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  level int not null check (level >= 0 and level <= 2),
  start_seq int not null check (start_seq > 0),
  end_seq int not null check (end_seq >= start_seq),
  summary text not null,
  token_count int,
  created_at timestamptz not null default now(),
  unique (chat_id, level, start_seq)
);

alter table public.chat_summaries enable row level security;

create policy "Users can view summaries for their chats"
  on public.chat_summaries
  for select
  using (
    exists (
      select 1
      from public.chats
      where chats.id = chat_id
        and chats.user_id = auth.uid()
    )
  );

create policy "Users can insert summaries for their chats"
  on public.chat_summaries
  for insert
  with check (
    exists (
      select 1
      from public.chats
      where chats.id = chat_id
        and chats.user_id = auth.uid()
    )
  );

create policy "Users can delete summaries for their chats"
  on public.chat_summaries
  for delete
  using (
    exists (
      select 1
      from public.chats
      where chats.id = chat_id
        and chats.user_id = auth.uid()
    )
  );

create index idx_chat_summaries_chat_level
  on public.chat_summaries(chat_id, level, start_seq);



-- >>> 04_secure_get_decrypted_secret.sql

-- ============================================
-- Harden get_decrypted_secret RPC so only trusted
-- service contexts can decrypt API keys.
-- ============================================

-- Drop legacy function that relied solely on auth.uid()
drop function if exists public.get_decrypted_secret(text);

create or replace function public.get_decrypted_secret(
  secret_name text,
  requester uuid default null
)
returns text
language plpgsql
security definer
as $$
declare
  effective_requester uuid;
  secret_value text;
begin
  effective_requester := coalesce(requester, auth.uid());

  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = effective_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select decrypted_secret
    into secret_value
  from vault.decrypted_secrets
  where name = secret_name;

  if secret_value is null then
    raise exception 'Secret not found'
      using errcode = 'P0002';
  end if;

  return secret_value;
end;
$$;

-- Ensure only service role can execute; block anon/authenticated contexts.
revoke all on function public.get_decrypted_secret(text, uuid) from public, anon, authenticated;
grant execute on function public.get_decrypted_secret(text, uuid) to service_role;



-- >>> 05_allow_starter_characters.sql

-- ============================================
-- Allow Starter Characters (user_id = NULL)
-- Phase 0: Enable global shared starter characters
-- ============================================

-- 1. user_id를 NULL 허용으로 변경
ALTER TABLE characters
ALTER COLUMN user_id DROP NOT NULL;

-- 2. 기존 RLS 정책 삭제 및 재생성

-- SELECT 정책: 본인 캐릭터 + 스타터 + 공개 캐릭터
DROP POLICY IF EXISTS "Users can view their own and public characters" ON characters;

CREATE POLICY "View own or starter characters"
ON characters FOR SELECT
USING (
  (
    user_id IS NULL
    AND visibility = 'public'
    AND archived_at IS NULL
  )  -- 스타터 캐릭터 (전역 공유)
  OR user_id = auth.uid()  -- 내 캐릭터
  OR (visibility = 'public' AND archived_at IS NULL)  -- 공개 캐릭터
);

-- INSERT 정책: 일반 유저는 본인 소유만, Service role은 스타터 생성 가능
DROP POLICY IF EXISTS "Users can insert their own characters" ON characters;

CREATE POLICY "Users can create own characters"
ON characters FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL        -- 인증된 유저만
  AND user_id = auth.uid()       -- 본인 ID와 일치
  AND user_id IS NOT NULL        -- user_id NULL 명시적 차단
  -- Service role은 RLS를 우회하므로 user_id=NULL 스타터 생성 가능
);

-- UPDATE 정책: 본인만 수정 (스타터는 수정 불가)
DROP POLICY IF EXISTS "Users can update their own characters" ON characters;

CREATE POLICY "Users can update own characters"
ON characters FOR UPDATE
USING (
  user_id = auth.uid()
  AND user_id IS NOT NULL
)
WITH CHECK (
  user_id = auth.uid()
  AND user_id IS NOT NULL
);

-- DELETE 정책: 본인만 삭제 (스타터는 삭제 불가)
DROP POLICY IF EXISTS "Users can delete their own characters" ON characters;

CREATE POLICY "Users can delete own characters"
ON characters FOR DELETE
USING (
  user_id = auth.uid()
  AND user_id IS NOT NULL
);

-- ============================================
-- 완료!
-- 보안 정책 요약:
-- - Service role: user_id=NULL 스타터 캐릭터 생성 가능 (RLS 우회)
-- - 일반 유저: user_id=NULL 생성 절대 불가 (명시적 차단)
-- - 일반 유저: 본인 소유(user_id = auth.uid()) 캐릭터만 생성/수정/삭제
-- - 스타터 캐릭터(user_id=NULL): 모든 유저가 읽기만 가능, 수정/삭제 불가
-- ============================================



-- >>> 06_rate_limit_and_vault_audit.sql

-- ============================================
-- Rate limiting, usage telemetry, and Vault audit hardening
-- ============================================

-- 1. Chat rate limiting ledger
create table public.chat_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0,
  constraint chat_rate_limits_pkey primary key (user_id, window_start)
);

alter table public.chat_rate_limits enable row level security;

-- 2. Usage telemetry table
create table public.chat_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  model_provider text not null,
  model_name text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  request_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.chat_usage_events enable row level security;

create policy "Users can view their usage events"
  on public.chat_usage_events for select
  using (auth.uid() = user_id);

create policy "Users can insert their usage events"
  on public.chat_usage_events for insert
  with check (auth.uid() = user_id);

create index chat_usage_events_user_created_idx
  on public.chat_usage_events(user_id, created_at desc);

-- 3. Vault audit log
create table public.vault_secret_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  secret_name text not null,
  action text not null check (action in ('create', 'delete', 'attempt_denied')),
  details text,
  created_at timestamptz not null default now()
);

alter table public.vault_secret_audit enable row level security;

-- Only service role should read audit events.
revoke all on table public.vault_secret_audit from public, anon, authenticated;

-- 4. Rate limiting function
create or replace function public.check_chat_rate_limit(
  target_user_id uuid,
  window_seconds integer,
  max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bucket_start timestamptz;
  request_total integer;
  epoch_now integer;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required'
      using errcode = '22004';
  end if;

  if window_seconds is null or window_seconds <= 0 then
    raise exception 'window_seconds must be positive'
      using errcode = '22023';
  end if;

  if max_requests is null or max_requests <= 0 then
    raise exception 'max_requests must be positive'
      using errcode = '22023';
  end if;

  epoch_now := floor(extract(epoch from now()))::integer;
  bucket_start :=
    to_timestamp((epoch_now / window_seconds) * window_seconds)::timestamptz;

  insert into public.chat_rate_limits (user_id, window_start, request_count)
    values (target_user_id, bucket_start, 1)
  on conflict (user_id, window_start)
    do update set request_count = public.chat_rate_limits.request_count + 1
    returning public.chat_rate_limits.request_count into request_total;

  if request_total <= max_requests then
    allowed := true;
    remaining := max_requests - request_total;
    retry_after := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after := window_seconds - (epoch_now % window_seconds);
  end if;

  -- Garbage collect old windows for this user (best effort)
  delete from public.chat_rate_limits
   where user_id = target_user_id
     and window_start < bucket_start - interval '1 day';

  return query select allowed, remaining, retry_after;
end;
$$;

revoke all on function public.check_chat_rate_limit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_chat_rate_limit(uuid, integer, integer)
  to service_role;

-- 5. Hardened Vault helper functions with audit logging
drop function if exists public.create_secret(text, text);

create or replace function public.create_secret(secret_name text, secret_value text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester uuid;
  secret_id uuid;
  expected_prefix text;
  suffix text;
  max_keys constant integer := 10;
  current_key_count integer;
begin
  requester := auth.uid();

  if requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated create_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || requester::text || '_';

  if left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'prefix mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if suffix !~ '^[a-z]+_[0-9]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  select count(*) into current_key_count
  from public.api_keys
  where user_id = requester;

  if current_key_count >= max_keys then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'api key quota exceeded');
    raise exception 'API key quota exceeded'
      using errcode = '54013';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (requester, secret_name, 'create', null);

  return secret_id;
end;
$$;

drop function if exists public.delete_secret(text);

create or replace function public.delete_secret(secret_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester uuid;
  expected_prefix text;
  suffix text;
  requester_prefix text;
begin
  requester := auth.uid();

  if requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated delete_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  requester_prefix := 'apikey_' || requester::text || '_';

  expected_prefix := requester_prefix;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = requester
  )
  and left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'ownership check failed');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if suffix !~ '^[a-z]+_[0-9]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  delete from vault.secrets
  where name = secret_name;

  if not found then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'secret not found');
    raise exception 'Secret not found'
      using errcode = 'P0002';
  end if;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (requester, secret_name, 'delete', null);
end;
$$;

revoke execute on function public.create_secret(text, text) from anon, public;
revoke execute on function public.delete_secret(text) from anon, public;

grant execute on function public.create_secret(text, text) to authenticated;
grant execute on function public.delete_secret(text) to authenticated;



-- >>> 07_persistent_anon_rate_limit.sql

-- ============================================
-- Persistent anonymous rate limiting
-- ============================================

create table public.anon_rate_limits (
  identifier text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  constraint anon_rate_limits_pkey primary key (identifier, window_start)
);

alter table public.anon_rate_limits enable row level security;

revoke all on table public.anon_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.anon_rate_limits to service_role;

create index anon_rate_limits_identifier_window_idx
  on public.anon_rate_limits(identifier, window_start desc);

create or replace function public.check_anon_rate_limit(
  identifier text,
  window_seconds integer,
  max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bucket_start timestamptz;
  request_total integer;
  epoch_now integer;
begin
  if identifier is null or length(identifier) = 0 then
    raise exception 'identifier is required'
      using errcode = '22004';
  end if;

  if window_seconds is null or window_seconds <= 0 then
    raise exception 'window_seconds must be positive'
      using errcode = '22023';
  end if;

  if max_requests is null or max_requests <= 0 then
    raise exception 'max_requests must be positive'
      using errcode = '22023';
  end if;

  epoch_now := floor(extract(epoch from now()))::integer;
  bucket_start :=
    to_timestamp((epoch_now / window_seconds) * window_seconds)::timestamptz;

  insert into public.anon_rate_limits (identifier, window_start, request_count)
    values (identifier, bucket_start, 1)
  on conflict (identifier, window_start)
    do update set request_count = public.anon_rate_limits.request_count + 1
    returning public.anon_rate_limits.request_count into request_total;

  if request_total <= max_requests then
    allowed := true;
    remaining := max_requests - request_total;
    retry_after := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after := window_seconds - (epoch_now % window_seconds);
  end if;

  delete from public.anon_rate_limits
   where public.anon_rate_limits.identifier = identifier
     and window_start < bucket_start - interval '1 day';

  return query select allowed, remaining, retry_after;
end;
$$;

revoke all on function public.check_anon_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_anon_rate_limit(text, integer, integer)
  to service_role;



-- >>> 08_character_assets_storage.sql

-- ============================================
-- Character Assets Storage Setup
-- Stores imported character card assets (avatars, backgrounds, etc.)
-- ============================================

-- Create storage bucket for character assets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'character-assets',
  'character-assets',
  true,  -- Public access for reading
  20971520,  -- 20MB limit per file
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

-- ============================================
-- Storage RLS Policies
-- ============================================

-- Allow users to upload to their own folders
create policy "Users can upload to their own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'character-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to update their own files
create policy "Users can update their own files"
  on storage.objects for update
  using (
    bucket_id = 'character-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to delete their own files
create policy "Users can delete their own files"
  on storage.objects for delete
  using (
    bucket_id = 'character-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow everyone to read (for public character cards)
create policy "Public read access"
  on storage.objects for select
  using (bucket_id = 'character-assets');

-- ============================================
-- Setup Complete!
-- ============================================



-- >>> 09_risuai_preset_module_system.sql

-- ============================================================================
-- RisuAI Preset/Module System
-- ============================================================================
-- This migration adds support for RisuAI-compatible preset and module system
-- enabling template-based prompts with conditional logic and toggleable extensions.
--
-- Tables:
--   - presets: Store .risup preset files (template-based prompts)
--   - modules: Store .risum module files (toggleable extensions)
--   - character_presets: Link characters to presets
--   - character_modules: Link characters to modules (with priority)
--   - global_variables: Runtime state for template variables
-- ============================================================================

-- ============================================================================
-- Presets Table
-- ============================================================================
-- Stores RisuAI preset files (.risup)
-- Presets contain template-based prompts with conditional logic

CREATE TABLE IF NOT EXISTS presets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Basic info
  name text NOT NULL,
  description text,

  -- Template content (from risup promptTemplate field)
  -- Array of {type, text, role, name} objects
  prompt_template jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Model configuration
  config jsonb DEFAULT '{}'::jsonb,
  -- Example fields in config:
  --   temperature: number (0-200, stored as integer * 100)
  --   maxContext: number
  --   maxResponse: number
  --   frequencyPenalty: number
  --   presencePenalty: number
  --   formattingOrder: string[]
  --   apiModel: string
  --   bias: array of [token, weight]

  -- Metadata
  source_file text,  -- Original .risup filename
  risup_version integer DEFAULT 2,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_presets_user_id ON presets(user_id);
CREATE INDEX idx_presets_name ON presets(name);

-- RLS Policies
ALTER TABLE presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own presets"
  ON presets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own presets"
  ON presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own presets"
  ON presets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own presets"
  ON presets FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Modules Table
-- ============================================================================
-- Stores RisuAI module files (.risum)
-- Modules provide toggleable extensions with lorebooks, regex, and scripts

CREATE TABLE IF NOT EXISTS modules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Basic info
  name text NOT NULL,
  description text,

  -- Toggle definitions (customModuleToggle from risum)
  -- These are the variables that this module sets when activated
  -- Example: {"use_chapters": true, "emotion_detail": "high"}
  toggle_definitions jsonb DEFAULT '{}'::jsonb,

  -- Module content
  lorebook jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: {key, content, comment, insertorder, alwaysActive, selective, etc}

  regex jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: {type: "editinput"|"editoutput", script, ...}

  triggers jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: {type: "start"|"manual"|"aftergen", script, ...}

  assets jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: [name, data, type]

  -- UI options
  hide_icon boolean DEFAULT false,

  -- Metadata
  source_file text,  -- Original .risum filename

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_modules_user_id ON modules(user_id);
CREATE INDEX idx_modules_name ON modules(name);

-- RLS Policies
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own modules"
  ON modules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own modules"
  ON modules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own modules"
  ON modules FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own modules"
  ON modules FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Character-Preset Relationship
-- ============================================================================
-- Links characters to presets (1:1 relationship for now)

CREATE TABLE IF NOT EXISTS character_presets (
  character_id uuid REFERENCES characters(id) ON DELETE CASCADE NOT NULL,
  preset_id uuid REFERENCES presets(id) ON DELETE CASCADE NOT NULL,

  -- Control
  active boolean DEFAULT true NOT NULL,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,

  PRIMARY KEY (character_id, preset_id)
);

-- Indexes
CREATE INDEX idx_character_presets_character ON character_presets(character_id);
CREATE INDEX idx_character_presets_preset ON character_presets(preset_id);
CREATE INDEX idx_character_presets_active ON character_presets(character_id, active);

-- RLS Policies
ALTER TABLE character_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own character presets"
  ON character_presets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_presets.character_id
      AND characters.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own character presets"
  ON character_presets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_presets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Character-Module Relationship
-- ============================================================================
-- Links characters to modules (many-to-many with priority)

CREATE TABLE IF NOT EXISTS character_modules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id uuid REFERENCES characters(id) ON DELETE CASCADE NOT NULL,
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE NOT NULL,

  -- Control
  enabled boolean DEFAULT true NOT NULL,

  -- Priority (higher = applied first, useful for toggle conflicts)
  priority integer DEFAULT 0 NOT NULL,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Unique constraint: one character-module pair
  UNIQUE(character_id, module_id)
);

-- Indexes
CREATE INDEX idx_character_modules_character ON character_modules(character_id);
CREATE INDEX idx_character_modules_module ON character_modules(module_id);
CREATE INDEX idx_character_modules_enabled ON character_modules(character_id, enabled);
CREATE INDEX idx_character_modules_priority ON character_modules(character_id, priority DESC);

-- RLS Policies
ALTER TABLE character_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own character modules"
  ON character_modules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_modules.character_id
      AND characters.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own character modules"
  ON character_modules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_modules.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Global Variables
-- ============================================================================
-- Stores runtime state for template variables
-- Scoped to chat sessions for dynamic values

CREATE TABLE IF NOT EXISTS global_variables (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,

  -- Variable
  key text NOT NULL,
  value jsonb NOT NULL,  -- Supports string, number, boolean

  -- Timestamps
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Unique constraint: one key per chat
  UNIQUE(chat_id, key)
);

-- Indexes
CREATE INDEX idx_global_variables_user_id ON global_variables(user_id);
CREATE INDEX idx_global_variables_chat_id ON global_variables(chat_id);
CREATE INDEX idx_global_variables_key ON global_variables(chat_id, key);

-- RLS Policies
ALTER TABLE global_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own global variables"
  ON global_variables FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own global variables"
  ON global_variables FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own global variables"
  ON global_variables FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own global variables"
  ON global_variables FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_presets_updated_at
  BEFORE UPDATE ON presets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_modules_updated_at
  BEFORE UPDATE ON modules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_character_modules_updated_at
  BEFORE UPDATE ON character_modules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_global_variables_updated_at
  BEFORE UPDATE ON global_variables
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE presets IS 'RisuAI preset files (.risup) with template-based prompts';
COMMENT ON TABLE modules IS 'RisuAI module files (.risum) with toggleable extensions';
COMMENT ON TABLE character_presets IS 'Links characters to presets';
COMMENT ON TABLE character_modules IS 'Links characters to modules with priority';
COMMENT ON TABLE global_variables IS 'Runtime state for template variables (chat-scoped)';

COMMENT ON COLUMN presets.prompt_template IS 'Array of template blocks from risup promptTemplate field';
COMMENT ON COLUMN presets.config IS 'Model configuration (temperature, maxContext, etc)';
COMMENT ON COLUMN modules.toggle_definitions IS 'Variables set when module is activated';
COMMENT ON COLUMN modules.lorebook IS 'Lorebook entries (also templates!)';
COMMENT ON COLUMN modules.regex IS 'Input/output post-processing scripts';
COMMENT ON COLUMN modules.triggers IS 'Event-triggered scripts (start, manual, aftergen)';
COMMENT ON COLUMN character_modules.priority IS 'Higher priority modules applied first (for conflict resolution)';
COMMENT ON COLUMN global_variables.value IS 'JSONB value supporting string, number, boolean types';



-- >>> 10_preset_toggle_definitions.sql

/**
 * Add toggle_definitions to presets table
 *
 * RisuAI presets include customPromptTemplateToggle which defines
 * toggle UI elements (checkboxes, selects, text inputs).
 * Modules reference these toggles via getglobalvar::<key>.
 */

-- Add toggle_definitions column to presets table
ALTER TABLE presets
ADD COLUMN IF NOT EXISTS toggle_definitions jsonb DEFAULT '{}'::jsonb;

-- Comment
COMMENT ON COLUMN presets.toggle_definitions IS
  'Toggle definitions from customPromptTemplateToggle. Format: {key: {label, type, value, options?}}';



-- >>> 11_message_debug_info.sql

/**
 * Add debug_info to messages table for LLM I/O logging
 *
 * Stores detailed information for debugging:
 * - Full prompt sent to LLM
 * - Raw LLM response (before regex processing)
 * - Processed response (after regex)
 * - Model configuration used
 */

-- Add debug_info column to messages table
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS debug_info jsonb DEFAULT NULL;

-- Comment
COMMENT ON COLUMN messages.debug_info IS
  'Debug information: {prompt, rawResponse, processedResponse, modelConfig, timestamp}';



-- >>> 12_simulation_characters_support.sql

-- ============================================================================
-- Simulation Characters Support
-- ============================================================================
-- This migration adds support for multi-character simulation scenarios
-- like "Alternate Hunters" (CharX v3 spec)
--
-- Changes:
--   1. Extend characters.metadata for simulation-type characters
--   2. Create character_assets table for per-character image assets
--   3. Add helper function for asset URL generation
-- ============================================================================

-- ============================================================================
-- 1. Extend Characters Metadata
-- ============================================================================
-- Add documentation for new metadata fields used by simulation characters
-- Note: JSONB columns don't need schema changes, just documentation

COMMENT ON COLUMN characters.metadata IS 'Character metadata (JSONB)
  Common fields:
    - type: "single" | "simulation" (default: "single")
    - imported_from: "charx_v1" | "charx_v2" | "charx_v3" | "tavern_png"

  Simulation-specific fields (type="simulation"):
    - character_list: string[] - List of NPC names in simulation
    - image_commands: {[name: string]: asset_id} - NPC name → asset ID mapping
    - alternate_greetings: string[] - Additional starting scenarios
    - post_history_instructions: string - Instructions for AI (image commands, etc)
    - charx_version: string - CharX spec version ("3.0", etc)
    - language_templates: object - Multi-language template variables
      - lang: string - Current language code
      - variables: {[key: string]: any} - Template variables';

-- ============================================================================
-- 2. Character Assets Table
-- ============================================================================
-- Stores per-character image assets (avatars, NPC images, backgrounds)
-- Different from modules.assets (which are module-level, not character-level)

CREATE TABLE IF NOT EXISTS character_assets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id uuid REFERENCES characters(id) ON DELETE CASCADE NOT NULL,

  -- Asset identification
  asset_type text NOT NULL,  -- 'icon' | 'character_image' | 'background' | 'other'
  file_name text NOT NULL,   -- Original filename from CharX

  -- Storage
  storage_path text NOT NULL UNIQUE,  -- Path in character-assets bucket
  content_type text,                  -- MIME type (image/png, image/webp, etc)
  file_size integer,                  -- File size in bytes

  -- Display & Organization
  display_name text,                  -- Display name (e.g., NPC name for character_image)
  display_order integer DEFAULT 0,    -- Sort order for UI listing

  -- Metadata from x_meta (NovelAI generation info, etc)
  metadata jsonb DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX idx_character_assets_character_id ON character_assets(character_id);
CREATE INDEX idx_character_assets_type ON character_assets(character_id, asset_type);
CREATE INDEX idx_character_assets_display_name ON character_assets(character_id, display_name);
CREATE INDEX idx_character_assets_storage_path ON character_assets(storage_path);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE character_assets ENABLE ROW LEVEL SECURITY;

-- Users can view assets of their own characters
CREATE POLICY "Users can view own character assets"
  ON character_assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- Users can insert assets for their own characters
CREATE POLICY "Users can insert own character assets"
  ON character_assets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- Users can update assets of their own characters
CREATE POLICY "Users can update own character assets"
  ON character_assets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- Users can delete assets of their own characters
CREATE POLICY "Users can delete own character assets"
  ON character_assets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE TRIGGER update_character_assets_updated_at
  BEFORE UPDATE ON character_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Generate public URL for character asset
-- Usage: SELECT get_character_asset_url(asset_id);
CREATE OR REPLACE FUNCTION get_character_asset_url(asset_id uuid)
RETURNS text AS $$
DECLARE
  storage_path_val text;
  bucket_name text := 'character-assets';
BEGIN
  SELECT storage_path INTO storage_path_val
  FROM character_assets
  WHERE id = asset_id;

  IF storage_path_val IS NULL THEN
    RETURN NULL;
  END IF;

  -- Return Supabase Storage public URL
  -- Format: https://<project_ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
  RETURN current_setting('app.settings.supabase_url', true)
    || '/storage/v1/object/public/'
    || bucket_name
    || '/'
    || storage_path_val;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get all assets for a character (grouped by type)
-- Usage: SELECT * FROM get_character_assets('character-uuid');
CREATE OR REPLACE FUNCTION get_character_assets(p_character_id uuid)
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
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.id,
    ca.asset_type,
    ca.file_name,
    ca.display_name,
    get_character_asset_url(ca.id) as public_url,
    ca.content_type,
    ca.file_size,
    ca.metadata,
    ca.display_order
  FROM character_assets ca
  WHERE ca.character_id = p_character_id
  ORDER BY ca.asset_type, ca.display_order, ca.file_name;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE character_assets IS 'Per-character image assets (avatars, NPC images, backgrounds)';
COMMENT ON COLUMN character_assets.asset_type IS 'Asset category: icon, character_image, background, other';
COMMENT ON COLUMN character_assets.storage_path IS 'Path in character-assets Supabase Storage bucket';
COMMENT ON COLUMN character_assets.metadata IS 'Asset metadata (NovelAI generation info, etc)';
COMMENT ON COLUMN character_assets.display_name IS 'Display name (e.g., NPC name for character images)';

COMMENT ON FUNCTION get_character_asset_url IS 'Generate public URL for character asset by ID';
COMMENT ON FUNCTION get_character_assets IS 'Get all assets for a character with public URLs';

-- ============================================================================
-- Migration Complete!
-- ============================================================================



-- >>> 13_lorebook_overrides.sql

-- ============================================================================
-- Lorebook Overrides
-- Allows users to enable/disable specific lorebook entries per chat
-- ============================================================================

-- Lorebook entry overrides per chat
-- Stores user preferences for which lorebook entries to activate
-- Default behavior: Use module's lorebook settings
-- Override behavior: Use user's explicit enable/disable preference
CREATE TABLE IF NOT EXISTS lorebook_overrides (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- References
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Lorebook entry identification
  -- We use key + insertorder to uniquely identify an entry
  entry_key text NOT NULL,
  entry_insertorder integer NOT NULL,

  -- User preference
  enabled boolean NOT NULL,

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Ensure one override per entry per chat
  UNIQUE(chat_id, entry_key, entry_insertorder)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_chat_id
  ON lorebook_overrides(chat_id);
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_user_id
  ON lorebook_overrides(user_id);

-- RLS Policies
ALTER TABLE lorebook_overrides ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own overrides
CREATE POLICY "Users can view their own lorebook overrides"
  ON lorebook_overrides
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lorebook overrides"
  ON lorebook_overrides
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lorebook overrides"
  ON lorebook_overrides
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lorebook overrides"
  ON lorebook_overrides
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_lorebook_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lorebook_overrides_updated_at
  BEFORE UPDATE ON lorebook_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_lorebook_overrides_updated_at();

-- Comments
COMMENT ON TABLE lorebook_overrides IS 'Per-chat overrides for lorebook entry activation';
COMMENT ON COLUMN lorebook_overrides.entry_key IS 'Lorebook entry key (keywords)';
COMMENT ON COLUMN lorebook_overrides.entry_insertorder IS 'Lorebook entry insertorder for uniqueness';
COMMENT ON COLUMN lorebook_overrides.enabled IS 'User preference: true = force enable, false = force disable';



-- >>> 14_personas.sql

-- ============================================================================
-- Personas Feature
-- User can create multiple personas (character profiles for themselves)
-- and select one when starting a chat
-- ============================================================================

-- Create personas table
CREATE TABLE IF NOT EXISTS public.personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT personas_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 100),
  CONSTRAINT personas_description_length CHECK (description IS NULL OR (char_length(description) >= 1 AND char_length(description) <= 5000))
);

-- Add persona_id to chats table (nullable - persona is optional)
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.personas(id) ON DELETE SET NULL;

-- Create index for faster persona lookups
CREATE INDEX IF NOT EXISTS idx_personas_user_id ON public.personas(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_persona_id ON public.chats(persona_id);

-- Enable RLS
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

-- RLS Policies for personas
CREATE POLICY "Users can view their own personas"
  ON public.personas
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own personas"
  ON public.personas
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own personas"
  ON public.personas
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own personas"
  ON public.personas
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updated_at trigger for personas
CREATE OR REPLACE FUNCTION public.update_personas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_personas_updated_at
  BEFORE UPDATE ON public.personas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_personas_updated_at();

-- Comments
COMMENT ON TABLE public.personas IS 'User-created persona profiles for roleplay';
COMMENT ON COLUMN public.personas.name IS 'Short name for the persona (e.g., "Student Mode", "Office Worker")';
COMMENT ON COLUMN public.personas.description IS 'Free-text description of the persona (name, age, appearance, personality, etc.)';
COMMENT ON COLUMN public.chats.persona_id IS 'Optional persona used in this chat';



-- >>> 15_chat_summaries_update_policy.sql

-- ============================================
-- Add UPDATE policy for chat_summaries
-- ============================================
-- Migration: 15_chat_summaries_update_policy.sql
-- Fixes: Users unable to edit their chat summaries
-- Date: 2025-11-07

create policy "Users can update summaries for their chats"
  on public.chat_summaries
  for update
  using (
    exists (
      select 1
      from public.chats
      where chats.id = chat_id
        and chats.user_id = auth.uid()
    )
  );



-- >>> 16_custom_summary_prompts.sql

-- ============================================
-- Custom Summary Prompts for Users
-- ============================================
-- Migration: 16_custom_summary_prompts.sql
-- Allows users to customize their summary generation prompts
-- Date: 2025-11-07

-- Add custom summary prompt columns to profiles table
ALTER TABLE public.profiles
  ADD COLUMN chunk_summary_prompt TEXT,
  ADD COLUMN meta_summary_prompt TEXT;

-- Add helpful comments
COMMENT ON COLUMN public.profiles.chunk_summary_prompt IS 'Custom system prompt for chunk-level summaries (10 messages). If NULL, uses default prompt.';
COMMENT ON COLUMN public.profiles.meta_summary_prompt IS 'Custom system prompt for meta-level summaries (100 messages). If NULL, uses default prompt.';



-- >>> 17_enable_realtime.sql

-- ============================================
-- Enable Realtime for chat_summaries and messages
-- ============================================
-- Migration: 17_enable_realtime.sql
-- Enables real-time subscriptions for summary and message updates
-- Date: 2025-11-07

-- Add chat_summaries to realtime publication (if not already added)
-- (Allows real-time UI updates when summaries are created/edited/deleted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'chat_summaries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_summaries;
  END IF;
END $$;

-- Add messages to realtime publication (if not already added)
-- (Allows real-time message count updates)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

-- Verify tables are in publication
-- Run this to check:
-- SELECT schemaname, tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
-- ORDER BY tablename;



-- >>> 18_realtime_replica_identity.sql

-- ============================================
-- Ensure Realtime can evaluate RLS policies
-- ============================================
-- Migration: 18_realtime_replica_identity.sql
-- Problem: Realtime drops UPDATE/DELETE events when it cannot read
--          the full row (chat_id) required by RLS policies.
-- Fix: Force Postgres to emit the full row for chat_summaries/messages.
-- Date: 2025-11-07

DO $$
BEGIN
  -- chat_summaries needs chat_id for RLS checks during updates/deletes
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_summaries'
      AND n.nspname = 'public'
      AND c.relreplident <> 'f'
  ) THEN
    ALTER TABLE public.chat_summaries REPLICA IDENTITY FULL;
  END IF;
END $$;

DO $$
BEGIN
  -- messages RLS policy also depends on chat_id, so send the full row
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'messages'
      AND n.nspname = 'public'
      AND c.relreplident <> 'f'
  ) THEN
    ALTER TABLE public.messages REPLICA IDENTITY FULL;
  END IF;
END $$;



-- >>> 19_refresh_realtime_subscription.sql

-- ============================================
-- Refresh Realtime subscription after adding tables
-- ============================================
-- Migration: 19_refresh_realtime_subscription.sql
-- Problem: ALTER PUBLICATION adds tables to the publication, but existing
--          subscribers (like supabase_realtime) don't automatically see them.
-- Fix: Refresh the subscription so it starts streaming the new tables.
-- Date: 2025-11-07

-- Note: This command is idempotent - safe to run multiple times
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_subscription WHERE subname = 'supabase_realtime'
  ) THEN
    ALTER SUBSCRIPTION supabase_realtime REFRESH PUBLICATION;
  END IF;
END $$;



-- >>> 20_charx_upload_bucket.sql

-- =====================================================
-- CharX Upload Staging Bucket
-- Stores raw user uploads before they are processed
-- =====================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'charx-uploads',
  'charx-uploads',
  false,
  157286400, -- 150MB per file (CharX archives)
  array[
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
    'application/json',
    'image/png'
  ]
)
on conflict (id) do nothing;

-- Folder layout: <user_id>/imports/<filename>

create policy "Users can upload their CharX archives"
  on storage.objects for insert
  with check (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update their CharX archives"
  on storage.objects for update
  using (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their CharX archives"
  on storage.objects for delete
  using (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read their CharX archives"
  on storage.objects for select
  using (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );



-- >>> 21_charx_import_jobs.sql

-- =====================================================
-- CharX Import Job Queue
-- Tracks background CharX processing tasks
-- =====================================================

create table if not exists public.charx_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  file_type text,
  preset_id uuid references public.presets(id) on delete set null,
  module_ids text[] default array[]::text[],
  status text not null default 'pending' check (status in ('pending', 'processing', 'success', 'error')),
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists charx_import_jobs_user_status_idx
  on public.charx_import_jobs (user_id, status, created_at desc);

alter table public.charx_import_jobs enable row level security;

create policy "Users can access their CharX jobs"
  on public.charx_import_jobs
  for select
  using (auth.uid() = user_id);

create policy "Users can enqueue CharX jobs"
  on public.charx_import_jobs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their CharX jobs"
  on public.charx_import_jobs
  for update
  using (auth.uid() = user_id);

create policy "Users can delete their CharX jobs"
  on public.charx_import_jobs
  for delete
  using (auth.uid() = user_id);

create or replace function public.set_charx_import_job_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_charx_import_job_updated_at on public.charx_import_jobs;

create trigger set_charx_import_job_updated_at
before update on public.charx_import_jobs
for each row execute function public.set_charx_import_job_updated_at();



-- >>> 22_chat_token_totals_rpc.sql

-- Chat token totals RPC for stats route

create or replace function public.get_chat_token_totals(
  p_chat_id uuid,
  p_requester uuid
)
returns table (
  prompt_tokens bigint,
  completion_tokens bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
    from public.chats
    where id = p_chat_id
      and user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
  select
    coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
    coalesce(sum(completion_tokens), 0)::bigint as completion_tokens
  from public.messages
  where chat_id = p_chat_id;
end;
$$;

revoke all on function public.get_chat_token_totals(uuid, uuid) from public;
grant execute on function public.get_chat_token_totals(uuid, uuid) to authenticated;
grant execute on function public.get_chat_token_totals(uuid, uuid) to service_role;



-- >>> 23_fix_chat_token_totals_rpc.sql

-- Qualify columns in get_chat_token_totals to avoid ambiguity errors (42702)

create or replace function public.get_chat_token_totals(
  p_chat_id uuid,
  p_requester uuid
)
returns table (
  prompt_tokens bigint,
  completion_tokens bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
      from public.chats c
     where c.id = p_chat_id
       and c.user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(m.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(m.completion_tokens), 0)::bigint as completion_tokens
    from public.messages m
   where m.chat_id = p_chat_id;
end;
$$;

revoke all on function public.get_chat_token_totals(uuid, uuid) from public;
grant execute on function public.get_chat_token_totals(uuid, uuid) to authenticated;
grant execute on function public.get_chat_token_totals(uuid, uuid) to service_role;



-- >>> 24_chat_generation_jobs.sql

-- Chat generation jobs queue for async LLM execution

create table public.chat_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'processing', 'success', 'error')),
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_chat_generation_jobs_status
  on public.chat_generation_jobs(status);

alter table public.chat_generation_jobs enable row level security;

create policy "Users can view their chat jobs"
  on public.chat_generation_jobs
  for select
  using (user_id = auth.uid());

create policy "Users can insert chat jobs"
  on public.chat_generation_jobs
  for insert
  with check (user_id = auth.uid());

create trigger update_chat_generation_jobs_updated_at
  before update on public.chat_generation_jobs
  for each row execute function update_updated_at_column();



-- >>> 25_allow_message_updates.sql

-- ============================================================================
-- 25_allow_message_updates.sql
-- Allow chat owners to edit their own user/assistant messages
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'Users can update chat messages'
  ) then
    create policy "Users can update chat messages"
      on public.messages for update
      using (
        exists (
          select 1
          from public.chats
          where chats.id = messages.chat_id
            and chats.user_id = auth.uid()
        )
      )
      with check (role in ('user', 'assistant'));
  end if;
end
$$;



-- >>> 26_fix_realtime_rls.sql

-- ============================================
-- Fix Realtime RLS: Add user_id to messages and chat_summaries
-- ============================================
-- Migration: 26_fix_realtime_rls.sql
-- Problem: Realtime cannot evaluate complex RLS policies with subqueries/JOINs
-- Solution: Denormalize user_id to messages and chat_summaries tables
-- Date: 2025-11-09

-- 1. Add user_id column to messages table
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Add user_id column to chat_summaries table
ALTER TABLE public.chat_summaries
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Backfill existing messages with user_id from chats
UPDATE public.messages
SET user_id = chats.user_id
FROM public.chats
WHERE messages.chat_id = chats.id
AND messages.user_id IS NULL;

-- 4. Backfill existing chat_summaries with user_id from chats
UPDATE public.chat_summaries
SET user_id = chats.user_id
FROM public.chats
WHERE chat_summaries.chat_id = chats.id
AND chat_summaries.user_id IS NULL;

-- 5. Make user_id NOT NULL after backfill
ALTER TABLE public.messages
ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.chat_summaries
ALTER COLUMN user_id SET NOT NULL;

-- 6. Create function to auto-set user_id on INSERT
CREATE OR REPLACE FUNCTION public.set_message_user_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-set user_id from the related chat
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.set_chat_summary_user_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-set user_id from the related chat
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create triggers to auto-populate user_id
DROP TRIGGER IF EXISTS set_message_user_id_trigger ON public.messages;
CREATE TRIGGER set_message_user_id_trigger
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_message_user_id();

DROP TRIGGER IF EXISTS set_chat_summary_user_id_trigger ON public.chat_summaries;
CREATE TRIGGER set_chat_summary_user_id_trigger
  BEFORE INSERT ON public.chat_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_chat_summary_user_id();

-- 8. Replace RLS policies with simpler ones that Realtime can evaluate

-- messages: Drop existing policies
DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can delete messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can update chat messages" ON public.messages;

-- messages: Create new simplified policies
CREATE POLICY "Users can view their messages"
  ON public.messages FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their messages"
  ON public.messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their messages"
  ON public.messages FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their messages"
  ON public.messages FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text]));

-- chat_summaries: Drop existing policies
DROP POLICY IF EXISTS "Users can view summaries for their chats" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can insert summaries for their chats" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can delete summaries for their chats" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can update summaries for their chats" ON public.chat_summaries;

-- chat_summaries: Create new simplified policies
CREATE POLICY "Users can view their summaries"
  ON public.chat_summaries FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their summaries"
  ON public.chat_summaries FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their summaries"
  ON public.chat_summaries FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their summaries"
  ON public.chat_summaries FOR UPDATE
  USING (user_id = auth.uid());

-- 9. Create index for faster user_id lookups
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_summaries_user_id ON public.chat_summaries(user_id);

-- 10. Verify the changes
COMMENT ON COLUMN public.messages.user_id IS 'Denormalized user_id for Realtime RLS compatibility';
COMMENT ON COLUMN public.chat_summaries.user_id IS 'Denormalized user_id for Realtime RLS compatibility';



-- >>> 27_chat_facts_table.sql

-- ============================================================================
-- Chat Facts (Episodic Memory) Table
-- Stores concrete, specific facts extracted from conversations
-- Complements chat_summaries (semantic memory) by preserving detailed information
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chat_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_seq int NOT NULL,
  end_seq int NOT NULL,
  facts text NOT NULL,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT chat_facts_unique_range UNIQUE (chat_id, start_seq, end_seq),
  CONSTRAINT chat_facts_valid_range CHECK (start_seq > 0 AND end_seq >= start_seq)
);

-- Indexes for efficient retrieval
CREATE INDEX idx_chat_facts_chat_id ON public.chat_facts(chat_id);
CREATE INDEX idx_chat_facts_sequence_range ON public.chat_facts(chat_id, start_seq, end_seq);

-- RLS Policies
ALTER TABLE public.chat_facts ENABLE ROW LEVEL SECURITY;

-- Users can view their own chat facts
CREATE POLICY "Users can view their own chat facts"
  ON public.chat_facts FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own chat facts
CREATE POLICY "Users can insert their own chat facts"
  ON public.chat_facts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own chat facts
CREATE POLICY "Users can delete their own chat facts"
  ON public.chat_facts FOR DELETE
  USING (user_id = auth.uid());

-- Comments
COMMENT ON TABLE public.chat_facts IS 'Episodic memory: Stores specific facts extracted from conversation chunks (e.g., dates, places, preferences) that would be lost in summaries.';
COMMENT ON COLUMN public.chat_facts.facts IS 'Plain text bullet points of concrete facts, extracted by LLM from messages in the sequence range.';
COMMENT ON COLUMN public.chat_facts.start_seq IS 'Starting message sequence number (inclusive).';
COMMENT ON COLUMN public.chat_facts.end_seq IS 'Ending message sequence number (inclusive).';



-- >>> 28_fact_extraction_prompt.sql

-- ============================================
-- Fact Extraction Prompt for Episodic Memory
-- ============================================
-- Migration: 28_fact_extraction_prompt.sql
-- Allows users to customize fact extraction prompt for episodic memory
-- Date: 2025-11-12

-- Add fact extraction prompt column to profiles table
ALTER TABLE public.profiles
  ADD COLUMN fact_extraction_prompt TEXT;

-- Add helpful comment
COMMENT ON COLUMN public.profiles.fact_extraction_prompt IS 'Custom system prompt for extracting concrete facts from conversation chunks (episodic memory). If NULL, uses default prompt.';



-- >>> 29_enable_realtime_chat_facts.sql

-- ============================================
-- Enable Realtime for chat_facts
-- ============================================
-- Migration: 29_enable_realtime_chat_facts.sql
-- Enables real-time subscriptions for chat_facts updates
-- Date: 2025-11-12

-- Add chat_facts to realtime publication (if not already added)
-- (Allows real-time UI updates when facts are created/edited/deleted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'chat_facts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_facts;
  END IF;
END $$;

-- Set replica identity to FULL for RLS to work with Realtime
-- (Required for Realtime to evaluate RLS policies correctly)
ALTER TABLE public.chat_facts REPLICA IDENTITY FULL;

-- Verify tables are in publication
-- Run this to check:
-- SELECT schemaname, tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
-- AND tablename = 'chat_facts';



-- >>> 30_add_chat_fact_embeddings.sql

-- ============================================================================
-- Migration 30: Add pgvector embeddings to chat_facts
-- ============================================================================

create extension if not exists vector;

alter table public.chat_facts
  add column if not exists embedding vector(1024);

create index chat_facts_embedding_idx
  on public.chat_facts
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index chat_facts_user_id_idx
  on public.chat_facts (user_id);



-- >>> 31_profiles_voyage_embedding_key.sql

-- ============================================================================
-- Migration 31: Profiles opt-in + Voyage embedding API key wiring
-- ============================================================================

alter table public.api_keys
  drop constraint if exists api_keys_provider_check;

alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'voyage_embeddings'));

alter table public.profiles
  add column if not exists voyage_embedding_api_key_id uuid references public.api_keys(id),
  add column if not exists enable_episodic_rag boolean not null default false;



-- >>> 32_match_chat_facts_rpc.sql

-- ============================================================================
-- Migration 32: Secure semantic search RPC for chat facts
-- ============================================================================

create or replace function public.match_chat_facts(
  chat_id uuid,
  target_user_id uuid,
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
returns table (
  start_seq int,
  end_seq int,
  facts text,
  similarity float
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  requester uuid := auth.uid();
  effective_user uuid := target_user_id;
begin
  if requester is not null then
    if effective_user is null then
      effective_user := requester;
    elsif effective_user <> requester then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
  end if;

  if effective_user is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chats c
    where c.id = chat_id
      and c.user_id = effective_user
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    cf.start_seq,
    cf.end_seq,
    cf.facts,
    1 - (cf.embedding <=> query_embedding) as similarity
  from public.chat_facts cf
  where
    cf.chat_id = chat_id
    and cf.user_id = effective_user
    and cf.embedding is not null
    and 1 - (cf.embedding <=> query_embedding) > match_threshold
  order by cf.embedding <=> query_embedding
  limit match_count;
end;
$$;

revoke all on function public.match_chat_facts(uuid, uuid, vector(1024), float, int) from public, anon;
grant execute on function public.match_chat_facts(uuid, uuid, vector(1024), float, int) to authenticated, service_role;



-- >>> 33_update_vault_helpers.sql

-- ============================================================================
-- Migration 33: Allow service contexts to create/delete secrets on behalf of users
-- ============================================================================

create or replace function public.create_secret(
  secret_name text,
  secret_value text,
  requester uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  effective_requester uuid := coalesce(requester, auth.uid());
  secret_id uuid;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;
  return secret_id;
end;
$$;

revoke all on function public.create_secret(text, text, uuid) from public, anon;
grant execute on function public.create_secret(text, text, uuid) to authenticated, service_role;

create or replace function public.delete_secret(
  secret_name text,
  requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  effective_requester uuid := coalesce(requester, auth.uid());
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = effective_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  delete from vault.secrets where name = secret_name;
end;
$$;

revoke all on function public.delete_secret(text, uuid) from public, anon;
grant execute on function public.delete_secret(text, uuid) to authenticated, service_role;



-- >>> 34_fix_match_chat_facts_rpc.sql

-- ============================================================================
-- Migration 34: Fix ambiguous column reference in match_chat_facts
-- ============================================================================

create or replace function public.match_chat_facts(
  chat_id uuid,
  target_user_id uuid,
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
returns table (
  start_seq int,
  end_seq int,
  facts text,
  similarity float
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  requester uuid := auth.uid();
  effective_user uuid := target_user_id;
begin
  if requester is not null then
    if effective_user is null then
      effective_user := requester;
    elsif effective_user <> requester then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
  end if;

  if effective_user is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chats c
    where c.id = match_chat_facts.chat_id
      and c.user_id = effective_user
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    cf.start_seq,
    cf.end_seq,
    cf.facts,
    1 - (cf.embedding <=> query_embedding) as similarity
  from public.chat_facts cf
  where
    cf.chat_id = match_chat_facts.chat_id
    and cf.user_id = effective_user
    and cf.embedding is not null
    and 1 - (cf.embedding <=> query_embedding) > match_threshold
  order by cf.embedding <=> query_embedding
  limit match_count;
end;
$$;



-- >>> 35_add_chat_facts_update_policy.sql

-- ============================================================================
-- Add UPDATE policy for chat_facts table
-- Bug fix: Users were unable to update embeddings for their own chat facts
-- ============================================================================

-- Users can update their own chat facts (for re-embedding)
CREATE POLICY "Users can update their own chat facts"
  ON public.chat_facts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON POLICY "Users can update their own chat facts" ON public.chat_facts
  IS 'Allows users to update (re-embed) their own chat facts';



-- >>> 36_chat_system_prompt_override.sql

-- ============================================================================
-- Add per-chat custom system prompt override
-- Allows users to replace the global system prompt via the dashboard UI
-- ============================================================================

ALTER TABLE public.chats
  ADD COLUMN custom_system_prompt text;

COMMENT ON COLUMN public.chats.custom_system_prompt
  IS 'Optional override prepended ahead of character/preset prompts. When NULL, the global system prompt is used.';



-- >>> 37_announcements.sql

-- Broadcast announcements for urgent notices

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  cta_label text,
  cta_url text,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  author_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_announcements_active_window
  on public.announcements (is_active, starts_at desc, ends_at);

alter table public.announcements enable row level security;

create policy "Authenticated users can read announcements"
  on public.announcements
  for select
  using (auth.uid() is not null);

create trigger update_announcements_updated_at
  before update on public.announcements
  for each row execute function update_updated_at_column();



-- >>> 38_profiles_admin_flag.sql

-- Add admin flag to profiles for operator-only features

alter table public.profiles
add column if not exists is_admin boolean not null default false;



-- >>> 39_user_feedback.sql

-- Lightweight user feedback submissions for retention insights

create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(trim(message)) > 0),
  source_page text,
  created_at timestamptz not null default now()
);

create index idx_user_feedback_user_created_at
  on public.user_feedback (user_id, created_at desc);

alter table public.user_feedback enable row level security;

create policy "users can insert their own feedback"
  on public.user_feedback
  for insert
  with check (auth.uid() = user_id);

create policy "users can read their own feedback"
  on public.user_feedback
  for select
  using (auth.uid() = user_id);

create policy "admins can review all feedback"
  on public.user_feedback
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.is_admin, false) = true
    )
  );



-- >>> 40_api_key_service_tier.sql

-- Track OpenAI service tier preference per BYOK entry

alter table public.api_keys
  add column service_tier text not null default 'standard'
    check (service_tier in ('batch', 'flex', 'priority', 'standard'));

comment on column public.api_keys.service_tier is
  'Optional OpenAI service tier preference (standard | flex | priority | batch)';



-- >>> 41_chat_usage_event_costs.sql

-- Track cached tokens and USD costs per usage event, plus helper to aggregate totals per chat

alter table public.chat_usage_events
  add column cached_input_tokens integer,
  add column reasoning_tokens integer,
  add column prompt_cost_usd double precision not null default 0,
  add column cached_input_cost_usd double precision not null default 0,
  add column completion_cost_usd double precision not null default 0,
  add column reasoning_cost_usd double precision not null default 0,
  add column total_cost_usd double precision not null default 0;

create or replace function public.get_chat_usage_costs(
  p_chat_id uuid,
  p_requester uuid
)
returns table (
  prompt_tokens bigint,
  completion_tokens bigint,
  cached_input_tokens bigint,
  reasoning_tokens bigint,
  prompt_cost_usd double precision,
  completion_cost_usd double precision,
  cached_input_cost_usd double precision,
  reasoning_cost_usd double precision,
  total_cost_usd double precision
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
      from public.chats c
     where c.id = p_chat_id
       and c.user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(e.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(e.completion_tokens), 0)::bigint as completion_tokens,
      coalesce(sum(e.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(e.reasoning_tokens), 0)::bigint as reasoning_tokens,
      coalesce(sum(e.prompt_cost_usd), 0)::double precision as prompt_cost_usd,
      coalesce(sum(e.completion_cost_usd), 0)::double precision as completion_cost_usd,
      coalesce(sum(e.cached_input_cost_usd), 0)::double precision as cached_input_cost_usd,
      coalesce(sum(e.reasoning_cost_usd), 0)::double precision as reasoning_cost_usd,
      coalesce(sum(e.total_cost_usd), 0)::double precision as total_cost_usd
    from public.chat_usage_events e
   where e.chat_id = p_chat_id
     and e.user_id = p_requester;
end;
$$;

revoke all on function public.get_chat_usage_costs(uuid, uuid) from public;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to authenticated;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to service_role;



-- >>> 42_profiles_summary_api_key.sql

alter table public.profiles
  add column summary_api_key_id uuid references public.api_keys (id) on delete set null;

comment on column public.profiles.summary_api_key_id is 'Optional API key used for summary generation. Defaults to the chat API key when null.';



-- >>> 43_character_assets_canonical_name.sql

-- ============================================
-- Add canonical_name column to character_assets
-- Stores the human-readable asset name for {{assetlist}} template
-- ============================================

-- Add canonical_name column
ALTER TABLE character_assets
ADD COLUMN IF NOT EXISTS canonical_name text;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_character_assets_canonical_name
ON character_assets(character_id, canonical_name)
WHERE canonical_name IS NOT NULL;

-- Backfill canonical_name from display_name for existing assets
-- Extract just the filename without path prefixes
UPDATE character_assets
SET canonical_name = (
  CASE
    -- Skip if display_name is NULL or empty
    WHEN display_name IS NULL OR display_name = '' THEN NULL
    -- Skip pure numeric filenames (e.g., "1055", "2.webp")
    WHEN display_name ~ '^\d+(\.\w+)?$' THEN NULL
    WHEN (regexp_replace(display_name, '^.*/([^/]+)$', '\1')) ~ '^\d+(\.\w+)?$' THEN NULL
    -- Extract filename from path and remove extension
    ELSE regexp_replace(
      regexp_replace(
        -- Remove path prefix (get last segment after /)
        CASE
          WHEN display_name LIKE '%/%' THEN regexp_replace(display_name, '^.*/([^/]+)$', '\1')
          ELSE display_name
        END,
        -- Remove file extension
        '\.(jpeg|jpg|png|gif|webp)$', '', 'i'
      ),
      -- Remove trailing underscores/spaces
      '[_\s]+$', '', 'g'
    )
  END
)
WHERE canonical_name IS NULL;

-- Comment for documentation
COMMENT ON COLUMN character_assets.canonical_name IS
'Human-readable asset name for {{assetlist}} template. Extracted from display_name at import time, without path prefixes or extensions.';



-- >>> 44_charx_uploads_jpeg_support.sql

-- =====================================================
-- Add JPEG MIME types to charx-uploads bucket
-- Supports RisuAI JPEG character cards
-- =====================================================

update storage.buckets
set allowed_mime_types = array[
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'image/png',
  'image/jpeg'
]
where id = 'charx-uploads';



-- >>> 45_profiles_reprocess_settings.sql

-- Add reprocess settings to profiles table
-- Allows users to configure a custom prompt and API key for message reprocessing

ALTER TABLE profiles
ADD COLUMN reprocess_prompt text,
ADD COLUMN reprocess_api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.reprocess_prompt IS 'Custom system prompt for message reprocessing (translation, style correction, etc.)';
COMMENT ON COLUMN profiles.reprocess_api_key_id IS 'API key to use for message reprocessing';



-- >>> 46_add_deepseek_provider.sql

-- Add DeepSeek as a supported LLM provider

-- Drop existing constraint
alter table public.api_keys
  drop constraint if exists api_keys_provider_check;

-- Add updated constraint with deepseek
alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'deepseek', 'voyage_embeddings'));



-- >>> 47_bilingual_memory.sql

-- Add bilingual memory support
-- Stores English translations of messages for token-efficient LLM context
-- while preserving original Korean for user-facing UI

-- 1. Add translation API key setting to profiles
ALTER TABLE profiles
ADD COLUMN translation_api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.translation_api_key_id IS 'API key to use for background message translation (Korean <-> English)';

-- 2. Add English content column to messages
ALTER TABLE messages
ADD COLUMN content_en text;

COMMENT ON COLUMN messages.content_en IS 'English translation of message content for token-efficient LLM context';



-- >>> 48_lorebook_overrides_v2.sql

-- ============================================================================
-- Lorebook Overrides v2
-- Fixes ambiguity when multiple modules contain entries with the same
-- (entry_key, entry_insertorder) by adding module_id + entry_fingerprint.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lorebook_overrides_v2 (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- References
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE NOT NULL,

  -- Lorebook entry identification
  entry_key text NOT NULL,
  entry_insertorder integer NOT NULL,
  entry_fingerprint text NOT NULL,

  -- User preference
  enabled boolean NOT NULL,

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Ensure one override per entry per chat
  UNIQUE(chat_id, module_id, entry_fingerprint)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_v2_chat_id
  ON lorebook_overrides_v2(chat_id);
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_v2_user_id
  ON lorebook_overrides_v2(user_id);

-- RLS Policies
ALTER TABLE lorebook_overrides_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_lorebook_overrides_v2_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lorebook_overrides_v2_updated_at
  BEFORE UPDATE ON lorebook_overrides_v2
  FOR EACH ROW
  EXECUTE FUNCTION update_lorebook_overrides_v2_updated_at();

-- Comments
COMMENT ON TABLE lorebook_overrides_v2 IS 'Per-chat overrides for lorebook entry activation (v2: includes module_id + fingerprint)';
COMMENT ON COLUMN lorebook_overrides_v2.module_id IS 'Source module for the entry';
COMMENT ON COLUMN lorebook_overrides_v2.entry_fingerprint IS 'Stable fingerprint for disambiguating duplicate (key, insertorder) entries';




-- >>> 49_risum_import_jobs.sql

-- =====================================================
-- RisuAI Module Import Job Queue (.risum)
-- Tracks background risum processing tasks
-- =====================================================

create table if not exists public.risum_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  file_type text,
  rights_status text not null default 'self_owned'
    check (rights_status in ('self_owned', 'third_party_with_license')),
  rights_attested boolean not null default false,
  license_type text,
  license_url text,
  license_notes text,
  source_url text,
  source_label text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'success', 'error')),
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists risum_import_jobs_user_status_idx
  on public.risum_import_jobs (user_id, status, created_at desc);

create index if not exists risum_import_jobs_character_idx
  on public.risum_import_jobs (character_id, created_at desc);

alter table public.risum_import_jobs enable row level security;

create policy "Users can access their risum jobs"
  on public.risum_import_jobs
  for select
  using (auth.uid() = user_id);

create policy "Users can enqueue risum jobs"
  on public.risum_import_jobs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their risum jobs"
  on public.risum_import_jobs
  for update
  using (auth.uid() = user_id);

create policy "Users can delete their risum jobs"
  on public.risum_import_jobs
  for delete
  using (auth.uid() = user_id);

comment on column public.risum_import_jobs.rights_status is 'self_owned = uploaded by owner, third_party_with_license = imported under an allowed, documented license';
comment on column public.risum_import_jobs.rights_attested is 'Whether the uploader explicitly confirmed their rights to redistribute the risum file';
comment on column public.risum_import_jobs.license_type is 'Declared license for the risum payload (e.g., CC BY 4.0)';
comment on column public.risum_import_jobs.license_url is 'Link to the license text or proof';
comment on column public.risum_import_jobs.license_notes is 'Free-form notes about the license or attribution requirements';
comment on column public.risum_import_jobs.source_url is 'Original source URL (e.g., RisuRealm share link)';
comment on column public.risum_import_jobs.source_label is 'Human friendly label for the source (uploader name/site)';

create or replace function public.set_risum_import_job_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_risum_import_job_updated_at on public.risum_import_jobs;

create trigger set_risum_import_job_updated_at
before update on public.risum_import_jobs
for each row execute function public.set_risum_import_job_updated_at();



-- >>> 50_charx_uploads_risum_limit.sql

-- Raise CharX/RisuAI upload staging limit to support large .risum modules.
update storage.buckets
set file_size_limit = 838860800 -- 800 MiB
where id = 'charx-uploads';



-- >>> 51_module_assets.sql

-- ============================================================================
-- Module Assets Storage
-- ============================================================================
-- Stores module-level assets once and reuses across characters.

-- Create storage bucket for module assets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'module-assets',
  'module-assets',
  true,  -- Public access for reading
  20971520,  -- 20MB limit per file
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

-- ============================================
-- Storage RLS Policies (module-assets bucket)
-- ============================================

-- Allow users to upload to their own folders
create policy "Module assets: users can upload to own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'module-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to update their own files
create policy "Module assets: users can update own files"
  on storage.objects for update
  using (
    bucket_id = 'module-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to delete their own files
create policy "Module assets: users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'module-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow everyone to read (module assets are public)
create policy "Module assets: public read access"
  on storage.objects for select
  using (bucket_id = 'module-assets');

-- ============================================
-- Module Assets Table
-- ============================================

create table if not exists module_assets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  module_id uuid references modules(id) on delete cascade not null,

  -- Asset identification
  file_name text not null,   -- Original filename from .risum

  -- Storage
  storage_path text not null unique,  -- Path in module-assets bucket
  content_type text,
  file_size integer,

  -- Display & Organization
  display_name text,
  display_order integer default 0,

  -- Metadata (aliases, generation info, etc)
  metadata jsonb default '{}'::jsonb,

  -- Timestamps
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,

  unique (module_id, file_name)
);

-- Indexes
create index idx_module_assets_user_id on module_assets(user_id);
create index idx_module_assets_module_id on module_assets(module_id);
create index idx_module_assets_display_name on module_assets(module_id, display_name);
create index idx_module_assets_storage_path on module_assets(storage_path);

-- ============================================
-- RLS Policies
-- ============================================

alter table module_assets enable row level security;

create policy "Users can view own module assets"
  on module_assets for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

create policy "Users can insert own module assets"
  on module_assets for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

create policy "Users can update own module assets"
  on module_assets for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

create policy "Users can delete own module assets"
  on module_assets for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

-- ============================================
-- Triggers
-- ============================================

create trigger update_module_assets_updated_at
  before update on module_assets
  for each row
  execute function update_updated_at();

-- ============================================
-- Comments
-- ============================================

comment on table module_assets is 'Module-level assets (shared across characters)';
comment on column module_assets.storage_path is 'Path in module-assets Supabase Storage bucket';
comment on column module_assets.metadata is 'Asset metadata (aliases, generation info, etc)';
comment on column module_assets.display_name is 'Display name for module assets';



-- >>> 52_character_assets_user_id.sql

-- ============================================================================
-- Character Assets User ID Denormalization
-- ============================================================================
-- Performance fix: Add user_id directly to character_assets table
-- to avoid slow RLS policy with EXISTS subquery to characters table.
--
-- Problem: RLS policy "Users can view own character assets" does:
--   EXISTS (SELECT 1 FROM characters WHERE characters.id = character_assets.character_id AND characters.user_id = auth.uid())
-- This causes 1 subquery per row, which times out with many assets (733+ rows).
--
-- Solution: Denormalize user_id into character_assets for O(1) RLS check.
-- ============================================================================

-- 1. Add user_id column (nullable initially for migration)
ALTER TABLE character_assets
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Populate user_id from characters table
UPDATE character_assets
SET user_id = characters.user_id
FROM characters
WHERE character_assets.character_id = characters.id
AND character_assets.user_id IS NULL;

-- 3. Make user_id NOT NULL after population
ALTER TABLE character_assets
ALTER COLUMN user_id SET NOT NULL;

-- 4. Add index for RLS performance
CREATE INDEX IF NOT EXISTS idx_character_assets_user_id
ON character_assets(user_id);

-- 5. Drop old RLS policies
DROP POLICY IF EXISTS "Users can view own character assets" ON character_assets;
DROP POLICY IF EXISTS "Users can insert own character assets" ON character_assets;
DROP POLICY IF EXISTS "Users can update own character assets" ON character_assets;
DROP POLICY IF EXISTS "Users can delete own character assets" ON character_assets;

-- 6. Create new optimized RLS policies (direct user_id check, no subquery)
CREATE POLICY "Users can view own character assets"
  ON character_assets FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own character assets"
  ON character_assets FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own character assets"
  ON character_assets FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own character assets"
  ON character_assets FOR DELETE
  USING (user_id = auth.uid());

-- 7. Add comment documenting the denormalization
COMMENT ON COLUMN character_assets.user_id IS 'Denormalized from characters.user_id for RLS performance. Must match characters.user_id.';



-- >>> 53_security_immutable_job_fields.sql

-- =====================================================
-- Security Patch: Immutable Fields & Character Access
-- Prevents cross-tenant file access and unauthorized character access
-- =====================================================

-- =====================================================
-- 1. CharX Import Jobs: Restrict UPDATE to mutable fields only
-- Prevents: User changing storage_path after job creation to access other users' files
-- =====================================================

-- Drop existing permissive UPDATE policy
drop policy if exists "Users can update their CharX jobs" on public.charx_import_jobs;

-- New policy: Only allow updating status-related fields, not path/identity fields
-- Immutable after creation: storage_path, original_filename, file_type, preset_id, module_ids,
--                           rights_status, rights_attested, license_type, license_url, license_notes,
--                           source_url, source_label
-- User-mutable: None (status changes should go through runner only)
-- This effectively makes the table read-only for users after INSERT
create policy "Users can view but not update CharX jobs"
  on public.charx_import_jobs
  for update
  using (false);  -- Deny all user UPDATEs; only service role can update

-- =====================================================
-- 2. Risum Import Jobs: Restrict UPDATE to mutable fields only
-- Prevents: User changing storage_path or character_id after job creation
-- =====================================================

-- Drop existing permissive UPDATE policy
drop policy if exists "Users can update their risum jobs" on public.risum_import_jobs;

-- New policy: Deny user UPDATEs (same reasoning as CharX)
create policy "Users can view but not update risum jobs"
  on public.risum_import_jobs
  for update
  using (false);  -- Deny all user UPDATEs; only service role can update

-- =====================================================
-- 3. Chats: Enforce character ownership/visibility on INSERT
-- Prevents: User creating chat with another user's private character
-- =====================================================

-- Drop existing INSERT policy
drop policy if exists "Users can create their own chats" on public.chats;

-- New policy: Only allow creating chats with owned or public characters
create policy "Users can create chats with owned or public characters"
  on public.chats
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.characters
      where characters.id = character_id
      and (
        characters.user_id = auth.uid()
        or characters.visibility = 'public'
      )
    )
  );

-- =====================================================
-- Comments for documentation
-- =====================================================
comment on policy "Users can view but not update CharX jobs" on public.charx_import_jobs is
  'Security: Prevents users from modifying job fields (especially storage_path) after creation. All status updates go through service role.';

comment on policy "Users can view but not update risum jobs" on public.risum_import_jobs is
  'Security: Prevents users from modifying job fields (especially storage_path, character_id) after creation. All status updates go through service role.';

comment on policy "Users can create chats with owned or public characters" on public.chats is
  'Security: Ensures users can only create chats with characters they own or that are publicly visible.';



-- >>> 54_fix_function_search_path.sql

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



-- >>> 55_fix_rls_initplan_performance.sql

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



-- >>> 56_fix_multiple_permissive_policies.sql

-- ============================================
-- Fix multiple permissive policies for better performance
-- Removes redundant SELECT policies where FOR ALL already covers them
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies
-- ============================================

-- ============================================
-- 1. character_modules: Remove redundant "view" policy
-- "manage" (FOR ALL) already covers SELECT
-- ============================================
DROP POLICY IF EXISTS "Users can view own character modules" ON public.character_modules;

-- ============================================
-- 2. character_presets: Remove redundant "view" policy
-- "manage" (FOR ALL) already covers SELECT
-- ============================================
DROP POLICY IF EXISTS "Users can view own character presets" ON public.character_presets;

-- ============================================
-- 3. user_feedback: Merge two SELECT policies into one
-- Combines "users can read their own feedback" + "admins can review all feedback"
-- ============================================
DROP POLICY IF EXISTS "users can read their own feedback" ON public.user_feedback;
DROP POLICY IF EXISTS "admins can review all feedback" ON public.user_feedback;

CREATE POLICY "users can read feedback" ON public.user_feedback
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_admin = true
    )
  );



-- >>> 57_charx_import_rights_metadata.sql

-- =====================================================
-- CharX Import Job Rights Metadata
-- Tracks provenance + redistribution claims for CharX uploads
-- =====================================================

alter table if exists public.charx_import_jobs
  add column if not exists rights_status text not null default 'self_owned'
    check (rights_status in ('self_owned', 'third_party_with_license')),
  add column if not exists rights_attested boolean not null default false,
  add column if not exists license_type text,
  add column if not exists license_url text,
  add column if not exists license_notes text,
  add column if not exists source_url text,
  add column if not exists source_label text;

comment on column public.charx_import_jobs.rights_status is 'self_owned = uploaded by owner, third_party_with_license = imported under an allowed, documented license';
comment on column public.charx_import_jobs.rights_attested is 'Whether the uploader explicitly confirmed their rights to redistribute the CharX file';
comment on column public.charx_import_jobs.license_type is 'Declared license for the CharX payload (e.g., CC BY 4.0)';
comment on column public.charx_import_jobs.license_url is 'Link to the license text or proof';
comment on column public.charx_import_jobs.license_notes is 'Free-form notes about the license or attribution requirements';
comment on column public.charx_import_jobs.source_url is 'Original source URL (e.g., RisuRealm share link)';
comment on column public.charx_import_jobs.source_label is 'Human friendly label for the source (uploader name/site)';



-- >>> 58_add_openrouter_provider.sql

-- Add OpenRouter as a valid provider for api_keys
alter table public.api_keys
  drop constraint if exists api_keys_provider_check;

alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'deepseek', 'openrouter', 'voyage_embeddings'));



-- >>> 59_api_keys_reasoning_effort.sql

-- Add reasoning_effort column to api_keys
-- Allows users to control reasoning intensity for OpenAI models that support it
-- Values: 'none' (default, no reasoning), 'low', 'medium', 'high'
-- NULL means no preference set (treated as 'none' in application code)

ALTER TABLE api_keys
  ADD COLUMN reasoning_effort text
  CHECK (reasoning_effort IN ('none', 'low', 'medium', 'high'));



-- >>> 60_charx_uploads_lower_limit.sql

-- Lower charx-uploads bucket limit to match the conservative app default.
-- Previous value was 800 MiB (migration 50) to support large .risum modules.
-- Application now enforces a tighter default (100 MB) with env-configurable
-- override, so the bucket acts as a last-resort backstop at 200 MiB.
-- Self-hosters who raise IMPORT_MAX_UPLOAD_MB above 200 should also raise
-- this bucket limit manually in Supabase Dashboard → Storage → charx-uploads.
update storage.buckets
set file_size_limit = 209715200 -- 200 MiB
where id = 'charx-uploads';



-- >>> 61_queue_admission_controls.sql

-- Queue admission controls for chat generation and RBX imports.
-- Goals:
-- 1. Only one active chat generation job per chat
-- 2. Cap each user to 3 active chat generation jobs
-- 3. Only one active RBX import job per user

create unique index if not exists chat_generation_jobs_active_chat_idx
  on public.chat_generation_jobs (chat_id)
  where status in ('pending', 'processing');

create index if not exists chat_generation_jobs_user_status_created_idx
  on public.chat_generation_jobs (user_id, status, created_at desc);

create or replace function public.enforce_chat_generation_job_user_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  active_limit constant integer := 3;
  active_count integer;
begin
  if new.status not in ('pending', 'processing') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chat_generation_jobs:' || new.user_id::text, 0));

  select count(*)
    into active_count
  from public.chat_generation_jobs
  where user_id = new.user_id
    and status in ('pending', 'processing');

  if active_count >= active_limit then
    raise exception using
      errcode = 'P0001',
      message = format('User already has %s active chat generation jobs', active_limit),
      detail = 'Wait for an existing response to finish before queueing another.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_chat_generation_job_user_cap on public.chat_generation_jobs;

create trigger enforce_chat_generation_job_user_cap
before insert on public.chat_generation_jobs
for each row execute function public.enforce_chat_generation_job_user_cap();

create unique index if not exists charx_import_jobs_active_user_idx
  on public.charx_import_jobs (user_id)
  where status in ('pending', 'processing');



-- >>> 62_queue_janitor_indexes.sql

-- Indexes for stuck-job janitor scans.
-- These queries always filter processing jobs by updated_at cutoff, so use
-- partial indexes that stay small and hot.

create index if not exists chat_generation_jobs_processing_updated_at_idx
  on public.chat_generation_jobs (updated_at)
  where status = 'processing';

create index if not exists charx_import_jobs_processing_updated_at_idx
  on public.charx_import_jobs (updated_at)
  where status = 'processing';



-- >>> 63_reconcile_production_public.sql

-- Reconcile local migrations with the current production public schema.
-- This file captures production-only drift discovered via `supabase db diff --linked`.

CREATE INDEX IF NOT EXISTS idx_character_assets_display_order ON public.character_assets USING btree (character_id, display_order);

CREATE INDEX IF NOT EXISTS idx_module_assets_order ON public.module_assets USING btree (user_id, module_id, display_order);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_anon_rate_limit(identifier text, window_seconds integer, max_requests integer)
 RETURNS TABLE(allowed boolean, remaining integer, retry_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bucket_start timestamptz;
  request_total integer;
  epoch_now integer;
begin
  if identifier is null or length(identifier) = 0 then
    raise exception 'identifier is required'
      using errcode = '22004';
  end if;

  if window_seconds is null or window_seconds <= 0 then
    raise exception 'window_seconds must be positive'
      using errcode = '22023';
  end if;

  if max_requests is null or max_requests <= 0 then
    raise exception 'max_requests must be positive'
      using errcode = '22023';
  end if;

  epoch_now := floor(extract(epoch from now()))::integer;
  bucket_start :=
    to_timestamp((epoch_now / window_seconds) * window_seconds)::timestamptz;

  insert into public.anon_rate_limits (identifier, window_start, request_count)
    values (identifier, bucket_start, 1)
  on conflict (identifier, window_start)
    do update set request_count = public.anon_rate_limits.request_count + 1
    returning public.anon_rate_limits.request_count into request_total;

  if request_total <= max_requests then
    allowed := true;
    remaining := max_requests - request_total;
    retry_after := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after := window_seconds - (epoch_now % window_seconds);
  end if;

  delete from public.anon_rate_limits
   where public.anon_rate_limits.identifier = identifier
     and window_start < bucket_start - interval '1 day';

  return query select allowed, remaining, retry_after;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_chat_rate_limit(target_user_id uuid, window_seconds integer, max_requests integer)
 RETURNS TABLE(allowed boolean, remaining integer, retry_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bucket_start timestamptz;
  request_total integer;
  epoch_now integer;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required'
      using errcode = '22004';
  end if;

  if window_seconds is null or window_seconds <= 0 then
    raise exception 'window_seconds must be positive'
      using errcode = '22023';
  end if;

  if max_requests is null or max_requests <= 0 then
    raise exception 'max_requests must be positive'
      using errcode = '22023';
  end if;

  epoch_now := floor(extract(epoch from now()))::integer;
  bucket_start :=
    to_timestamp((epoch_now / window_seconds) * window_seconds)::timestamptz;

  insert into public.chat_rate_limits (user_id, window_start, request_count)
    values (target_user_id, bucket_start, 1)
  on conflict (user_id, window_start)
    do update set request_count = public.chat_rate_limits.request_count + 1
    returning public.chat_rate_limits.request_count into request_total;

  if request_total <= max_requests then
    allowed := true;
    remaining := max_requests - request_total;
    retry_after := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after := window_seconds - (epoch_now % window_seconds);
  end if;

  -- Garbage collect old windows for this user (best effort)
  delete from public.chat_rate_limits
   where user_id = target_user_id
     and window_start < bucket_start - interval '1 day';

  return query select allowed, remaining, retry_after;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_secret(secret_name text, secret_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  requester uuid;
  secret_id uuid;
  expected_prefix text;
  suffix text;
  max_keys constant integer := 10;
  current_key_count integer;
begin
  requester := auth.uid();

  if requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated create_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || requester::text || '_';

  if left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'prefix mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if suffix !~ '^[a-z]+_[0-9]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  select count(*) into current_key_count
  from public.api_keys
  where user_id = requester;

  if current_key_count >= max_keys then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'api key quota exceeded');
    raise exception 'API key quota exceeded'
      using errcode = '54013';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (requester, secret_name, 'create', null);

  return secret_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_secret(secret_name text, secret_value text, requester uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  effective_requester uuid := coalesce(requester, auth.uid());
  secret_id uuid;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;
  return secret_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_secret(secret_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  requester uuid;
  expected_prefix text;
  suffix text;
  requester_prefix text;
begin
  requester := auth.uid();

  if requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated delete_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  requester_prefix := 'apikey_' || requester::text || '_';

  expected_prefix := requester_prefix;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = requester
  )
  and left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'ownership check failed');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if suffix !~ '^[a-z]+_[0-9]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  delete from vault.secrets
  where name = secret_name;

  if not found then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'secret not found');
    raise exception 'Secret not found'
      using errcode = 'P0002';
  end if;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (requester, secret_name, 'delete', null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_secret(secret_name text, requester uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  effective_requester uuid := coalesce(requester, auth.uid());
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = effective_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  delete from vault.secrets where name = secret_name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_chat_generation_job_user_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  active_limit constant integer := 3;
  active_count integer;
begin
  if new.status not in ('pending', 'processing') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chat_generation_jobs:' || new.user_id::text, 0));

  select count(*)
    into active_count
  from public.chat_generation_jobs
  where user_id = new.user_id
    and status in ('pending', 'processing');

  if active_count >= active_limit then
    raise exception using
      errcode = 'P0001',
      message = format('User already has %s active chat generation jobs', active_limit),
      detail = 'Wait for an existing response to finish before queueing another.';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_character_asset_url(asset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_character_assets(p_character_id uuid)
 RETURNS TABLE(id uuid, asset_type text, file_name text, display_name text, public_url text, content_type text, file_size integer, metadata jsonb, display_order integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_token_totals(p_chat_id uuid, p_requester uuid)
 RETURNS TABLE(prompt_tokens bigint, completion_tokens bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
      from public.chats c
     where c.id = p_chat_id
       and c.user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(m.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(m.completion_tokens), 0)::bigint as completion_tokens
    from public.messages m
   where m.chat_id = p_chat_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_usage_costs(p_chat_id uuid, p_requester uuid)
 RETURNS TABLE(prompt_tokens bigint, completion_tokens bigint, cached_input_tokens bigint, reasoning_tokens bigint, prompt_cost_usd double precision, completion_cost_usd double precision, cached_input_cost_usd double precision, reasoning_cost_usd double precision, total_cost_usd double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
      from public.chats c
     where c.id = p_chat_id
       and c.user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(e.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(e.completion_tokens), 0)::bigint as completion_tokens,
      coalesce(sum(e.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(e.reasoning_tokens), 0)::bigint as reasoning_tokens,
      coalesce(sum(e.prompt_cost_usd), 0)::double precision as prompt_cost_usd,
      coalesce(sum(e.completion_cost_usd), 0)::double precision as completion_cost_usd,
      coalesce(sum(e.cached_input_cost_usd), 0)::double precision as cached_input_cost_usd,
      coalesce(sum(e.reasoning_cost_usd), 0)::double precision as reasoning_cost_usd,
      coalesce(sum(e.total_cost_usd), 0)::double precision as total_cost_usd
    from public.chat_usage_events e
   where e.chat_id = p_chat_id
     and e.user_id = p_requester;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_decrypted_secret(secret_name text, requester uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.match_chat_facts(chat_id uuid, target_user_id uuid, query_embedding public.vector, match_threshold double precision, match_count integer)
 RETURNS TABLE(start_seq integer, end_seq integer, facts text, similarity double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  requester uuid := auth.uid();
  effective_user uuid := target_user_id;
begin
  if requester is not null then
    if effective_user is null then
      effective_user := requester;
    elsif effective_user <> requester then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
  end if;

  if effective_user is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chats c
    where c.id = match_chat_facts.chat_id
      and c.user_id = effective_user
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    cf.start_seq,
    cf.end_seq,
    cf.facts,
    1 - (cf.embedding <=> query_embedding) as similarity
  from public.chat_facts cf
  where
    cf.chat_id = match_chat_facts.chat_id
    and cf.user_id = effective_user
    and cf.embedding is not null
    and 1 - (cf.embedding <=> query_embedding) > match_threshold
  order by cf.embedding <=> query_embedding
  limit match_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_charx_import_job_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_chat_summary_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_message_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_risum_import_job_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_lorebook_overrides_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_lorebook_overrides_v2_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_personas_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;



-- >>> 64_chat_turns_and_message_variants.sql

-- ============================================================================
-- 64_chat_turns_and_message_variants.sql
-- Introduce chat turns and assistant message variants for safe regeneration.
-- ============================================================================

create table public.chat_turns (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  turn_index bigint not null,
  user_message_id uuid,
  active_assistant_message_id uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (chat_id, turn_index),
  unique (user_message_id)
);

create index chat_turns_chat_id_turn_index_idx
  on public.chat_turns (chat_id, turn_index desc);

alter table public.chat_turns enable row level security;

create policy "Users can view their chat turns" on public.chat_turns
  for select using (user_id = (select auth.uid()));

create policy "Users can insert their chat turns" on public.chat_turns
  for insert with check (user_id = (select auth.uid()));

create policy "Users can update their chat turns" on public.chat_turns
  for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can delete their chat turns" on public.chat_turns
  for delete using (user_id = (select auth.uid()));

create trigger update_chat_turns_updated_at
  before update on public.chat_turns
  for each row execute function update_updated_at_column();

alter table public.messages
  add column turn_id uuid references public.chat_turns(id) on delete cascade,
  add column variant_index integer,
  add column supersedes_message_id uuid references public.messages(id) on delete set null,
  add column message_status text default 'completed' not null;

alter table public.messages
  add constraint messages_message_status_check
    check (message_status in ('completed', 'generating', 'superseded')),
  add constraint messages_variant_index_positive_check
    check (variant_index is null or variant_index > 0);

create index messages_chat_id_status_sequence_idx
  on public.messages (chat_id, message_status, sequence desc);

create index messages_turn_id_role_variant_idx
  on public.messages (turn_id, role, variant_index desc);

create index messages_supersedes_message_id_idx
  on public.messages (supersedes_message_id)
  where supersedes_message_id is not null;

do $$
declare
  chat_row record;
  message_row record;
  current_turn_id uuid;
  current_turn_index bigint;
  current_active_assistant_id uuid;
  current_variant_index integer;
begin
  for chat_row in
    select id, user_id
    from public.chats
    order by created_at asc, id asc
  loop
    current_turn_id := null;
    current_turn_index := 0;
    current_active_assistant_id := null;
    current_variant_index := 0;

    for message_row in
      select id, role
      from public.messages
      where chat_id = chat_row.id
      order by sequence asc
    loop
      if message_row.role = 'system' then
        continue;
      end if;

      if message_row.role = 'user' then
        current_turn_index := current_turn_index + 1;
        current_turn_id := gen_random_uuid();
        current_active_assistant_id := null;
        current_variant_index := 0;

        insert into public.chat_turns (
          id,
          chat_id,
          user_id,
          turn_index,
          user_message_id,
          active_assistant_message_id
        )
        values (
          current_turn_id,
          chat_row.id,
          chat_row.user_id,
          current_turn_index,
          message_row.id,
          null
        );

        update public.messages
        set
          turn_id = current_turn_id,
          variant_index = null,
          supersedes_message_id = null,
          message_status = 'completed'
        where id = message_row.id;

        continue;
      end if;

      if current_turn_id is null then
        current_turn_index := current_turn_index + 1;
        current_turn_id := gen_random_uuid();
        current_active_assistant_id := null;
        current_variant_index := 0;

        insert into public.chat_turns (
          id,
          chat_id,
          user_id,
          turn_index,
          user_message_id,
          active_assistant_message_id
        )
        values (
          current_turn_id,
          chat_row.id,
          chat_row.user_id,
          current_turn_index,
          null,
          null
        );
      end if;

      current_variant_index := current_variant_index + 1;

      if current_active_assistant_id is not null then
        update public.messages
        set message_status = 'superseded'
        where id = current_active_assistant_id;
      end if;

      update public.messages
      set
        turn_id = current_turn_id,
        variant_index = current_variant_index,
        supersedes_message_id = current_active_assistant_id,
        message_status = 'completed'
      where id = message_row.id;

      update public.chat_turns
      set active_assistant_message_id = message_row.id
      where id = current_turn_id;

      current_active_assistant_id := message_row.id;
    end loop;
  end loop;
end
$$;



-- >>> 65_delete_orphaned_modules.sql

-- Delete user-owned modules that are no longer linked to any character.
-- This is used after character edits/deletes so imported modules do not linger
-- as orphaned rows when their final character link is removed.

create or replace function public.delete_orphaned_modules(
  module_ids uuid[],
  requester uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  deleted_count integer := 0;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role <> 'service_role' and effective_requester <> caller_uid then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if coalesce(array_length(module_ids, 1), 0) = 0 then
    return 0;
  end if;

  with candidate_modules as (
    select distinct candidate.module_id
    from unnest(module_ids) as candidate(module_id)
    where candidate.module_id is not null
  ),
  deleted as (
    delete from public.modules m
    using candidate_modules c
    where m.id = c.module_id
      and m.user_id = effective_requester
      and not exists (
        select 1
        from public.character_modules cm
        where cm.module_id = m.id
      )
    returning 1
  )
  select count(*)::integer
    into deleted_count
  from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.delete_orphaned_modules(uuid[], uuid) from public, anon;
grant execute on function public.delete_orphaned_modules(uuid[], uuid) to authenticated, service_role;

delete from public.modules m
where not exists (
  select 1
  from public.character_modules cm
  where cm.module_id = m.id
);



-- >>> 66_anthropic_batch_chat_mode.sql

-- Add delivery-mode tracking for Anthropic Message Batches chat jobs.

alter table public.chat_generation_jobs
  add column if not exists delivery_mode text not null default 'streaming'
    check (delivery_mode in ('streaming', 'anthropic_batch')),
  add column if not exists external_provider_job_id text,
  add column if not exists external_provider_status text,
  add column if not exists external_provider_submitted_at timestamptz,
  add column if not exists external_provider_last_checked_at timestamptz,
  add column if not exists external_provider_result_url text,
  add column if not exists external_provider_metadata jsonb;

comment on column public.chat_generation_jobs.delivery_mode is
  'Execution mode for the job (streaming | anthropic_batch).';

comment on column public.chat_generation_jobs.external_provider_job_id is
  'Provider-side async job id, such as an Anthropic message batch id.';

create index if not exists chat_generation_jobs_anthropic_batch_processing_idx
  on public.chat_generation_jobs (external_provider_last_checked_at, created_at)
  where delivery_mode = 'anthropic_batch'
    and status = 'processing'
    and external_provider_job_id is not null;



-- >>> 67_delete_api_key.sql

-- Delete a user-owned API key and its Vault secret inside one transaction boundary.
-- This keeps profile references, api_keys metadata, and Vault state aligned on mixed failures.

create or replace function public.delete_api_key(
  api_key_id uuid,
  requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  target_secret_name text;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role <> 'service_role' and effective_requester <> caller_uid then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select vault_secret_name
    into target_secret_name
  from public.api_keys
  where id = api_key_id
    and user_id = effective_requester
  for update;

  if target_secret_name is null then
    raise exception 'API key not found'
      using errcode = 'P0002';
  end if;

  update public.profiles
  set voyage_embedding_api_key_id = null,
      enable_episodic_rag = false
  where id = effective_requester
    and voyage_embedding_api_key_id = api_key_id;

  delete from public.api_keys
  where id = api_key_id
    and user_id = effective_requester;

  delete from vault.secrets
  where name = target_secret_name;
end;
$$;

revoke all on function public.delete_api_key(uuid, uuid) from public, anon;
grant execute on function public.delete_api_key(uuid, uuid) to authenticated, service_role;



-- >>> 68_harden_vault_write_helpers.sql

-- Harden Vault write helpers so only trusted service-role paths can mutate
-- secrets, while still allowing service contexts to act on behalf of a user.

create or replace function public.create_secret(
  secret_name text,
  secret_value text,
  requester uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  secret_id uuid;
  expected_prefix text;
  suffix text;
  max_keys constant integer := 10;
  current_key_count integer;
begin
  if effective_requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated create_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role is distinct from 'service_role' and effective_requester <> caller_uid then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'requester mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || effective_requester::text || '_';

  if left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'prefix mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if suffix !~ '^[a-z0-9_]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  select count(*) into current_key_count
  from public.api_keys
  where user_id = effective_requester;

  if current_key_count >= max_keys then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'api key quota exceeded');
    raise exception 'API key quota exceeded'
      using errcode = '54013';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (effective_requester, secret_name, 'create', null);

  return secret_id;
end;
$$;

revoke all on function public.create_secret(text, text) from public, anon, authenticated, service_role;
revoke all on function public.create_secret(text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_secret(text, text, uuid) to service_role;

create or replace function public.delete_secret(
  secret_name text,
  requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  expected_prefix text;
  legacy_prefix text;
  suffix text;
begin
  if effective_requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated delete_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role is distinct from 'service_role' and effective_requester <> caller_uid then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'requester mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || effective_requester::text || '_';
  legacy_prefix := 'apikey_' || left(replace(effective_requester::text, '-', ''), 12) || '_';

  if left(secret_name, length(expected_prefix)) = expected_prefix then
    suffix := substring(secret_name from length(expected_prefix) + 1);
  elsif left(secret_name, length(legacy_prefix)) = legacy_prefix then
    suffix := substring(secret_name from length(legacy_prefix) + 1);
  else
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'ownership check failed');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if suffix !~ '^[a-z0-9_]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  delete from vault.secrets
  where name = secret_name;

  if not found then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'secret not found');
    raise exception 'Secret not found'
      using errcode = 'P0002';
  end if;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (effective_requester, secret_name, 'delete', null);
end;
$$;

revoke all on function public.delete_secret(text) from public, anon, authenticated, service_role;
revoke all on function public.delete_secret(text, uuid) from public, anon, authenticated;
grant execute on function public.delete_secret(text, uuid) to service_role;



-- >>> 69_service_health_status.sql

-- Durable service-health snapshots for internal operators.
-- This keeps last success/failure state across deploys, warm restarts, and
-- multiple serverless instances.

create table if not exists public.service_health_status (
  service_label text primary key,
  total_successes bigint not null default 0,
  total_failures bigint not null default 0,
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_message text,
  last_metadata jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_health_status_service_label_check
    check (service_label is not null and length(service_label) > 0)
);

alter table public.service_health_status enable row level security;

revoke all on table public.service_health_status from public, anon, authenticated;
grant select, insert, update on table public.service_health_status to service_role;

create or replace function public.record_service_health_status(
  service_label text,
  was_success boolean,
  error_message text default null,
  metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ts timestamptz := timezone('utc', now());
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if service_label is null or length(service_label) = 0 then
    raise exception 'Service label required'
      using errcode = '22004';
  end if;

  insert into public.service_health_status (
    service_label,
    total_successes,
    total_failures,
    consecutive_failures,
    last_success_at,
    last_failure_at,
    last_error_message,
    last_metadata,
    created_at,
    updated_at
  )
  values (
    service_label,
    case when was_success then 1 else 0 end,
    case when was_success then 0 else 1 end,
    case when was_success then 0 else 1 end,
    case when was_success then now_ts else null end,
    case when was_success then null else now_ts end,
    case when was_success then null else error_message end,
    metadata,
    now_ts,
    now_ts
  )
  on conflict (service_label) do update
  set total_successes = public.service_health_status.total_successes +
      case when was_success then 1 else 0 end,
      total_failures = public.service_health_status.total_failures +
      case when was_success then 0 else 1 end,
      consecutive_failures = case
        when was_success then 0
        else public.service_health_status.consecutive_failures + 1
      end,
      last_success_at = case
        when was_success then now_ts
        else public.service_health_status.last_success_at
      end,
      last_failure_at = case
        when was_success then public.service_health_status.last_failure_at
        else now_ts
      end,
      last_error_message = case
        when was_success then null
        else error_message
      end,
      last_metadata = metadata,
      updated_at = now_ts;
end;
$$;

revoke all on function public.record_service_health_status(text, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_service_health_status(text, boolean, text, jsonb)
  to service_role;



-- >>> 70_fix_service_health_rpc.sql

-- Fix PL/pgSQL name ambiguity in record_service_health_status after the initial
-- durable health migration.

create or replace function public.record_service_health_status(
  service_label text,
  was_success boolean,
  error_message text default null,
  metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  input_service_label alias for $1;
  input_was_success alias for $2;
  input_error_message alias for $3;
  input_metadata alias for $4;
  now_ts timestamptz := timezone('utc', now());
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if input_service_label is null or length(input_service_label) = 0 then
    raise exception 'Service label required'
      using errcode = '22004';
  end if;

  insert into public.service_health_status (
    service_label,
    total_successes,
    total_failures,
    consecutive_failures,
    last_success_at,
    last_failure_at,
    last_error_message,
    last_metadata,
    created_at,
    updated_at
  )
  values (
    input_service_label,
    case when input_was_success then 1 else 0 end,
    case when input_was_success then 0 else 1 end,
    case when input_was_success then 0 else 1 end,
    case when input_was_success then now_ts else null end,
    case when input_was_success then null else now_ts end,
    case when input_was_success then null else input_error_message end,
    input_metadata,
    now_ts,
    now_ts
  )
  on conflict (service_label) do update
  set total_successes = public.service_health_status.total_successes +
      case when input_was_success then 1 else 0 end,
      total_failures = public.service_health_status.total_failures +
      case when input_was_success then 0 else 1 end,
      consecutive_failures = case
        when input_was_success then 0
        else public.service_health_status.consecutive_failures + 1
      end,
      last_success_at = case
        when input_was_success then now_ts
        else public.service_health_status.last_success_at
      end,
      last_failure_at = case
        when input_was_success then public.service_health_status.last_failure_at
        else now_ts
      end,
      last_error_message = case
        when input_was_success then null
        else input_error_message
      end,
      last_metadata = input_metadata,
      updated_at = now_ts;
end;
$$;



-- >>> 71_rename_service_health_rpc_args.sql

-- Remove PL/pgSQL ambiguity by renaming record_service_health_status arguments.

drop function if exists public.record_service_health_status(text, boolean, text, jsonb);

create or replace function public.record_service_health_status(
  p_service_label text,
  p_was_success boolean,
  p_error_message text default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ts timestamptz := timezone('utc', now());
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_service_label is null or length(p_service_label) = 0 then
    raise exception 'Service label required'
      using errcode = '22004';
  end if;

  insert into public.service_health_status (
    service_label,
    total_successes,
    total_failures,
    consecutive_failures,
    last_success_at,
    last_failure_at,
    last_error_message,
    last_metadata,
    created_at,
    updated_at
  )
  values (
    p_service_label,
    case when p_was_success then 1 else 0 end,
    case when p_was_success then 0 else 1 end,
    case when p_was_success then 0 else 1 end,
    case when p_was_success then now_ts else null end,
    case when p_was_success then null else now_ts end,
    case when p_was_success then null else p_error_message end,
    p_metadata,
    now_ts,
    now_ts
  )
  on conflict (service_label) do update
  set total_successes = public.service_health_status.total_successes +
      case when p_was_success then 1 else 0 end,
      total_failures = public.service_health_status.total_failures +
      case when p_was_success then 0 else 1 end,
      consecutive_failures = case
        when p_was_success then 0
        else public.service_health_status.consecutive_failures + 1
      end,
      last_success_at = case
        when p_was_success then now_ts
        else public.service_health_status.last_success_at
      end,
      last_failure_at = case
        when p_was_success then public.service_health_status.last_failure_at
        else now_ts
      end,
      last_error_message = case
        when p_was_success then null
        else p_error_message
      end,
      last_metadata = p_metadata,
      updated_at = now_ts;
end;
$$;



-- >>> 72_chat_job_lifecycle_stage.sql

-- Persist last-known chat job lifecycle stage so operators can distinguish
-- queueing, runner pickup, provider request, batch wait/poll, streaming, and
-- post-processing failures from the same job record.

alter table public.chat_generation_jobs
  add column if not exists lifecycle_stage text not null default 'queued',
  add column if not exists failure_stage text;

comment on column public.chat_generation_jobs.lifecycle_stage is
  'Last known lifecycle stage for queued chat generation work (for example queued, runner_claimed, requesting_provider, post_processing, completed).';

comment on column public.chat_generation_jobs.failure_stage is
  'Lifecycle stage where the job most recently failed, or null when the current run has not failed.';

update public.chat_generation_jobs
set lifecycle_stage = case
      when status = 'pending' then 'queued'
      when status = 'processing' then 'runner_claimed'
      when status = 'success' then 'completed'
      when status = 'error' then coalesce(failure_stage, 'runner_claimed')
      else lifecycle_stage
    end,
    failure_stage = case
      when status = 'error' then coalesce(failure_stage, 'runner_claimed')
      else null
    end
where lifecycle_stage is null
   or lifecycle_stage = ''
   or (
     failure_stage is null
     and status = 'error'
   );



-- >>> 73_private_asset_delivery.sql

-- ============================================================================
-- Private asset delivery
-- ============================================================================
-- Keep imported character/module assets private in storage.
-- Runtime access now goes through authenticated app routes that mint signed URLs.

update storage.buckets
set public = false
where id in ('character-assets', 'module-assets');

drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Module assets: public read access" on storage.objects;



-- >>> 74_atomic_chat_job_claim.sql

-- Atomically claim the next pending chat generation job for the runner.

create index if not exists chat_generation_jobs_pending_created_idx
  on public.chat_generation_jobs (created_at)
  where status = 'pending';

create or replace function public.claim_pending_chat_job()
returns table (
  id uuid,
  payload jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
  with next_job as (
    select job.id
    from public.chat_generation_jobs job
    where job.status = 'pending'
    order by job.created_at asc
    for update skip locked
    limit 1
  ),
  claimed as (
    update public.chat_generation_jobs job
    set status = 'processing',
        lifecycle_stage = 'runner_claimed',
        failure_stage = null,
        error = null
    from next_job
    where job.id = next_job.id
    returning job.id, job.payload
  )
  select claimed.id, claimed.payload
  from claimed;
end;
$$;

revoke all on function public.claim_pending_chat_job() from public, anon, authenticated;
grant execute on function public.claim_pending_chat_job() to service_role;



-- >>> 75_list_current_user_modules.sql

-- Return lightweight module summaries for the current authenticated user.
-- This avoids loading large lorebook/regex/assets arrays just to compute counts.

create or replace function public.list_current_user_modules()
returns table (
  id uuid,
  name text,
  description text,
  source_file text,
  hide_icon boolean,
  created_at timestamptz,
  updated_at timestamptz,
  lorebook_count integer,
  regex_count integer,
  asset_count integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    module.id,
    module.name,
    module.description,
    module.source_file,
    coalesce(module.hide_icon, false) as hide_icon,
    module.created_at,
    module.updated_at,
    coalesce(array_length(module.lorebook, 1), 0)::integer as lorebook_count,
    coalesce(array_length(module.regex, 1), 0)::integer as regex_count,
    coalesce(array_length(module.assets, 1), 0)::integer as asset_count
  from public.modules module
  where module.user_id = auth.uid()
  order by module.created_at desc;
$$;

revoke all on function public.list_current_user_modules() from public, anon;
grant execute on function public.list_current_user_modules() to authenticated, service_role;



-- >>> 76_enable_chat_usage_stats.sql

alter table public.profiles
  add column if not exists enable_chat_usage_stats boolean not null default false;

comment on column public.profiles.enable_chat_usage_stats is
  'Show optional token, cache, and cost usage details in chat UI. Disabled by default to avoid extra background requests.';



-- >>> 77_retain_latest_assistant_debug_info.sql

-- Keep server-side debug_info only on the newest assistant message per chat.
-- Older assistant messages can still be displayed, but they no longer retain
-- heavyweight server diagnostics once a newer assistant reply exists.

with ranked_assistant_messages as (
  select
    message.id,
    row_number() over (
      partition by message.chat_id
      order by message.sequence desc nulls last, message.created_at desc, message.id desc
    ) as recency_rank
  from public.messages as message
  where message.role = 'assistant'
    and message.debug_info is not null
)
update public.messages as message
set debug_info = null
from ranked_assistant_messages as ranked
where message.id = ranked.id
  and ranked.recency_rank > 1
  and message.debug_info is not null;



-- >>> 78_drop_redundant_asset_storage_path_indexes.sql

-- character_assets.storage_path and module_assets.storage_path already have
-- unique constraints backed by btree indexes. The extra non-unique indexes on
-- the same column duplicate storage and write-maintenance cost without adding
-- a different access path.

drop index if exists public.idx_character_assets_storage_path;
drop index if exists public.idx_module_assets_storage_path;



-- >>> 79_drop_unused_character_asset_name_indexes.sql

-- character_assets name matching currently happens after loading the asset list
-- into application memory. These historical name indexes have shown no usage
-- in the current observation window and duplicate write/storage overhead.

drop index if exists public.idx_character_assets_display_name;
drop index if exists public.idx_character_assets_canonical_name;



-- >>> 81_fallback_match_chat_facts_to_full_scan.sql

-- Keep the recent-candidate fast path, but fall back to the full chat scan
-- when the recent window produces no matches above threshold.

create or replace function public.match_chat_facts(
  chat_id uuid,
  target_user_id uuid,
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
returns table (
  start_seq int,
  end_seq int,
  facts text,
  similarity float
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  requester uuid := auth.uid();
  effective_user uuid := target_user_id;
  candidate_limit integer := greatest(match_count * 100, 1000);
  recent_match_count bigint := 0;
begin
  if requester is not null then
    if effective_user is null then
      effective_user := requester;
    elsif effective_user <> requester then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
  end if;

  if effective_user is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chats c
    where c.id = match_chat_facts.chat_id
      and c.user_id = effective_user
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  return query
  with recent_candidates as (
    select
      cf.start_seq,
      cf.end_seq,
      cf.facts,
      cf.embedding
    from public.chat_facts cf
    where
      cf.chat_id = match_chat_facts.chat_id
      and cf.user_id = effective_user
      and cf.embedding is not null
    order by cf.start_seq desc
    limit candidate_limit
  )
  select
    recent_candidates.start_seq,
    recent_candidates.end_seq,
    recent_candidates.facts,
    1 - (recent_candidates.embedding <=> query_embedding) as similarity
  from recent_candidates
  where 1 - (recent_candidates.embedding <=> query_embedding) > match_threshold
  order by recent_candidates.embedding <=> query_embedding
  limit match_count;

  get diagnostics recent_match_count = row_count;
  if recent_match_count > 0 then
    return;
  end if;

  return query
  select
    cf.start_seq,
    cf.end_seq,
    cf.facts,
    1 - (cf.embedding <=> query_embedding) as similarity
  from public.chat_facts cf
  where
    cf.chat_id = match_chat_facts.chat_id
    and cf.user_id = effective_user
    and cf.embedding is not null
    and 1 - (cf.embedding <=> query_embedding) > match_threshold
  order by cf.embedding <=> query_embedding
  limit match_count;
end;
$$;



-- >>> 82_update_character_with_modules.sql

-- Update a character and replace its module links inside one transaction.
-- This prevents partial relink failures from clearing the existing link set.

create or replace function public.update_character_with_modules(
  p_character_id uuid,
  p_name text,
  p_description text,
  p_system_prompt text,
  p_greeting_message text,
  p_module_ids uuid[] default '{}'::uuid[],
  p_requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(p_requester, caller_uid);
  normalized_module_ids uuid[] := '{}'::uuid[];
  requested_module_count integer := 0;
  owned_module_count integer := 0;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role <> 'service_role' and effective_requester <> caller_uid then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  perform 1
  from public.characters
  where id = p_character_id
    and user_id = effective_requester
  for update;

  if not found then
    raise exception 'Character not found'
      using errcode = 'P0002';
  end if;

  with requested_modules as (
    select requested.module_id, min(requested.ordinality) as first_position
    from unnest(coalesce(p_module_ids, '{}'::uuid[])) with ordinality as requested(module_id, ordinality)
    where requested.module_id is not null
    group by requested.module_id
  )
  select coalesce(array_agg(module_id order by first_position), '{}'::uuid[]),
         count(*)::integer
    into normalized_module_ids, requested_module_count
  from requested_modules;

  if requested_module_count > 0 then
    select count(*)::integer
      into owned_module_count
    from public.modules
    where user_id = effective_requester
      and id = any(normalized_module_ids);

    if owned_module_count <> requested_module_count then
      raise exception 'Selected modules not found or not owned by requester'
        using errcode = '42501';
    end if;
  end if;

  update public.characters
  set name = p_name,
      description = p_description,
      system_prompt = p_system_prompt,
      greeting_message = p_greeting_message
  where id = p_character_id
    and user_id = effective_requester;

  delete from public.character_modules
  where character_id = p_character_id;

  insert into public.character_modules (character_id, module_id, enabled, priority)
  select p_character_id,
         requested.module_id,
         true,
         (cardinality(normalized_module_ids) - requested.ordinality + 1)
  from unnest(normalized_module_ids) with ordinality as requested(module_id, ordinality);
end;
$$;

revoke all on function public.update_character_with_modules(uuid, text, text, text, text, uuid[], uuid) from public, anon;
grant execute on function public.update_character_with_modules(uuid, text, text, text, text, uuid[], uuid) to authenticated, service_role;



-- >>> 83_raise_api_key_quota.sql

-- Raise the per-user API key quota for Vault-backed key creation.

create or replace function public.create_secret(
  secret_name text,
  secret_value text,
  requester uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  secret_id uuid;
  expected_prefix text;
  suffix text;
  max_keys constant integer := 20;
  current_key_count integer;
begin
  if effective_requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated create_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role is distinct from 'service_role' and effective_requester <> caller_uid then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'requester mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || effective_requester::text || '_';

  if left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'prefix mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if suffix !~ '^[a-z0-9_]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  select count(*) into current_key_count
  from public.api_keys
  where user_id = effective_requester;

  if current_key_count >= max_keys then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'api key quota exceeded');
    raise exception 'API key quota exceeded'
      using errcode = '54013';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (effective_requester, secret_name, 'create', null);

  return secret_id;
end;
$$;

revoke all on function public.create_secret(text, text) from public, anon, authenticated, service_role;
revoke all on function public.create_secret(text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_secret(text, text, uuid) to service_role;



-- >>> 84_harden_chat_scoped_rls.sql

-- Harden chat-scoped denormalized ownership and privileged chat aggregate RPCs.

create or replace function public.sync_chat_owned_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_owner_id uuid;
begin
  if new.chat_id is null then
    raise exception 'chat_id is required'
      using errcode = '22004';
  end if;

  select chats.user_id
    into chat_owner_id
    from public.chats
   where chats.id = new.chat_id;

  if chat_owner_id is null then
    raise exception 'Chat not found'
      using errcode = '23503';
  end if;

  new.user_id := chat_owner_id;
  return new;
end;
$$;

update public.messages as messages
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = messages.chat_id
   and messages.user_id is distinct from chats.user_id;

update public.chat_summaries as chat_summaries
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_summaries.chat_id
   and chat_summaries.user_id is distinct from chats.user_id;

update public.chat_facts as chat_facts
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_facts.chat_id
   and chat_facts.user_id is distinct from chats.user_id;

update public.chat_usage_events as chat_usage_events
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_usage_events.chat_id
   and chat_usage_events.user_id is distinct from chats.user_id;

update public.chat_generation_jobs as chat_generation_jobs
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_generation_jobs.chat_id
   and chat_generation_jobs.user_id is distinct from chats.user_id;

update public.chat_turns as chat_turns
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_turns.chat_id
   and chat_turns.user_id is distinct from chats.user_id;

drop trigger if exists set_message_user_id_trigger on public.messages;
create trigger set_message_user_id_trigger
  before insert or update of chat_id, user_id on public.messages
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists set_chat_summary_user_id_trigger on public.chat_summaries;
create trigger set_chat_summary_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_summaries
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_facts_user_id_trigger on public.chat_facts;
create trigger sync_chat_facts_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_facts
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_usage_events_user_id_trigger on public.chat_usage_events;
create trigger sync_chat_usage_events_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_usage_events
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_generation_jobs_user_id_trigger on public.chat_generation_jobs;
create trigger sync_chat_generation_jobs_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_generation_jobs
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_turns_user_id_trigger on public.chat_turns;
create trigger sync_chat_turns_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_turns
  for each row execute function public.sync_chat_owned_user_id();

drop policy if exists "Users can insert their messages" on public.messages;
drop policy if exists "Users can update their messages" on public.messages;

create policy "Users can insert their messages" on public.messages
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = messages.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their messages" on public.messages
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = messages.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = messages.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their summaries" on public.chat_summaries;
drop policy if exists "Users can update their summaries" on public.chat_summaries;

create policy "Users can insert their summaries" on public.chat_summaries
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_summaries.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their summaries" on public.chat_summaries
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = chat_summaries.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_summaries.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their own chat facts" on public.chat_facts;
drop policy if exists "Users can update their own chat facts" on public.chat_facts;

create policy "Users can insert their own chat facts" on public.chat_facts
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_facts.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own chat facts" on public.chat_facts
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = chat_facts.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_facts.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their usage events" on public.chat_usage_events;

create policy "Users can insert their usage events" on public.chat_usage_events
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_usage_events.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert chat jobs" on public.chat_generation_jobs;

create policy "Users can insert chat jobs" on public.chat_generation_jobs
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_generation_jobs.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their chat turns" on public.chat_turns;
drop policy if exists "Users can update their chat turns" on public.chat_turns;

create policy "Users can insert their chat turns" on public.chat_turns
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_turns.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their chat turns" on public.chat_turns
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = chat_turns.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_turns.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create or replace function public.get_chat_token_totals(
  p_chat_id uuid,
  p_requester uuid
)
returns table (
  prompt_tokens bigint,
  completion_tokens bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid;
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if auth.role() = 'service_role' then
    requester := p_requester;
  else
    requester := auth.uid();

    if requester is null or requester <> p_requester then
      raise exception 'Not authorized'
        using errcode = '42501';
    end if;
  end if;

  if not exists (
    select 1
      from public.chats as chats
     where chats.id = p_chat_id
       and chats.user_id = requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(messages.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(messages.completion_tokens), 0)::bigint as completion_tokens
      from public.messages as messages
     where messages.chat_id = p_chat_id
       and messages.user_id = requester;
end;
$$;

revoke all on function public.get_chat_token_totals(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_chat_token_totals(uuid, uuid) to authenticated;
grant execute on function public.get_chat_token_totals(uuid, uuid) to service_role;

create or replace function public.get_chat_usage_costs(
  p_chat_id uuid,
  p_requester uuid
)
returns table (
  prompt_tokens bigint,
  completion_tokens bigint,
  cached_input_tokens bigint,
  reasoning_tokens bigint,
  prompt_cost_usd double precision,
  completion_cost_usd double precision,
  cached_input_cost_usd double precision,
  reasoning_cost_usd double precision,
  total_cost_usd double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid;
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if auth.role() = 'service_role' then
    requester := p_requester;
  else
    requester := auth.uid();

    if requester is null or requester <> p_requester then
      raise exception 'Not authorized'
        using errcode = '42501';
    end if;
  end if;

  if not exists (
    select 1
      from public.chats as chats
     where chats.id = p_chat_id
       and chats.user_id = requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(chat_usage_events.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(chat_usage_events.completion_tokens), 0)::bigint as completion_tokens,
      coalesce(sum(chat_usage_events.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(chat_usage_events.reasoning_tokens), 0)::bigint as reasoning_tokens,
      coalesce(sum(chat_usage_events.prompt_cost_usd), 0)::double precision as prompt_cost_usd,
      coalesce(sum(chat_usage_events.completion_cost_usd), 0)::double precision as completion_cost_usd,
      coalesce(sum(chat_usage_events.cached_input_cost_usd), 0)::double precision as cached_input_cost_usd,
      coalesce(sum(chat_usage_events.reasoning_cost_usd), 0)::double precision as reasoning_cost_usd,
      coalesce(sum(chat_usage_events.total_cost_usd), 0)::double precision as total_cost_usd
      from public.chat_usage_events as chat_usage_events
     where chat_usage_events.chat_id = p_chat_id
       and chat_usage_events.user_id = requester;
end;
$$;

revoke all on function public.get_chat_usage_costs(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to authenticated;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to service_role;

revoke all on function public.record_service_health_status(text, boolean, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_service_health_status(text, boolean, text, jsonb)
  to service_role;



-- >>> 85_harden_turn_message_integrity.sql

-- Harden turn/message integrity without breaking the current two-phase write order.

update public.chat_turns as chat_turns
   set user_message_id = null
 where user_message_id is not null
   and not exists (
     select 1
       from public.messages as messages
      where messages.id = chat_turns.user_message_id
        and messages.role = 'user'
        and messages.chat_id = chat_turns.chat_id
        and messages.turn_id = chat_turns.id
   );

update public.chat_turns as chat_turns
   set active_assistant_message_id = null
 where active_assistant_message_id is not null
   and not exists (
     select 1
       from public.messages as messages
      where messages.id = chat_turns.active_assistant_message_id
        and messages.role = 'assistant'
        and messages.chat_id = chat_turns.chat_id
        and messages.turn_id = chat_turns.id
        and messages.message_status = 'completed'
   );

update public.chat_turns as chat_turns
   set user_message_id = (
     select messages.id
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'user'
      order by messages.sequence asc nulls last, messages.created_at asc, messages.id asc
      limit 1
   )
 where chat_turns.user_message_id is null
   and exists (
     select 1
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'user'
   );

update public.chat_turns as chat_turns
   set active_assistant_message_id = (
     select messages.id
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'assistant'
        and messages.message_status = 'completed'
      order by messages.variant_index desc nulls last, messages.sequence desc nulls last, messages.id desc
      limit 1
   )
 where chat_turns.active_assistant_message_id is null
   and exists (
     select 1
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'assistant'
        and messages.message_status = 'completed'
   );

alter table public.chat_turns
  add constraint chat_turns_distinct_message_pointers_check
  check (
    user_message_id is null
    or active_assistant_message_id is null
    or user_message_id <> active_assistant_message_id
  );

create unique index chat_turns_active_assistant_message_id_key
  on public.chat_turns (active_assistant_message_id)
  where active_assistant_message_id is not null;

create unique index messages_assistant_turn_variant_key
  on public.messages (turn_id, variant_index)
  where role = 'assistant' and turn_id is not null and variant_index is not null;

create or replace function public.validate_chat_turn_message_pointer(
  p_turn_id uuid,
  p_chat_id uuid,
  p_message_id uuid,
  p_expected_role text,
  p_pointer_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pointer_message record;
begin
  if p_message_id is null then
    return;
  end if;

  select
    messages.id,
    messages.chat_id,
    messages.role,
    messages.turn_id,
    messages.message_status
    into pointer_message
    from public.messages as messages
   where messages.id = p_message_id;

  if not found then
    -- Allow the current two-phase write order where turns may point at a future message id.
    return;
  end if;

  if pointer_message.chat_id <> p_chat_id then
    raise exception '% must reference a message in the same chat', p_pointer_name
      using errcode = '23514';
  end if;

  if pointer_message.role <> p_expected_role then
    raise exception '% must reference a % message', p_pointer_name, p_expected_role
      using errcode = '23514';
  end if;

  if p_expected_role = 'assistant' and pointer_message.message_status <> 'completed' then
    raise exception '% must reference a completed assistant message', p_pointer_name
      using errcode = '23514';
  end if;

  if pointer_message.turn_id is distinct from p_turn_id then
    raise exception '% must reference a message attached to the same chat turn', p_pointer_name
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.validate_chat_turn_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_message_id is not null
     and new.active_assistant_message_id is not null
     and new.user_message_id = new.active_assistant_message_id then
    raise exception 'chat turn user and active assistant pointers must be distinct'
      using errcode = '23514';
  end if;

  perform public.validate_chat_turn_message_pointer(
    new.id,
    new.chat_id,
    new.user_message_id,
    'user',
    'user_message_id'
  );

  perform public.validate_chat_turn_message_pointer(
    new.id,
    new.chat_id,
    new.active_assistant_message_id,
    'assistant',
    'active_assistant_message_id'
  );

  return new;
end;
$$;

create or replace function public.validate_message_turn_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  turn_row record;
  superseded_message record;
begin
  if new.role <> 'assistant' then
    if new.variant_index is not null then
      raise exception 'Only assistant messages may set variant_index'
        using errcode = '23514';
    end if;

    if new.supersedes_message_id is not null then
      raise exception 'Only assistant messages may supersede earlier variants'
        using errcode = '23514';
    end if;

    if new.message_status <> 'completed' then
      raise exception 'Only assistant messages may use non-completed message_status values'
        using errcode = '23514';
    end if;
  end if;

  if new.turn_id is null then
    if new.role = 'assistant'
       and (new.variant_index is not null or new.supersedes_message_id is not null) then
      raise exception 'Standalone assistant messages cannot declare variants or superseded links'
        using errcode = '23514';
    end if;

    return new;
  end if;

  select
    chat_turns.id,
    chat_turns.chat_id,
    chat_turns.user_message_id
    into turn_row
    from public.chat_turns as chat_turns
   where chat_turns.id = new.turn_id;

  if not found then
    raise exception 'Referenced chat turn not found'
      using errcode = '23503';
  end if;

  if turn_row.chat_id <> new.chat_id then
    raise exception 'Message turn_id must reference a turn in the same chat'
      using errcode = '23514';
  end if;

  if new.role = 'system' then
    raise exception 'System messages cannot reference chat turns'
      using errcode = '23514';
  end if;

  if new.role = 'user' then
    if turn_row.user_message_id is not null and turn_row.user_message_id <> new.id then
      raise exception 'Chat turn already points at a different user message'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.variant_index is null then
    raise exception 'Assistant messages attached to a turn must set variant_index'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.messages as messages
     where messages.id <> new.id
       and messages.turn_id = new.turn_id
       and messages.role = 'assistant'
       and messages.variant_index = new.variant_index
  ) then
    raise exception 'Assistant variant_index must be unique within a turn'
      using errcode = '23505';
  end if;

  if new.supersedes_message_id is not null then
    select
      messages.id,
      messages.chat_id,
      messages.turn_id,
      messages.role
      into superseded_message
      from public.messages as messages
     where messages.id = new.supersedes_message_id;

    if found then
      if superseded_message.role <> 'assistant' then
        raise exception 'Assistant variants may only supersede assistant messages'
          using errcode = '23514';
      end if;

      if superseded_message.chat_id <> new.chat_id
         or superseded_message.turn_id is distinct from new.turn_id then
        raise exception 'Assistant variants may only supersede earlier variants in the same turn'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_chat_turn_references_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.role = 'user'
       and old.turn_id is not null
       and (old.turn_id is distinct from new.turn_id or new.role <> 'user') then
      update public.chat_turns
         set user_message_id = null
       where id = old.turn_id
         and user_message_id = old.id;
    end if;

    if old.role = 'assistant'
       and old.turn_id is not null
       and (
         old.turn_id is distinct from new.turn_id
         or new.role <> 'assistant'
         or new.message_status <> 'completed'
       ) then
      update public.chat_turns
         set active_assistant_message_id = null
       where id = old.turn_id
         and active_assistant_message_id = old.id;
    end if;
  end if;

  if new.role = 'user' and new.turn_id is not null then
    update public.chat_turns
       set user_message_id = new.id
     where id = new.turn_id
       and (user_message_id is null or user_message_id = new.id);
  elsif new.role = 'assistant' and new.turn_id is not null then
    if new.message_status = 'completed' then
      update public.chat_turns
         set active_assistant_message_id = new.id
       where id = new.turn_id
         and (active_assistant_message_id is null or active_assistant_message_id = new.id);
    else
      update public.chat_turns
         set active_assistant_message_id = null
       where id = new.turn_id
         and active_assistant_message_id = new.id;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.clear_chat_turn_references_on_message_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'user' and old.turn_id is not null then
    update public.chat_turns
       set user_message_id = null
     where id = old.turn_id
       and user_message_id = old.id;
  elsif old.role = 'assistant' and old.turn_id is not null then
    update public.chat_turns
       set active_assistant_message_id = null
     where id = old.turn_id
       and active_assistant_message_id = old.id;
  end if;

  return null;
end;
$$;

drop trigger if exists validate_chat_turn_integrity_trigger on public.chat_turns;
create trigger validate_chat_turn_integrity_trigger
  before insert or update of chat_id, user_message_id, active_assistant_message_id
  on public.chat_turns
  for each row execute function public.validate_chat_turn_integrity();

drop trigger if exists validate_message_turn_integrity_trigger on public.messages;
create trigger validate_message_turn_integrity_trigger
  before insert or update of chat_id, turn_id, role, variant_index, supersedes_message_id, message_status
  on public.messages
  for each row execute function public.validate_message_turn_integrity();

drop trigger if exists sync_chat_turn_references_from_message_trigger on public.messages;
create trigger sync_chat_turn_references_from_message_trigger
  after insert or update of turn_id, role, message_status
  on public.messages
  for each row execute function public.sync_chat_turn_references_from_message();

drop trigger if exists clear_chat_turn_references_on_message_delete_trigger on public.messages;
create trigger clear_chat_turn_references_on_message_delete_trigger
  after delete on public.messages
  for each row execute function public.clear_chat_turn_references_on_message_delete();



-- >>> 86_add_hot_path_indexes.sql

-- Add indexes for the hottest remaining read paths:
-- 1. recent-candidate chat fact retrieval for RAG
-- 2. historical chat job pruning by terminal status

create index if not exists chat_facts_recent_candidates_idx
  on public.chat_facts (chat_id, user_id, start_seq desc)
  where embedding is not null;

create index if not exists chat_generation_jobs_success_created_at_idx
  on public.chat_generation_jobs (created_at)
  where status = 'success';

create index if not exists chat_generation_jobs_error_created_at_idx
  on public.chat_generation_jobs (created_at)
  where status = 'error';



-- >>> 87_enforce_usage_event_job_state_and_memory_ranges.sql

-- Enforce idempotent usage telemetry, import job state shape, and non-overlapping memory ranges.

-- 1. Usage events should be idempotent per chat request.
with ranked_usage_events as (
  select
    id,
    row_number() over (
      partition by request_id
      order by created_at asc, id asc
    ) as duplicate_rank
  from public.chat_usage_events
)
delete from public.chat_usage_events
using ranked_usage_events
where public.chat_usage_events.id = ranked_usage_events.id
  and ranked_usage_events.duplicate_rank > 1;

create unique index if not exists chat_usage_events_request_id_idx
  on public.chat_usage_events (request_id);

-- 2. Import jobs should have a coherent status/timestamp/result shape.
update public.charx_import_jobs
   set started_at = null,
       completed_at = null,
       error_message = null,
       result = null
 where status = 'pending';

update public.charx_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = null,
       error_message = null,
       result = null
 where status = 'processing';

update public.charx_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = null,
       result = coalesce(result, jsonb_build_object('success', true))
 where status = 'success';

update public.charx_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = coalesce(error_message, 'Unknown import failure'),
       result = null
 where status = 'error';

alter table public.charx_import_jobs
  drop constraint if exists charx_import_jobs_state_shape_check;

alter table public.charx_import_jobs
  add constraint charx_import_jobs_state_shape_check
  check (
    case status
      when 'pending' then
        started_at is null
        and completed_at is null
        and error_message is null
        and result is null
      when 'processing' then
        started_at is not null
        and completed_at is null
        and error_message is null
        and result is null
      when 'success' then
        started_at is not null
        and completed_at is not null
        and error_message is null
        and result is not null
      when 'error' then
        started_at is not null
        and completed_at is not null
        and error_message is not null
        and result is null
      else false
    end
  );

update public.risum_import_jobs
   set started_at = null,
       completed_at = null,
       error_message = null,
       result = null
 where status = 'pending';

update public.risum_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = null,
       error_message = null,
       result = null
 where status = 'processing';

update public.risum_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = null,
       result = coalesce(result, jsonb_build_object('success', true))
 where status = 'success';

update public.risum_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = coalesce(error_message, 'Unknown import failure'),
       result = null
 where status = 'error';

alter table public.risum_import_jobs
  drop constraint if exists risum_import_jobs_state_shape_check;

alter table public.risum_import_jobs
  add constraint risum_import_jobs_state_shape_check
  check (
    case status
      when 'pending' then
        started_at is null
        and completed_at is null
        and error_message is null
        and result is null
      when 'processing' then
        started_at is not null
        and completed_at is null
        and error_message is null
        and result is null
      when 'success' then
        started_at is not null
        and completed_at is not null
        and error_message is null
        and result is not null
      when 'error' then
        started_at is not null
        and completed_at is not null
        and error_message is not null
        and result is null
      else false
    end
  );

-- 3. Summary/fact ranges should not overlap within the same chat scope.
create or replace function public.enforce_non_overlapping_chat_summary_ranges()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from public.chat_summaries existing
     where existing.chat_id = new.chat_id
       and existing.level = new.level
       and existing.id is distinct from new.id
       and existing.start_seq <= new.end_seq
       and existing.end_seq >= new.start_seq
  ) then
    raise exception 'Overlapping chat summary range for this chat/level'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_non_overlapping_chat_summary_ranges_trigger
  on public.chat_summaries;

create trigger enforce_non_overlapping_chat_summary_ranges_trigger
  before insert or update of chat_id, level, start_seq, end_seq
  on public.chat_summaries
  for each row execute function public.enforce_non_overlapping_chat_summary_ranges();

create or replace function public.enforce_non_overlapping_chat_fact_ranges()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from public.chat_facts existing
     where existing.chat_id = new.chat_id
       and existing.id is distinct from new.id
       and existing.start_seq <= new.end_seq
       and existing.end_seq >= new.start_seq
  ) then
    raise exception 'Overlapping chat fact range for this chat'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_non_overlapping_chat_fact_ranges_trigger
  on public.chat_facts;

create trigger enforce_non_overlapping_chat_fact_ranges_trigger
  before insert or update of chat_id, start_seq, end_seq
  on public.chat_facts
  for each row execute function public.enforce_non_overlapping_chat_fact_ranges();



-- >>> 88_add_atr_default_to_profiles.sql

alter table public.profiles
  add column if not exists enable_agentic_transcript_recall_default boolean not null default false;

comment on column public.profiles.enable_agentic_transcript_recall_default is
  'Account-level default for experimental agentic transcript recall on chats that inherit the account setting.';



-- >>> 89_chat_summary_status.sql

alter table public.chat_summaries
  add column if not exists summary_status text not null default 'ok';

alter table public.chat_summaries
  drop constraint if exists chat_summaries_summary_status_check;

alter table public.chat_summaries
  add constraint chat_summaries_summary_status_check
  check (summary_status in ('ok', 'fallback'));

comment on column public.chat_summaries.summary_status is
  'Current content state for this summary row: ok for model-generated content, fallback for local fallback content.';



-- >>> 90_harden_profile_admin_and_import_limits.sql

-- Prevent authenticated users from granting themselves operator privileges.
-- Service-role clients and direct database operators can still maintain admins.

create or replace function public.prevent_unprivileged_profile_admin_flag_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  jwt_role text := auth.role();
begin
  if (
    tg_op = 'INSERT'
    and new.is_admin is true
  ) or (
    tg_op = 'UPDATE'
    and new.is_admin is distinct from old.is_admin
  ) then
    if jwt_role = 'service_role' or current_user in ('service_role', 'postgres', 'supabase_admin') then
      return new;
    end if;

    raise exception 'profiles.is_admin is service-role managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_unprivileged_profile_admin_flag_change_trigger
  on public.profiles;

create trigger prevent_unprivileged_profile_admin_flag_change_trigger
  before insert or update of is_admin on public.profiles
  for each row
  execute function public.prevent_unprivileged_profile_admin_flag_change();



-- >>> 91_add_chat_last_message_at.sql

-- Add a denormalized chat recency timestamp for recent-conversation lists.

alter table public.chats
  add column last_message_at timestamptz;

update public.chats as chats
   set last_message_at = message_recency.last_message_at
  from (
    select
      messages.chat_id,
      max(messages.created_at) as last_message_at
    from public.messages as messages
    where messages.role in ('user', 'assistant')
    group by messages.chat_id
  ) as message_recency
 where chats.id = message_recency.chat_id;

create or replace function public.advance_chat_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role in ('user', 'assistant') then
    update public.chats
       set last_message_at = greatest(
         coalesce(last_message_at, new.created_at),
         new.created_at
       )
     where id = new.chat_id;
  end if;

  return null;
end;
$$;

drop trigger if exists advance_chat_last_message_at_trigger on public.messages;
create trigger advance_chat_last_message_at_trigger
  after insert on public.messages
  for each row execute function public.advance_chat_last_message_at();

create or replace function public.recalculate_chat_last_message_at(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chats as chats
     set last_message_at = (
       select max(messages.created_at)
         from public.messages as messages
        where messages.chat_id = p_chat_id
          and messages.role in ('user', 'assistant')
     )
   where chats.id = p_chat_id;
end;
$$;

revoke all on function public.recalculate_chat_last_message_at(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.recalculate_chat_last_message_at_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role in ('user', 'assistant') then
    perform public.recalculate_chat_last_message_at(old.chat_id);
  end if;

  return null;
end;
$$;

drop trigger if exists recalculate_chat_last_message_at_after_delete_trigger on public.messages;
create trigger recalculate_chat_last_message_at_after_delete_trigger
  after delete on public.messages
  for each row execute function public.recalculate_chat_last_message_at_after_delete();

create or replace function public.recalculate_chat_last_message_at_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.chat_id is distinct from new.chat_id then
    if old.role in ('user', 'assistant') then
      perform public.recalculate_chat_last_message_at(old.chat_id);
    end if;

    if new.role in ('user', 'assistant') then
      perform public.recalculate_chat_last_message_at(new.chat_id);
    end if;

    return null;
  end if;

  if old.role is distinct from new.role
     or old.created_at is distinct from new.created_at then
    if old.role in ('user', 'assistant')
       or new.role in ('user', 'assistant') then
      perform public.recalculate_chat_last_message_at(new.chat_id);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists recalculate_chat_last_message_at_after_update_trigger on public.messages;
create trigger recalculate_chat_last_message_at_after_update_trigger
  after update of chat_id, role, created_at on public.messages
  for each row execute function public.recalculate_chat_last_message_at_after_update();



-- >>> 92_drop_obsolete_public_asset_url_rpcs.sql

-- Remove legacy RPCs that expose public character asset URLs.
-- Character assets are private and are delivered through signed URLs.

drop function if exists public.get_character_assets(uuid);
drop function if exists public.get_character_asset_url(uuid);



-- >>> 93_separate_llm_model_preferences.sql

alter table public.profiles
  add column summary_model_name text,
  add column reprocess_model_name text,
  add column translation_model_name text;

comment on column public.profiles.summary_model_name is
  'Optional explicit model paired with summary_api_key_id. Null preserves the legacy credential preference and provider default fallbacks.';

comment on column public.profiles.reprocess_model_name is
  'Optional explicit model paired with reprocess_api_key_id. Null preserves the legacy credential preference and provider default fallbacks.';

comment on column public.profiles.translation_model_name is
  'Optional explicit model paired with translation_api_key_id. Null preserves the legacy credential preference and provider default fallbacks.';



-- >>> 94_atomic_chat_submission.sql

-- Persist a chat submission and its generation job in one transaction.
-- The RPC is service-only so job payloads and API-key references stay behind
-- the existing /api/chat server boundary.

create or replace function public.submit_chat_generation_job(
  p_chat_id uuid,
  p_requester uuid,
  p_turn_id uuid,
  p_user_message_id uuid,
  p_user_message_content text,
  p_job_payload jsonb,
  p_delivery_mode text,
  p_is_regeneration boolean,
  p_regenerate_assistant_message_id uuid
)
returns table (
  job_id uuid,
  turn_id uuid,
  user_message_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_turn_id uuid;
  effective_user_message_id uuid;
  latest_turn_id uuid;
  next_turn_index bigint;
  inserted_job_id uuid;
  effective_job_payload jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_chat_id is null
     or p_requester is null
     or p_job_payload is null
     or jsonb_typeof(p_job_payload) is distinct from 'object' then
    raise exception 'Invalid chat submission'
      using errcode = '22023';
  end if;

  if p_delivery_mode not in ('streaming', 'anthropic_batch') then
    raise exception 'Invalid chat delivery mode'
      using errcode = '22023';
  end if;

  if p_job_payload ->> 'chatId' is distinct from p_chat_id::text
     or p_job_payload ->> 'userId' is distinct from p_requester::text
     or p_job_payload ->> 'deliveryMode' is distinct from p_delivery_mode
     or p_job_payload ->> 'isRegeneration' is distinct from (
       case when p_is_regeneration then 'true' else 'false' end
     ) then
    raise exception 'Chat submission payload does not match its envelope'
      using errcode = '22023';
  end if;

  -- Lock the owned chat before admission or turn allocation. Requests for
  -- different chats remain independent, while same-chat submissions serialize.
  perform 1
    from public.chats as chats
   where chats.id = p_chat_id
     and chats.user_id = p_requester
   for update;

  if not found then
    raise exception 'Chat not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.chat_generation_jobs as jobs
     where jobs.chat_id = p_chat_id
       and jobs.status in ('pending', 'processing')
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate key value violates unique constraint "chat_generation_jobs_active_chat_idx"',
      constraint = 'chat_generation_jobs_active_chat_idx';
  end if;

  if p_is_regeneration then
    if p_turn_id is not null
       or p_user_message_id is not null
       or p_user_message_content is not null
       or p_regenerate_assistant_message_id is null
       or p_job_payload ->> 'regenerateAssistantMessageId'
         is distinct from p_regenerate_assistant_message_id::text then
      raise exception 'Invalid regeneration target'
        using errcode = '22023';
    end if;

    select turns.id
      into effective_turn_id
      from public.chat_turns as turns
     where turns.chat_id = p_chat_id
       and turns.active_assistant_message_id = p_regenerate_assistant_message_id;

    if not found then
      raise exception 'Invalid regeneration target'
        using errcode = '22023';
    end if;

    select turns.id
      into latest_turn_id
      from public.chat_turns as turns
     where turns.chat_id = p_chat_id
     order by turns.turn_index desc
     limit 1;

    if latest_turn_id is distinct from effective_turn_id then
      raise exception 'Only the latest assistant message can be regenerated'
        using errcode = '22023';
    end if;

    effective_user_message_id := null;
  else
    if p_turn_id is null
       or p_user_message_id is null
       or p_user_message_content is null
       or p_regenerate_assistant_message_id is not null
       or p_job_payload ->> 'turnId' is distinct from p_turn_id::text then
      raise exception 'Invalid user message'
        using errcode = '22023';
    end if;

    select coalesce(max(turns.turn_index), 0) + 1
      into next_turn_index
      from public.chat_turns as turns
     where turns.chat_id = p_chat_id;

    insert into public.chat_turns (
      id,
      chat_id,
      user_id,
      turn_index,
      user_message_id,
      active_assistant_message_id
    )
    values (
      p_turn_id,
      p_chat_id,
      p_requester,
      next_turn_index,
      p_user_message_id,
      null
    );

    insert into public.messages (
      id,
      chat_id,
      user_id,
      role,
      content,
      turn_id,
      message_status
    )
    values (
      p_user_message_id,
      p_chat_id,
      p_requester,
      'user',
      p_user_message_content,
      p_turn_id,
      'completed'
    );

    effective_turn_id := p_turn_id;
    effective_user_message_id := p_user_message_id;
  end if;

  effective_job_payload := jsonb_set(
    p_job_payload,
    '{turnId}',
    to_jsonb(effective_turn_id),
    true
  );

  insert into public.chat_generation_jobs (
    chat_id,
    user_id,
    status,
    lifecycle_stage,
    failure_stage,
    delivery_mode,
    payload
  )
  values (
    p_chat_id,
    p_requester,
    'pending',
    'queued',
    null,
    p_delivery_mode,
    effective_job_payload
  )
  returning id into inserted_job_id;

  return query
  select inserted_job_id, effective_turn_id, effective_user_message_id;
end;
$$;

revoke all on function public.submit_chat_generation_job(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  uuid
) from public, anon, authenticated;

grant execute on function public.submit_chat_generation_job(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  uuid
) to service_role;

