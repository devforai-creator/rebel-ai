import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-contract.yml'),
  'utf8',
)

describe('Supabase production contract workflow', () => {
  it('runs only through trusted manual and scheduled triggers', () => {
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('schedule:')
    expect(workflow).not.toContain('pull_request:')
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).toContain('environment: Production')
  })

  it('scopes the production password to verification after dependency installation', () => {
    const installStep = workflow.indexOf('- name: Install dependencies')
    const verificationStep = workflow.indexOf('- name: Verify production storage and ACL contract')
    const passwordReference = workflow.indexOf(
      'SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}',
    )

    expect(installStep).toBeGreaterThan(-1)
    expect(verificationStep).toBeGreaterThan(installStep)
    expect(passwordReference).toBeGreaterThan(verificationStep)
    expect(workflow.slice(0, verificationStep)).not.toContain('secrets.SUPABASE_DB_PASSWORD')
  })

  it('pins the check to the Seoul production project', () => {
    expect(workflow).toContain('ceatljsosxyulebubcng')
    expect(workflow).toContain('aws-1-ap-northeast-2.pooler.supabase.com')
    expect(workflow).toContain('https://ceatljsosxyulebubcng.supabase.co')
  })
})
