import { describe, expect, it, vi } from 'vitest'
import checker from './check-linked-supabase-contract.js'

const {
  EXPECTED_BUCKETS,
  EXPECTED_RLS_TABLES,
  EXPECTED_STORAGE_POLICIES,
  evaluateSnapshot,
  main,
  resolveProjectRefFromSupabaseUrl,
} = checker

function createValidSnapshot() {
  return {
    policies: EXPECTED_STORAGE_POLICIES.map((policy) => {
      const expression = `bucket_id = '${policy.bucket}' and auth.uid()::text = storage.foldername(name)[1]`
      return {
        name: policy.name,
        command: policy.command,
        roles: ['public'],
        qual: policy.command === 'INSERT' ? null : expression,
        withCheck: policy.command === 'INSERT' ? expression : null,
      }
    }),
    buckets: EXPECTED_BUCKETS.map((id) => ({
      id,
      name: id,
      public: false,
    })),
    rls: EXPECTED_RLS_TABLES.map((table) => ({
      table,
      enabled: true,
      forced: false,
    })),
    forbiddenTablePrivileges: [],
    forbiddenFunctionGrants: [],
    missingRequiredFunctionGrants: [],
    unresolvedFunctions: [],
  }
}

describe('check-linked-supabase-contract', () => {
  it('accepts the expected storage and ACL contract', () => {
    expect(evaluateSnapshot(createValidSnapshot())).toEqual([])
  })

  it('detects a missing storage policy and forbidden grants', () => {
    const snapshot = createValidSnapshot()
    snapshot.policies.shift()
    snapshot.forbiddenTablePrivileges.push({
      table: 'public.vault_secret_audit',
      grantee: 'anon',
      privilege: 'SELECT',
    })
    snapshot.forbiddenFunctionGrants.push({
      signature: 'public.get_decrypted_secret(text,uuid)',
      role: 'anon',
    })

    expect(evaluateSnapshot(snapshot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expected 10 storage policies'),
        expect.stringContaining('missing storage policy'),
        expect.stringContaining('forbidden table privilege'),
        expect.stringContaining('forbidden function grant'),
      ]),
    )
  })

  it('detects a policy with the wrong bucket guard', () => {
    const snapshot = createValidSnapshot()
    snapshot.policies[0].withCheck =
      "bucket_id = 'wrong-bucket' and auth.uid()::text = storage.foldername(name)[1]"

    expect(evaluateSnapshot(snapshot)).toEqual(
      expect.arrayContaining([expect.stringContaining('storage policy guard mismatch')]),
    )
  })

  it('extracts a Supabase project ref from the app URL', () => {
    expect(resolveProjectRefFromSupabaseUrl('https://ceatljsosxyulebubcng.supabase.co')).toBe(
      'ceatljsosxyulebubcng',
    )
    expect(resolveProjectRefFromSupabaseUrl('https://example.com')).toBeNull()
  })

  it('fails before querying when the CLI link points at a different project', () => {
    const consoleImpl = {
      log: vi.fn(),
      error: vi.fn(),
    }
    const spawn = vi.fn()

    expect(
      main({
        console: consoleImpl,
        environment: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://target-ref.supabase.co',
          SUPABASE_DB_PASSWORD: 'test-password',
        },
        linked: {
          projectRef: 'source-ref',
          poolerUrl: 'postgresql://example',
          postgresVersion: '17.6.1.147',
        },
        spawn,
      }),
    ).toBe(1)
    expect(spawn).not.toHaveBeenCalled()
    expect(consoleImpl.error).toHaveBeenCalledWith(
      expect.stringContaining('linked project mismatch'),
    )
  })

  it('returns success for an injected valid live snapshot', () => {
    const consoleImpl = {
      log: vi.fn(),
      error: vi.fn(),
    }

    expect(
      main({
        console: consoleImpl,
        environment: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://target-ref.supabase.co',
          SUPABASE_DB_PASSWORD: 'test-password',
        },
        linked: {
          projectRef: 'target-ref',
          poolerUrl: 'postgresql://example',
          postgresVersion: '17.6.1.147',
        },
        snapshot: createValidSnapshot(),
      }),
    ).toBe(0)
    expect(consoleImpl.log).toHaveBeenCalledWith(expect.stringContaining('sensitive_acl=locked'))
  })
})
