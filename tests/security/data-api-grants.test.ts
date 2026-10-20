import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const identifier = '(?:"[a-z_][a-z_0-9]*"|[a-z_][a-z_0-9]*)'
const relation = `(?:${identifier}\\s*\\.\\s*)?${identifier}`
const apiRoles = ['anon', 'authenticated', 'service_role']

function normalize(value: string) {
  return value.replace(/["\s]/g, '').toLowerCase()
}

// Check the repository's declarative CREATE TABLE / GRANT syntax. Actual role
// privileges (including inherited grants) are tested against PostgreSQL by pgTAP.
function tablesWithoutAccessDecision(sql: string) {
  const statements = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').split(';')
  const tables = statements.flatMap((statement) => {
    const created = statement.match(
      new RegExp(
        `^\\s*create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${relation})`,
        'i',
      ),
    )
    if (!created) return []
    const table = normalize(created[1])
    return table.includes('.') && !table.startsWith('public.')
      ? []
      : [table.replace(/^public\./, '')]
  })

  return tables.filter(
    (table) =>
      !statements.some((statement) => {
        const access = statement.match(
          /^\s*(grant\s+[\s\S]+?|revoke\s+all(?:\s+privileges)?)\s+on\s+(?:table\s+)?([\s\S]+?)\s+(to|from)\s+([\s\S]+?)\s*$/i,
        )
        if (!access) return false
        const objects = access[2]
          .split(',')
          .map((value) => normalize(value).replace(/^public\./, ''))
        const roles = access[4].split(',').map(normalize)
        return (
          objects.includes(table) &&
          (access[3].toLowerCase() === 'to'
            ? apiRoles.some((role) => roles.includes(role))
            : ['public', ...apiRoles].every((role) => roles.includes(role)))
        )
      }),
  )
}

describe('explicit Data API access decisions', () => {
  it.each([
    ['create table public.example (id uuid);', ['example']],
    ['create table example (id uuid); -- grant select on example to authenticated;', ['example']],
    [
      'create table public.example (id uuid); grant select on public.other to service_role;',
      ['example'],
    ],
    [
      'create table public.example (id uuid); grant execute on function public.example() to service_role;',
      ['example'],
    ],
    [
      'create table public.example (id uuid); grant select on table public.example, public.other to authenticated, service_role;',
      [],
    ],
    [
      'create table if not exists "public"."example" (id uuid); revoke all on public.example from public, anon, authenticated, service_role;',
      [],
    ],
    ['create table private.example (id uuid);', []],
  ])('checks grants for %s', (sql, missing) => {
    expect(tablesWithoutAccessDecision(sql)).toEqual(missing)
  })

  it('requires grants in every new public table creation migration after the backfill', () => {
    const migrationsDir = path.resolve('supabase/migrations')
    const missing = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql') && name.split('_')[0] > '999001')
      .flatMap((name) =>
        tablesWithoutAccessDecision(fs.readFileSync(path.join(migrationsDir, name), 'utf8')).map(
          (table) => `${name}: public.${table} needs an explicit GRANT or database-only REVOKE`,
        ),
      )

    expect(missing).toEqual([])
  })
})
