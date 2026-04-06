import { describe, expect, it, vi } from 'vitest'
import { RE2JS } from 're2js'

import { MODULE_REGEX_MAX_LENGTH, Re2Regex, compileRe2 } from './re2-regex'

function expectCompiled(pattern: string, flags?: string) {
  const result = compileRe2(pattern, { flags })

  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.reason)
  }

  return result.regex
}

describe('compileRe2', () => {
  it('adds unicode mode automatically and normalizes flag order', () => {
    const result = compileRe2('hello', { flags: 'ig' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.normalizedFlags).toBe('giu')
      expect(result.regex.flags).toBe('giu')
      expect(result.regex.global).toBe(true)
      expect(result.regex.ignoreCase).toBe(true)
    }
  })

  it('rejects missing patterns', () => {
    expect(compileRe2('')).toEqual({
      ok: false,
      reason: 'pattern missing',
    })
  })

  it('rejects patterns longer than the configured max length', () => {
    const result = compileRe2('abcd', { maxLength: 3 })

    expect(result).toEqual({
      ok: false,
      reason: 'pattern too long (> 3 chars)',
    })
  })

  it('rejects unsupported flags', () => {
    expect(compileRe2('hello', { flags: 'x' })).toEqual({
      ok: false,
      reason: 'unsupported regex flag: x',
    })
  })

  it('rejects lookaround patterns that RE2 does not support', () => {
    const result = compileRe2('(?<=foo)bar')

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/invalid (?:perl operator|named capture)/),
      normalizedFlags: 'u',
    })
  })

  it('rejects backreferences that RE2 does not support', () => {
    const result = compileRe2('([가-힣])\\1{8,}')

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining('invalid escape sequence'),
      normalizedFlags: 'u',
    })
  })

  it('falls back to a generic compile error for non-Error failures', () => {
    const compileSpy = vi.spyOn(RE2JS, 'compile').mockImplementationOnce(() => {
      throw 'bad regex'
    })

    expect(compileRe2('hello')).toEqual({
      ok: false,
      normalizedFlags: 'u',
      reason: 'invalid regex',
    })

    compileSpy.mockRestore()
  })

  it('keeps the shared max length constant in sync with the default guard', () => {
    const result = compileRe2('x'.repeat(MODULE_REGEX_MAX_LENGTH + 1))

    expect(result).toEqual({
      ok: false,
      reason: `pattern too long (> ${MODULE_REGEX_MAX_LENGTH} chars)`,
    })
  })
})

describe('Re2Regex exec and test', () => {
  it('tracks lastIndex for global matches and resets after a miss', () => {
    const regex = expectCompiled('a', 'g')

    const match = regex.exec('ba')

    expect(match?.[0]).toBe('a')
    expect(match?.index).toBe(1)
    expect(match?.input).toBe('ba')
    expect(regex.lastIndex).toBe(2)

    expect(regex.exec('zz')).toBeNull()
    expect(regex.lastIndex).toBe(0)

    regex.lastIndex = 99
    expect(regex.exec('ba')).toBeNull()
    expect(regex.lastIndex).toBe(0)
  })

  it('enforces sticky matches at the current lastIndex', () => {
    const regex = expectCompiled('a', 'y')

    expect(regex.exec('ba')).toBeNull()
    expect(regex.lastIndex).toBe(0)

    regex.lastIndex = 1
    const match = regex.exec('ba')

    expect(match?.[0]).toBe('a')
    expect(match?.index).toBe(1)
    expect(regex.lastIndex).toBe(2)
  })

  it('advances zero-length global matches by unicode code point', () => {
    const regex = new Re2Regex('', 'gu')

    const first = regex.exec('😀a')
    expect(first?.[0]).toBe('')
    expect(first?.index).toBe(0)
    expect(regex.lastIndex).toBe(2)

    const second = regex.exec('😀a')
    expect(second?.[0]).toBe('')
    expect(second?.index).toBe(2)
    expect(regex.lastIndex).toBe(3)

    const third = regex.exec('😀a')
    expect(third?.[0]).toBe('')
    expect(third?.index).toBe(3)
    expect(regex.lastIndex).toBe(4)
  })

  it('uses exec for global test and native test for non-global regexes', () => {
    const globalRegex = expectCompiled('a', 'g')
    expect(globalRegex.test('ba')).toBe(true)
    expect(globalRegex.lastIndex).toBe(2)
    expect(globalRegex.test('ba')).toBe(false)
    expect(globalRegex.lastIndex).toBe(0)

    const plainRegex = expectCompiled('foo')
    expect(plainRegex.test('food')).toBe(true)
    expect(plainRegex.test('bar')).toBe(false)
    expect(plainRegex.lastIndex).toBe(0)
  })
})

describe('Re2Regex replace', () => {
  it('uses the fast string replacement path for non-sticky regexes', () => {
    const firstOnly = expectCompiled('a')
    expect(firstOnly.replace('banana', 'o')).toBe('bonana')

    const global = expectCompiled('a', 'g')
    expect(global.replace('banana', 'o')).toBe('bonono')
  })

  it('supports JS-style replacement tokens in sticky mode', () => {
    const regex = expectCompiled('(?<word>foo)', 'y')

    expect(regex.replace('foo!', '[$&]-$1-$<word>-$$-$2-$9')).toBe('[foo]-foo-foo-$-$2-$9!')
  })

  it('passes capture groups, indices, and named groups to callback replacers', () => {
    const regex = expectCompiled('(?<letter>a)(b)?', 'g')
    const seen: unknown[][] = []

    const output = regex.replace('ab a', (...args) => {
      seen.push(args)
      return args[2] ? `<${args[0]}${args[2]}>` : `<${args[0]}>`
    })

    expect(output).toBe('<abb> <a>')
    expect(seen).toEqual([
      ['ab', 'a', 'b', 0, 'ab a', { letter: 'a' }],
      ['a', 'a', undefined, 3, 'ab a', { letter: 'a' }],
    ])
  })

  it('advances zero-length callback replacements without adding a named-groups argument', () => {
    const regex = new Re2Regex('', 'gu')
    const seen: unknown[][] = []

    const output = regex.replace('a', (...args) => {
      seen.push(args)
      return '-'
    })

    expect(output).toBe('-a-')
    expect(seen).toEqual([
      ['', 0, 'a'],
      ['', 1, 'a'],
    ])
  })

  it('returns the original input when a sticky replacement cannot start at the current position', () => {
    const regex = expectCompiled('foo', 'y')

    expect(regex.replace('xfoo', 'bar')).toBe('xfoo')
  })
})
