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
-- ============================================================================
-- Migration 31: Profiles opt-in + Voyage embedding API key wiring
-- ============================================================================

alter table public.api_keys
  drop constraint if exists api_keys_provider_check;

alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'deepseek', 'openrouter', 'voyage_embeddings'));

alter table public.profiles
  add column if not exists voyage_embedding_api_key_id uuid references public.api_keys(id),
  add column if not exists enable_episodic_rag boolean not null default false;
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
-- ============================================================================
-- Add per-chat custom system prompt override
-- Allows users to replace the global system prompt via the dashboard UI
-- ============================================================================

ALTER TABLE public.chats
  ADD COLUMN custom_system_prompt text;

COMMENT ON COLUMN public.chats.custom_system_prompt
  IS 'Optional override prepended ahead of character/preset prompts. When NULL, the global system prompt is used.';
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
-- Add admin flag to profiles for operator-only features

alter table public.profiles
add column if not exists is_admin boolean not null default false;
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
-- Track OpenAI service tier preference per BYOK entry

alter table public.api_keys
  add column service_tier text not null default 'standard'
    check (service_tier in ('batch', 'flex', 'priority', 'standard'));

comment on column public.api_keys.service_tier is
  'Optional OpenAI service tier preference (standard | flex | priority | batch)';
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
alter table public.profiles
  add column summary_api_key_id uuid references public.api_keys (id) on delete set null;

comment on column public.profiles.summary_api_key_id is 'Optional API key used for summary generation. Defaults to the chat API key when null.';
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
