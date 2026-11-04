begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

create temporary table review_access_ids as
select gen_random_uuid() as owner_a, gen_random_uuid() as owner_b,
       gen_random_uuid() as card_a, gen_random_uuid() as card_b,
       gen_random_uuid() as public_card, gen_random_uuid() as chat_a,
       gen_random_uuid() as chat_b, gen_random_uuid() as module_a,
       gen_random_uuid() as module_b;
grant select on review_access_ids to authenticated, anon, service_role;

insert into auth.users (id, aud, role, email)
select owner_a, 'authenticated', 'authenticated', owner_a::text || '@access.test' from review_access_ids
union all
select owner_b, 'authenticated', 'authenticated', owner_b::text || '@access.test' from review_access_ids;
insert into public.profiles (id)
select owner_a from review_access_ids union all select owner_b from review_access_ids
on conflict do nothing;

insert into public.characters (id, user_id, name, system_prompt, visibility)
select card_a, owner_a, 'Own', 'Own', 'private'::public.character_visibility from review_access_ids
union all
select card_b, owner_b, 'Foreign', 'Secret', 'private'::public.character_visibility from review_access_ids
union all
select public_card, owner_b, 'Public', 'Public', 'public'::public.character_visibility from review_access_ids;
insert into public.chats (id, user_id, character_id)
select chat_a, owner_a, card_a from review_access_ids union all
select chat_b, owner_b, card_b from review_access_ids;
insert into public.modules (id, user_id, name)
select module_a, owner_a, 'Own' from review_access_ids union all
select module_b, owner_b, 'Foreign' from review_access_ids;

select set_config('request.jwt.claim.sub', owner_a::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true)
from review_access_ids;
set local role authenticated;

select is((select count(*)::int from public.characters where id = (select card_b from review_access_ids)),
          0, 'foreign private card is not visible');
select throws_ok(
  $$update public.chats set character_id = (select card_b from review_access_ids)
    where id = (select chat_a from review_access_ids)$$,
  '42501', null, 'cannot relink own chat to a foreign private card'
);
select is((select character_id from public.chats where id = (select chat_a from review_access_ids)),
          (select card_a from review_access_ids), 'rejected relink preserves original reference');
select lives_ok(
  $$update public.chats set character_id = (select public_card from review_access_ids)
    where id = (select chat_a from review_access_ids)$$,
  'can relink own chat to an accessible public card'
);
reset role;
update public.characters set visibility = 'private'
where id = (select public_card from review_access_ids);
set local role authenticated;
select lives_ok(
  $$update public.chats set title = 'Retain history' where id = (select chat_a from review_access_ids)$$,
  'ordinary metadata changes remain possible after a card is made private'
);
select lives_ok(
  $$update public.chats set character_id = (select card_a from review_access_ids)
    where id = (select chat_a from review_access_ids)$$,
  'can relink own chat back to an owned card'
);
reset role;
update public.characters set visibility = 'public', archived_at = now()
where id = (select public_card from review_access_ids);
set local role authenticated;
select throws_ok(
  $$update public.chats set character_id = (select public_card from review_access_ids)
    where id = (select chat_a from review_access_ids)$$,
  '42501', null, 'cannot relink to an archived foreign public card'
);
select throws_ok(
  $$insert into public.chats (user_id, character_id)
    select owner_a, card_b from review_access_ids$$,
  '42501', null, 'cannot create a chat linked to a foreign private card'
);

select lives_ok(
  $$insert into public.character_modules (character_id, module_id)
    select card_a, module_a from review_access_ids$$,
  'owner can link their own module'
);
select throws_ok(
  $$insert into public.character_modules (character_id, module_id)
    select card_a, module_b from review_access_ids$$,
  '42501', null, 'cannot link another owner''s module'
);
select throws_ok(
  $$update public.character_modules set module_id = (select module_b from review_access_ids)
    where character_id = (select card_a from review_access_ids)$$,
  '42501', null, 'cannot replace an owned link with another owner''s module'
);
select throws_ok(
  $$insert into public.chat_generation_jobs (chat_id, user_id, status, payload)
    select chat_a, owner_a, 'pending', jsonb_build_object('chatId', chat_a, 'userId', owner_a)
    from review_access_ids$$,
  '42501', null, 'chat owners cannot bypass server queue admission'
);
select throws_ok(
  $$insert into public.charx_import_jobs (user_id, storage_path, original_filename)
    select owner_a, owner_a::text || '/imports/test.rbx', 'test.rbx' from review_access_ids$$,
  '42501', null, 'upload owners cannot bypass ticket verification by inserting a job'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok(
  $$insert into public.chat_generation_jobs (chat_id, user_id, status, payload)
    select chat_a, owner_a, 'pending', jsonb_build_object('chatId', chat_b, 'userId', owner_b)
    from review_access_ids$$,
  '23514', null, 'even a privileged insert cannot queue a job with another owner in its payload'
);
select lives_ok(
  $$insert into public.chat_generation_jobs (chat_id, user_id, status, payload)
    select chat_a, owner_a, 'pending', jsonb_build_object('chatId', chat_a, 'userId', owner_a)
    from review_access_ids$$,
  'server can queue a job with matching chat and owner'
);
select lives_ok(
  $$insert into public.charx_import_jobs (user_id, storage_path, original_filename)
    select owner_a, owner_a::text || '/imports/test.rbx', 'test.rbx' from review_access_ids$$,
  'server can queue verified imports'
);

reset role;
insert into realtime.messages (topic, extension, event, payload, private, skip_broadcast)
select 'chat-' || chat_a::text, 'broadcast', 'assistant-stream', '{"synthetic":true}'::jsonb, true, true
from review_access_ids;
select set_config('realtime.topic', 'chat-' || chat_a::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true)
from review_access_ids;
set local role authenticated;
select is((select count(*)::int from realtime.messages where event = 'assistant-stream'
           and topic = (select 'chat-' || chat_a::text from review_access_ids)),
          1, 'owner can receive assistant broadcasts on the private topic');
select throws_ok(
  $$insert into realtime.messages (topic, extension, event, payload, private, skip_broadcast)
    select 'chat-' || chat_a::text, 'broadcast', 'assistant-stream', '{}'::jsonb, true, true
    from review_access_ids$$,
  '42501', null, 'owner cannot impersonate the server by sending broadcasts'
);
reset role;
select set_config('request.jwt.claim.sub', owner_b::text, true) from review_access_ids;
set local role authenticated;
select is((select count(*)::int from realtime.messages where event = 'assistant-stream'),
          0, 'other authenticated users cannot receive on the owner topic');
reset role;
select set_config('request.jwt.claim.sub', owner_a::text, true),
       set_config('realtime.topic', 'chat-' || chat_b::text, true) from review_access_ids;
set local role authenticated;
select is((select count(*)::int from realtime.messages where event = 'assistant-stream'),
          0, 'owner cannot authorize a different user topic');
reset role;
select set_config('realtime.topic', 'chat-invalid', true);
set local role authenticated;
select is((select count(*)::int from realtime.messages where event = 'assistant-stream'),
          0, 'malformed topics do not authorize a subscription');
reset role;
select set_config('realtime.topic', 'chat-' || chat_a::text, true),
       set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', 'anon', true) from review_access_ids;
set local role anon;
select is((select count(*)::int from realtime.messages where event = 'assistant-stream'),
          0, 'anonymous users cannot receive private assistant streams');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $$insert into realtime.messages (topic, extension, event, payload, private, skip_broadcast)
    select 'chat-' || chat_a::text, 'broadcast', 'assistant-stream', '{}'::jsonb, true, true
    from review_access_ids$$,
  'service role can send assistant broadcasts'
);
reset role;
select ok(not has_function_privilege('authenticated', 'public.validate_chat_character_link()', 'execute'),
          'validation trigger is not a client-callable RPC');
select * from finish();
rollback;
