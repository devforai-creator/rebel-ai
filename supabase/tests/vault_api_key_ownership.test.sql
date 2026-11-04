begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

create temporary table vault_fixture as
select owner_a, owner_b, gen_random_uuid() as forged_key, gen_random_uuid() as legacy_key,
       'apikey_' || owner_b::text || '_fixture_openai' as secret_b,
       'apikey_' || left(replace(owner_a::text, '-', ''), 12) || '_legacy_openai' as legacy_secret_a
from (select gen_random_uuid() as owner_a, gen_random_uuid() as owner_b) as owners;
grant select on vault_fixture to authenticated, service_role;

insert into auth.users (id, aud, role, email)
select owner_a, 'authenticated', 'authenticated', owner_a::text || '@vault.test' from vault_fixture
union all
select owner_b, 'authenticated', 'authenticated', owner_b::text || '@vault.test' from vault_fixture;
insert into public.profiles (id)
select owner_a from vault_fixture union all select owner_b from vault_fixture
on conflict do nothing;

select vault.create_secret('dummy-b', secret_b) from vault_fixture;
select vault.create_secret('dummy-legacy-a', legacy_secret_a) from vault_fixture;

-- Simulate rows that were present before the write guard was installed.
alter table public.api_keys disable trigger validate_api_key_secret_binding;
insert into public.api_keys (id, user_id, provider, key_name, vault_secret_name)
select forged_key, owner_a, 'openai', 'Forged fixture', secret_b from vault_fixture
union all
select legacy_key, owner_a, 'openai', 'Legacy fixture', legacy_secret_a from vault_fixture;
alter table public.api_keys enable trigger validate_api_key_secret_binding;

set local role service_role;
select throws_ok(
  $$select public.get_decrypted_secret(secret_b, owner_a) from vault_fixture$$,
  '42501', 'Not authorized', 'service-role decryption rejects the existing forged binding'
);
select is(
  (select public.get_decrypted_secret(legacy_secret_a, owner_a) from vault_fixture),
  'dummy-legacy-a', 'an existing legacy binding decrypts for its owner'
);

reset role;
select set_config('request.jwt.claim.sub', owner_a::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true)
from vault_fixture;
set local role authenticated;
select lives_ok(
  $$update public.api_keys set is_active = false where id = (select legacy_key from vault_fixture)$$,
  'the owner can still update legacy key metadata'
);
select lives_ok(
  $$select public.delete_api_key(forged_key) from vault_fixture$$,
  'the forged metadata row can be removed'
);
select lives_ok(
  $$select public.delete_api_key(legacy_key) from vault_fixture$$,
  'the owner can remove a legacy API key'
);

reset role;
select is(
  (select decrypted_secret from vault.decrypted_secrets where name = (select secret_b from vault_fixture)),
  'dummy-b', 'removing forged metadata preserves the other account''s Vault secret'
);
select is(
  (select count(*)::integer from vault.secrets where name = (select legacy_secret_a from vault_fixture)),
  0, 'the legacy key deletion also removes its Vault secret'
);

select * from finish();
rollback;
