import { RE2JS } from 're2js'

export const MODULE_REGEX_MAX_LENGTH = 2048

type Re2Success = {
  ok: true
  normalizedFlags: string
}

type Re2Failure = {
  ok: false
  reason: string
  normalizedFlags?: string
}

export type Re2CompileResult =
  | (Re2Success & {
      regex: Re2Regex
    })
  | Re2Failure

export type Re2ExecArray = Array<string | undefined> & {
  index: number
  input: string
  groups?: Record<string, string>
}

const RE2_FLAG_ORDER = ['g', 'i', 'm', 's', 'u', 'y'] as const
const RE2_ALLOWED_FLAGS = new Set(RE2_FLAG_ORDER)

function normalizeRe2Flags(flags?: string): Re2Success | Re2Failure {
  const seen = new Set<string>()

  if (typeof flags === 'string') {
    for (const flag of flags) {
      if (!RE2_ALLOWED_FLAGS.has(flag as (typeof RE2_FLAG_ORDER)[number])) {
        return { ok: false, reason: `unsupported regex flag: ${flag}` }
      }
      seen.add(flag)
    }
  }

  // Keep unicode mode in the public contract even though RE2JS is unicode-first.
  seen.add('u')

  return {
    ok: true,
    normalizedFlags: RE2_FLAG_ORDER.filter((flag) => seen.has(flag)).join(''),
  }
}

function toRe2JsFlags(flags: string): number {
  let bits = 0

  if (flags.includes('i')) bits |= RE2JS.CASE_INSENSITIVE
  if (flags.includes('m')) bits |= RE2JS.MULTILINE
  if (flags.includes('s')) bits |= RE2JS.DOTALL

  return bits
}

function formatCompileError(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return 'invalid regex'
  }

  return error.message
    .replace(/^Invalid regular expression:\s*\/.*?\/[a-z]*:\s*/i, '')
    .replace(/\s+at position \d+$/i, '')
    .trim()
}

function advanceStringIndex(input: string, index: number): number {
  if (index >= input.length) {
    return input.length + 1
  }

  const codePoint = input.codePointAt(index)
  if (codePoint !== undefined && codePoint > 0xffff) {
    return index + 2
  }

  return index + 1
}

function applyJsStyleReplacement(template: string, match: Re2ExecArray): string {
  return template.replace(/\$(\$|&|<[^>]+>|[1-9]\d?)/g, (token, ref: string) => {
    if (ref === '$') {
      return '$'
    }

    if (ref === '&') {
      return match[0] ?? ''
    }

    if (ref.startsWith('<') && ref.endsWith('>')) {
      const groupName = ref.slice(1, -1)
      return match.groups?.[groupName] ?? ''
    }

    const groupIndex = Number.parseInt(ref, 10)
    if (!Number.isFinite(groupIndex) || groupIndex >= match.length) {
      return token
    }

    return match[groupIndex] ?? ''
  })
}

function collectMatchGroups(
  compiled: RE2JS,
  matcher: ReturnType<RE2JS['matcher']>,
  input: string,
): Re2ExecArray {
  const values: Re2ExecArray = Object.assign(
    Array.from({ length: matcher.groupCount() + 1 }, (_, index) => {
      const value = matcher.group(index)
      return value === null ? undefined : value
    }),
    {
      index: matcher.start(),
      input,
    },
  )

  const namedGroups = compiled.namedGroups()
  const groups = Object.entries(namedGroups).reduce<Record<string, string>>(
    (result, [name, index]) => {
      const value = matcher.group(index)
      if (value !== null) {
        result[name] = value
      }
      return result
    },
    {},
  )

  if (Object.keys(groups).length > 0) {
    values.groups = groups
  }

  return values
}

export class Re2Regex {
  readonly source: string
  readonly flags: string
  readonly global: boolean
  readonly sticky: boolean
  readonly unicode = true
  readonly ignoreCase: boolean
  readonly multiline: boolean
  readonly dotAll: boolean

  lastIndex = 0

  private readonly compiled: RE2JS

  constructor(pattern: string, flags: string) {
    this.source = pattern
    this.flags = flags
    this.global = flags.includes('g')
    this.sticky = flags.includes('y')
    this.ignoreCase = flags.includes('i')
    this.multiline = flags.includes('m')
    this.dotAll = flags.includes('s')
    this.compiled = RE2JS.compile(pattern, toRe2JsFlags(flags))
  }

  exec(input: string): Re2ExecArray | null {
    const matcher = this.compiled.matcher(input)
    const startIndex = this.global || this.sticky ? Math.max(this.lastIndex, 0) : 0

    if (startIndex > input.length) {
      if (this.global || this.sticky) {
        this.lastIndex = 0
      }
      return null
    }

    if (!matcher.find(startIndex)) {
      if (this.global || this.sticky) {
        this.lastIndex = 0
      }
      return null
    }

    const matchIndex = matcher.start()
    if (this.sticky && matchIndex !== startIndex) {
      this.lastIndex = 0
      return null
    }

    const match = collectMatchGroups(this.compiled, matcher, input)

    if (this.global || this.sticky) {
      const nextIndex = matcher.end()
      const matchText = match[0] ?? ''
      this.lastIndex = matchText === '' ? advanceStringIndex(input, nextIndex) : nextIndex
    }

    return match
  }

  test(input: string): boolean {
    if (this.global || this.sticky) {
      return this.exec(input) !== null
    }

    return this.compiled.test(input)
  }

  replace(
    input: string,
    replacer: string | ((substring: string, ...args: unknown[]) => string),
  ): string {
    this.lastIndex = 0

    if (typeof replacer === 'string' && !this.sticky) {
      const matcher = this.compiled.matcher(input)
      return this.global ? matcher.replaceAll(replacer, true) : matcher.replaceFirst(replacer, true)
    }

    const matcher = this.compiled.matcher(input)
    const result: string[] = []
    let lastAppendIndex = 0
    let searchIndex = this.sticky ? Math.max(this.lastIndex, 0) : 0
    let replaced = false

    while (searchIndex <= input.length && matcher.find(searchIndex)) {
      const matchStart = matcher.start()
      if (this.sticky && matchStart !== searchIndex) {
        break
      }

      const match = collectMatchGroups(this.compiled, matcher, input)
      const namedGroups = match.groups

      result.push(input.slice(lastAppendIndex, matchStart))

      if (typeof replacer === 'string') {
        result.push(applyJsStyleReplacement(replacer, match))
      } else {
        const callbackArgs: unknown[] = [
          ...match,
          matchStart,
          input,
          ...(namedGroups ? [namedGroups] : []),
        ]
        result.push(replacer(match[0] ?? '', ...callbackArgs.slice(1)))
      }

      replaced = true
      lastAppendIndex = matcher.end()

      if (!this.global) {
        break
      }

      searchIndex =
        matcher.start() === matcher.end() ? advanceStringIndex(input, matcher.end()) : matcher.end()
    }

    if (!replaced) {
      return input
    }

    result.push(input.slice(lastAppendIndex))
    return result.join('')
  }
}

export function compileRe2(
  pattern: string,
  options?: {
    flags?: string
    maxLength?: number
  },
): Re2CompileResult {
  const maxLength = options?.maxLength ?? MODULE_REGEX_MAX_LENGTH

  if (!pattern || typeof pattern !== 'string') {
    return { ok: false, reason: 'pattern missing' }
  }

  if (pattern.length > maxLength) {
    return { ok: false, reason: `pattern too long (> ${maxLength} chars)` }
  }

  const normalizedFlags = normalizeRe2Flags(options?.flags)
  if (!normalizedFlags.ok) {
    return normalizedFlags
  }

  try {
    return {
      ok: true,
      regex: new Re2Regex(pattern, normalizedFlags.normalizedFlags),
      normalizedFlags: normalizedFlags.normalizedFlags,
    }
  } catch (error) {
    return {
      ok: false,
      normalizedFlags: normalizedFlags.normalizedFlags,
      reason: formatCompileError(error),
    }
  }
}
