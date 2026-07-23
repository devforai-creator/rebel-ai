#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const dotenv = require('dotenv')

const EXPECTED_STORAGE_POLICIES = [
  {
    name: 'Users can upload to their own folder',
    command: 'INSERT',
    bucket: 'character-assets',
  },
  {
    name: 'Users can update their own files',
    command: 'UPDATE',
    bucket: 'character-assets',
  },
  {
    name: 'Users can delete their own files',
    command: 'DELETE',
    bucket: 'character-assets',
  },
  {
    name: 'Module assets: users can upload to own folder',
    command: 'INSERT',
    bucket: 'module-assets',
  },
  {
    name: 'Module assets: users can update own files',
    command: 'UPDATE',
    bucket: 'module-assets',
  },
  {
    name: 'Module assets: users can delete own files',
    command: 'DELETE',
    bucket: 'module-assets',
  },
  {
    name: 'Users can upload their CharX archives',
    command: 'INSERT',
    bucket: 'charx-uploads',
  },
  {
    name: 'Users can update their CharX archives',
    command: 'UPDATE',
    bucket: 'charx-uploads',
  },
  {
    name: 'Users can delete their CharX archives',
    command: 'DELETE',
    bucket: 'charx-uploads',
  },
  {
    name: 'Users can read their CharX archives',
    command: 'SELECT',
    bucket: 'charx-uploads',
  },
]

const FORBIDDEN_FUNCTION_GRANTS = [
  ['public.check_anon_rate_limit(text,integer,integer)', 'anon'],
  ['public.check_anon_rate_limit(text,integer,integer)', 'authenticated'],
  ['public.check_chat_rate_limit(uuid,integer,integer)', 'anon'],
  ['public.check_chat_rate_limit(uuid,integer,integer)', 'authenticated'],
  ['public.claim_pending_chat_job()', 'anon'],
  ['public.claim_pending_chat_job()', 'authenticated'],
  ['public.create_secret(text,text)', 'anon'],
  ['public.create_secret(text,text)', 'authenticated'],
  ['public.create_secret(text,text)', 'service_role'],
  ['public.create_secret(text,text,uuid)', 'anon'],
  ['public.create_secret(text,text,uuid)', 'authenticated'],
  ['public.delete_api_key(uuid,uuid)', 'anon'],
  ['public.delete_orphaned_modules(uuid[],uuid)', 'anon'],
  ['public.delete_secret(text)', 'anon'],
  ['public.delete_secret(text)', 'authenticated'],
  ['public.delete_secret(text)', 'service_role'],
  ['public.delete_secret(text,uuid)', 'anon'],
  ['public.delete_secret(text,uuid)', 'authenticated'],
  ['public.get_chat_token_totals(uuid,uuid)', 'anon'],
  ['public.get_chat_usage_costs(uuid,uuid)', 'anon'],
  ['public.get_decrypted_secret(text,uuid)', 'anon'],
  ['public.get_decrypted_secret(text,uuid)', 'authenticated'],
  ['public.list_current_user_modules()', 'anon'],
  ['public.match_chat_facts(uuid,uuid,public.vector,double precision,integer)', 'anon'],
  ['public.recalculate_chat_last_message_at(uuid)', 'anon'],
  ['public.recalculate_chat_last_message_at(uuid)', 'authenticated'],
  ['public.recalculate_chat_last_message_at(uuid)', 'service_role'],
  ['public.record_service_health_status(text,boolean,text,jsonb)', 'anon'],
  ['public.record_service_health_status(text,boolean,text,jsonb)', 'authenticated'],
  ['public.update_character_with_modules(uuid,text,text,text,text,uuid[],uuid)', 'anon'],
]

const REQUIRED_FUNCTION_GRANTS = [
  ['public.check_anon_rate_limit(text,integer,integer)', 'service_role'],
  ['public.check_chat_rate_limit(uuid,integer,integer)', 'service_role'],
  ['public.claim_pending_chat_job()', 'service_role'],
  ['public.create_secret(text,text,uuid)', 'service_role'],
  ['public.delete_api_key(uuid,uuid)', 'authenticated'],
  ['public.delete_api_key(uuid,uuid)', 'service_role'],
  ['public.delete_orphaned_modules(uuid[],uuid)', 'authenticated'],
  ['public.delete_orphaned_modules(uuid[],uuid)', 'service_role'],
  ['public.delete_secret(text,uuid)', 'service_role'],
  ['public.get_chat_token_totals(uuid,uuid)', 'authenticated'],
  ['public.get_chat_token_totals(uuid,uuid)', 'service_role'],
  ['public.get_chat_usage_costs(uuid,uuid)', 'authenticated'],
  ['public.get_chat_usage_costs(uuid,uuid)', 'service_role'],
  ['public.get_decrypted_secret(text,uuid)', 'service_role'],
  ['public.list_current_user_modules()', 'authenticated'],
  ['public.list_current_user_modules()', 'service_role'],
  ['public.match_chat_facts(uuid,uuid,public.vector,double precision,integer)', 'authenticated'],
  ['public.match_chat_facts(uuid,uuid,public.vector,double precision,integer)', 'service_role'],
  ['public.record_service_health_status(text,boolean,text,jsonb)', 'service_role'],
  ['public.update_character_with_modules(uuid,text,text,text,text,uuid[],uuid)', 'authenticated'],
  ['public.update_character_with_modules(uuid,text,text,text,text,uuid[],uuid)', 'service_role'],
]

const EXPECTED_RLS_TABLES = [
  'storage.objects',
  'public.anon_rate_limits',
  'public.service_health_status',
  'public.vault_secret_audit',
]

const EXPECTED_BUCKETS = ['character-assets', 'module-assets', 'charx-uploads']

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function buildGrantValues(grants) {
  return grants
    .map(([signature, role]) => `(${sqlLiteral(signature)}, ${sqlLiteral(role)})`)
    .join(',\n      ')
}

function buildContractQuery() {
  return `
    WITH
    forbidden_function_grants(signature, role_name) AS (
      VALUES
      ${buildGrantValues(FORBIDDEN_FUNCTION_GRANTS)}
    ),
    required_function_grants(signature, role_name) AS (
      VALUES
      ${buildGrantValues(REQUIRED_FUNCTION_GRANTS)}
    ),
    all_contract_functions AS (
      SELECT signature FROM forbidden_function_grants
      UNION
      SELECT signature FROM required_function_grants
    )
    SELECT json_build_object(
      'policies',
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'name', policyname,
            'command', cmd,
            'roles', roles,
            'qual', qual,
            'withCheck', with_check
          )
          ORDER BY policyname
        )
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
      ), '[]'::json),
      'buckets',
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', id,
            'name', name,
            'public', public
          )
          ORDER BY id
        )
        FROM storage.buckets
      ), '[]'::json),
      'rls',
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'table', n.nspname || '.' || c.relname,
            'enabled', c.relrowsecurity,
            'forced', c.relforcerowsecurity
          )
          ORDER BY n.nspname, c.relname
        )
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'storage')
          AND c.relname IN (
            'objects',
            'anon_rate_limits',
            'service_health_status',
            'vault_secret_audit'
          )
      ), '[]'::json),
      'forbiddenTablePrivileges',
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'table', table_schema || '.' || table_name,
            'grantee', grantee,
            'privilege', privilege_type
          )
          ORDER BY table_schema, table_name, grantee, privilege_type
        )
        FROM information_schema.table_privileges
        WHERE table_schema = 'public'
          AND table_name IN (
            'anon_rate_limits',
            'service_health_status',
            'vault_secret_audit'
          )
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      ), '[]'::json),
      'forbiddenFunctionGrants',
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'signature', signature,
            'role', role_name
          )
          ORDER BY signature, role_name
        )
        FROM forbidden_function_grants
        WHERE has_function_privilege(
          role_name,
          to_regprocedure(signature),
          'EXECUTE'
        )
      ), '[]'::json),
      'missingRequiredFunctionGrants',
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'signature', signature,
            'role', role_name
          )
          ORDER BY signature, role_name
        )
        FROM required_function_grants
        WHERE NOT has_function_privilege(
          role_name,
          to_regprocedure(signature),
          'EXECUTE'
        )
      ), '[]'::json),
      'unresolvedFunctions',
      COALESCE((
        SELECT json_agg(signature ORDER BY signature)
        FROM all_contract_functions
        WHERE to_regprocedure(signature) IS NULL
      ), '[]'::json)
    )::text
  `
}

function normalizeSqlExpression(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll(/\s+/g, '')
}

function evaluateSnapshot(snapshot) {
  const errors = []
  const policies = Array.isArray(snapshot?.policies) ? snapshot.policies : []
  const policyByName = new Map(policies.map((policy) => [policy.name, policy]))

  if (policies.length !== EXPECTED_STORAGE_POLICIES.length) {
    errors.push(
      `expected ${EXPECTED_STORAGE_POLICIES.length} storage policies, found ${policies.length}`,
    )
  }

  for (const expected of EXPECTED_STORAGE_POLICIES) {
    const actual = policyByName.get(expected.name)
    if (!actual) {
      errors.push(`missing storage policy: ${expected.name}`)
      continue
    }
    if (actual.command !== expected.command) {
      errors.push(
        `storage policy command mismatch: ${expected.name} expected=${expected.command} actual=${actual.command}`,
      )
    }
    if (JSON.stringify(actual.roles) !== JSON.stringify(['public'])) {
      errors.push(`storage policy roles mismatch: ${expected.name}`)
    }

    const expression = normalizeSqlExpression(
      expected.command === 'INSERT' ? actual.withCheck : actual.qual,
    )
    for (const requiredFragment of [expected.bucket, 'auth.uid()', 'storage.foldername(name)']) {
      if (!expression.includes(requiredFragment)) {
        errors.push(`storage policy guard mismatch: ${expected.name} missing=${requiredFragment}`)
      }
    }
  }

  const buckets = Array.isArray(snapshot?.buckets) ? snapshot.buckets : []
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]))
  if (buckets.length !== EXPECTED_BUCKETS.length) {
    errors.push(`expected ${EXPECTED_BUCKETS.length} storage buckets, found ${buckets.length}`)
  }
  for (const bucketId of EXPECTED_BUCKETS) {
    const bucket = bucketById.get(bucketId)
    if (!bucket) {
      errors.push(`missing storage bucket: ${bucketId}`)
      continue
    }
    if (bucket.public !== false) {
      errors.push(`storage bucket must remain private: ${bucketId}`)
    }
  }

  const rlsRows = Array.isArray(snapshot?.rls) ? snapshot.rls : []
  const rlsByTable = new Map(rlsRows.map((row) => [row.table, row]))
  for (const table of EXPECTED_RLS_TABLES) {
    const row = rlsByTable.get(table)
    if (!row) {
      errors.push(`missing RLS table contract: ${table}`)
    } else if (row.enabled !== true) {
      errors.push(`RLS is disabled: ${table}`)
    }
  }

  for (const [field, label] of [
    ['forbiddenTablePrivileges', 'forbidden table privilege'],
    ['forbiddenFunctionGrants', 'forbidden function grant'],
    ['missingRequiredFunctionGrants', 'missing required function grant'],
    ['unresolvedFunctions', 'unresolved contract function'],
  ]) {
    const rows = Array.isArray(snapshot?.[field]) ? snapshot[field] : []
    for (const row of rows) {
      errors.push(`${label}: ${JSON.stringify(row)}`)
    }
  }

  return errors
}

function resolveProjectRefFromSupabaseUrl(value) {
  try {
    const hostname = new URL(value).hostname
    const [projectRef, ...rest] = hostname.split('.')
    if (!projectRef || rest.join('.') !== 'supabase.co') {
      return null
    }
    return projectRef
  } catch {
    return null
  }
}

function loadEnvironment(rootDir, baseEnvironment = process.env) {
  const environment = { ...baseEnvironment }
  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(rootDir, fileName)
    if (!fs.existsSync(filePath)) {
      continue
    }
    Object.assign(environment, dotenv.parse(fs.readFileSync(filePath)), baseEnvironment)
  }
  return environment
}

function readLinkedProject(rootDir) {
  const projectRefPath = path.join(rootDir, 'supabase/.temp/project-ref')
  const poolerUrlPath = path.join(rootDir, 'supabase/.temp/pooler-url')
  const postgresVersionPath = path.join(rootDir, 'supabase/.temp/postgres-version')

  for (const requiredPath of [projectRefPath, poolerUrlPath, postgresVersionPath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`missing linked Supabase metadata: ${path.relative(rootDir, requiredPath)}`)
    }
  }

  return {
    projectRef: fs.readFileSync(projectRefPath, 'utf8').trim(),
    poolerUrl: fs.readFileSync(poolerUrlPath, 'utf8').trim(),
    postgresVersion: fs.readFileSync(postgresVersionPath, 'utf8').trim(),
  }
}

function queryLinkedDatabase({ poolerUrl, postgresVersion, password, spawn = spawnSync }) {
  const psqlArguments = [
    '-X',
    '-qAt',
    '--set',
    'ON_ERROR_STOP=on',
    '--dbname',
    poolerUrl,
    '-c',
    buildContractQuery(),
  ]
  const spawnOptions = {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGPASSWORD: password,
      PGSSLMODE: 'require',
    },
    maxBuffer: 8 * 1024 * 1024,
  }

  let result = spawn('psql', psqlArguments, spawnOptions)
  if (result.error?.code === 'ENOENT') {
    result = spawn(
      'docker',
      [
        'run',
        '--rm',
        '-e',
        'PGPASSWORD',
        '-e',
        'PGSSLMODE=require',
        `public.ecr.aws/supabase/postgres:${postgresVersion}`,
        'psql',
        ...psqlArguments,
      ],
      spawnOptions,
    )
  }

  if (result.status !== 0) {
    const message = String(
      result.error?.message || result.stderr || result.stdout || 'unknown psql error',
    )
      .replaceAll(password, '[redacted]')
      .slice(-1200)
    throw new Error(message)
  }

  const output = String(result.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .at(-1)
  if (!output) {
    throw new Error('linked database contract query returned no output')
  }
  return JSON.parse(output)
}

function main(options = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const consoleImpl = options.console ?? console

  try {
    const environment = options.environment ?? loadEnvironment(rootDir)
    const linked = options.linked ?? readLinkedProject(rootDir)
    const expectedProjectRef = resolveProjectRefFromSupabaseUrl(
      environment.NEXT_PUBLIC_SUPABASE_URL,
    )
    if (!expectedProjectRef) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL must contain a valid Supabase project URL')
    }
    if (linked.projectRef !== expectedProjectRef) {
      throw new Error(`linked project mismatch: cli=${linked.projectRef} app=${expectedProjectRef}`)
    }

    const password = environment.SUPABASE_DB_PASSWORD
    if (!password) {
      throw new Error('SUPABASE_DB_PASSWORD is required')
    }

    const snapshot =
      options.snapshot ??
      queryLinkedDatabase({
        poolerUrl: linked.poolerUrl,
        postgresVersion: linked.postgresVersion,
        password,
        spawn: options.spawn,
      })
    const errors = evaluateSnapshot(snapshot)
    if (errors.length > 0) {
      consoleImpl.error('[check-linked-supabase-contract] FAILED')
      for (const error of errors) {
        consoleImpl.error(`- ${error}`)
      }
      return 1
    }

    consoleImpl.log(
      `[check-linked-supabase-contract] OK project_ref=${linked.projectRef} policies=${EXPECTED_STORAGE_POLICIES.length} buckets=${EXPECTED_BUCKETS.length} sensitive_acl=locked`,
    )
    return 0
  } catch (error) {
    consoleImpl.error(
      `[check-linked-supabase-contract] FAILED: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = {
  EXPECTED_BUCKETS,
  EXPECTED_RLS_TABLES,
  EXPECTED_STORAGE_POLICIES,
  FORBIDDEN_FUNCTION_GRANTS,
  REQUIRED_FUNCTION_GRANTS,
  buildContractQuery,
  evaluateSnapshot,
  loadEnvironment,
  main,
  normalizeSqlExpression,
  queryLinkedDatabase,
  readLinkedProject,
  resolveProjectRefFromSupabaseUrl,
}
