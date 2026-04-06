/**
 * Extract Regex Processor
 *
 * Runs `extract`-type module regex entries against message content and returns
 * variable bindings. Used to feed extracted state into the SUU UGCRenderer.
 *
 * Flow:
 *   1. Filter for type === 'extract' entries with bindings
 *   2. Normalize fullwidth chars (same as display pipeline)
 *   3. Safety-check each regex pattern
 *   4. Match and resolve capture group bindings → variable values
 *
 * Later entries override earlier entries for the same variable name.
 * All extracted values are strings (per RBX v1.1 spec).
 */

import { compileRe2, MODULE_REGEX_MAX_LENGTH } from '@/lib/security/re2-regex'
import type { ModuleRegexEntry } from './types'
import { normalizeFullwidthChars } from './message-content-pipeline'

export type ExtractRegexMatch = Readonly<{
  entry: ModuleRegexEntry
  entryIndex: number
  index: number
  matchText: string
  bindings: Record<string, string>
}>

function resolveBindingsFromMatch(
  entry: ModuleRegexEntry,
  match: Array<string | undefined>,
): Record<string, string> {
  const extracted: Record<string, string> = {}
  if (!entry.bindings) return extracted

  for (const [varName, groupRef] of Object.entries(entry.bindings)) {
    const groupMatch = groupRef.match(/^\$(\d+)$/)
    if (!groupMatch) continue

    const groupIndex = parseInt(groupMatch[1], 10)
    if (match[groupIndex] !== undefined) {
      extracted[varName] = match[groupIndex]
    }
  }

  return extracted
}

export function collectExtractRegexMatches(
  content: string,
  moduleRegex: ModuleRegexEntry[] | undefined,
): ExtractRegexMatch[] {
  const matches: ExtractRegexMatch[] = []

  if (!moduleRegex?.length || !content) {
    return matches
  }

  const normalized = normalizeFullwidthChars(content)

  for (const [entryIndex, entry] of moduleRegex.entries()) {
    if (entry.type !== 'extract' || !entry.bindings || !entry.in) continue

    const compiled = compileRe2(entry.in, { flags: 'g', maxLength: MODULE_REGEX_MAX_LENGTH })
    if (!compiled.ok) {
      console.warn('[Extract Regex] Skipping RE2-incompatible pattern:', entry.in, compiled.reason)
      continue
    }

    let match: ReturnType<typeof compiled.regex.exec> | null
    while ((match = compiled.regex.exec(normalized)) !== null) {
      if (!match[0] || match.index === undefined) continue
      matches.push({
        entry,
        entryIndex,
        index: match.index,
        matchText: match[0],
        bindings: resolveBindingsFromMatch(entry, match),
      })
    }
  }

  return matches
}

/**
 * Run extract-type regex entries against content and return extracted variables.
 *
 * @param content - Raw message content (before display processing)
 * @param moduleRegex - All module regex entries (filters to type === 'extract' internally)
 * @returns Record of extracted variable name → string value
 */
export function applyExtractRegex(
  content: string,
  moduleRegex: ModuleRegexEntry[] | undefined,
): Record<string, string> {
  const extracted: Record<string, string> = {}

  if (!moduleRegex?.length || !content) {
    return extracted
  }

  const normalized = normalizeFullwidthChars(content)

  for (const entry of moduleRegex) {
    if (entry.type !== 'extract' || !entry.bindings || !entry.in) continue

    const compiled = compileRe2(entry.in, { maxLength: MODULE_REGEX_MAX_LENGTH })
    if (!compiled.ok) {
      console.warn('[Extract Regex] Skipping RE2-incompatible pattern:', entry.in, compiled.reason)
      continue
    }

    const match = compiled.regex.exec(normalized)
    if (!match) continue

    Object.assign(extracted, resolveBindingsFromMatch(entry, match))
  }

  return extracted
}
