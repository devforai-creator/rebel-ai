import { describe, expect, it } from 'vitest'
import { applyExtractRegex, collectExtractRegexMatches } from './extract-regex'
import type { ModuleRegexEntry } from './types'

// Helper to build a minimal ModuleRegexEntry
function makeExtractEntry(pattern: string, bindings: Record<string, string>): ModuleRegexEntry {
  return {
    type: 'extract',
    comment: '',
    in: pattern,
    out: '',
    ableFlag: true,
    bindings,
  }
}

describe('applyExtractRegex', () => {
  it('extracts variables from basic bracket status', () => {
    const content = 'The dragon attacks! [HP:87/100|Location:Dark Forest]'
    const regex = [
      makeExtractEntry('\\[HP:(\\d+)/(\\d+)\\|Location:([^\\]]+)\\]', {
        hp: '$1',
        maxHp: '$2',
        location: '$3',
      }),
    ]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({ hp: '87', maxHp: '100', location: 'Dark Forest' })
  })

  it('returns empty object when no match', () => {
    const content = 'No status here.'
    const regex = [makeExtractEntry('\\[HP:(\\d+)\\]', { hp: '$1' })]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({})
  })

  it('returns empty object for empty content', () => {
    const regex = [makeExtractEntry('\\[HP:(\\d+)\\]', { hp: '$1' })]
    expect(applyExtractRegex('', regex)).toEqual({})
  })

  it('returns empty object for undefined moduleRegex', () => {
    expect(applyExtractRegex('some content', undefined)).toEqual({})
  })

  it('returns empty object for empty moduleRegex', () => {
    expect(applyExtractRegex('some content', [])).toEqual({})
  })

  it('ignores non-extract regex entries', () => {
    const content = '[HP:50/100]'
    const regex: ModuleRegexEntry[] = [
      {
        type: 'editdisplay',
        comment: '',
        in: '\\[HP:(\\d+)/(\\d+)\\]',
        out: '<div>$1/$2</div>',
        ableFlag: true,
        bindings: { hp: '$1', maxHp: '$2' },
      },
      {
        type: 'editoutput',
        comment: '',
        in: '\\[HP:(\\d+)/(\\d+)\\]',
        out: '',
        ableFlag: true,
        bindings: { hp: '$1' },
      },
    ]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({})
  })

  it('ignores extract entries without bindings', () => {
    const content = '[HP:50/100]'
    const regex: ModuleRegexEntry[] = [
      {
        type: 'extract',
        comment: '',
        in: '\\[HP:(\\d+)/(\\d+)\\]',
        out: '',
        ableFlag: true,
        // no bindings
      },
    ]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({})
  })

  it('later entries override earlier entries for same variable', () => {
    const content = '[HP:50/100] [HP:87/100]'
    const regex = [
      makeExtractEntry('\\[HP:(\\d+)/(\\d+)\\]', { hp: '$1' }),
      // Second pattern matches differently
      makeExtractEntry('\\[HP:\\d+/\\d+\\] \\[HP:(\\d+)/(\\d+)\\]', { hp: '$1' }),
    ]
    const result = applyExtractRegex(content, regex)
    // Second entry matches and overrides hp with 87
    expect(result.hp).toBe('87')
  })

  it('handles multiple extract entries extracting different variables', () => {
    const content = '[HP:87/100] [MP:32/50]'
    const regex = [
      makeExtractEntry('\\[HP:(\\d+)/(\\d+)\\]', { hp: '$1', maxHp: '$2' }),
      makeExtractEntry('\\[MP:(\\d+)/(\\d+)\\]', { mp: '$1', maxMp: '$2' }),
    ]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({ hp: '87', maxHp: '100', mp: '32', maxMp: '50' })
  })

  it('skips invalid regex patterns without crashing', () => {
    const content = '[HP:50/100]'
    const regex = [
      makeExtractEntry('[invalid(regex', { hp: '$1' }),
      makeExtractEntry('\\[HP:(\\d+)/(\\d+)\\]', { hp: '$1', maxHp: '$2' }),
    ]
    // Should not throw, and should still process the valid entry
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({ hp: '50', maxHp: '100' })
  })

  it('skips RE2-incompatible regex patterns without crashing', () => {
    const content = 'foo42'
    const regex = [
      makeExtractEntry('(?<=foo)(\\d+)', { hp: '$1' }),
      makeExtractEntry('foo(\\d+)', { hp: '$1' }),
    ]

    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({ hp: '42' })
  })

  it('ignores binding references that are not $N format', () => {
    const content = '[HP:50/100]'
    const regex = [
      makeExtractEntry('\\[HP:(\\d+)/(\\d+)\\]', {
        hp: '$1',
        maxHp: '$2',
        invalid: 'not_a_group_ref',
        alsoInvalid: '$$1',
      }),
    ]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({ hp: '50', maxHp: '100' })
  })

  it('handles capture group index out of range gracefully', () => {
    const content = '[HP:50/100]'
    const regex = [
      makeExtractEntry('\\[HP:(\\d+)/(\\d+)\\]', {
        hp: '$1',
        missing: '$5', // Only 2 capture groups exist
      }),
    ]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({ hp: '50' })
    expect(result.missing).toBeUndefined()
  })

  it('handles fullwidth brackets via normalization', () => {
    // Fullwidth brackets ［ ］ should be normalized to ASCII [ ]
    const content = '［HP:87/100］'
    const regex = [makeExtractEntry('\\[HP:(\\d+)/(\\d+)\\]', { hp: '$1', maxHp: '$2' })]
    const result = applyExtractRegex(content, regex)
    expect(result).toEqual({ hp: '87', maxHp: '100' })
  })
})

describe('collectExtractRegexMatches', () => {
  it('collects multiple matches with per-match bindings', () => {
    const content = '[HP:10] text [HP:25]'
    const regex = [makeExtractEntry('\\[HP:(\\d+)\\]', { hp: '$1' })]

    const result = collectExtractRegexMatches(content, regex)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      index: 0,
      matchText: '[HP:10]',
      bindings: { hp: '10' },
    })
    expect(result[1]).toMatchObject({
      index: 13,
      matchText: '[HP:25]',
      bindings: { hp: '25' },
    })
  })

  it('collects matches for every extract entry even when regex order differs from text order', () => {
    const content = '[Archive:One] middle [Invention:Two]'
    const regex: ModuleRegexEntry[] = [
      {
        type: 'extract',
        comment: 'invention',
        in: '\\[Invention:([^\\]]+)\\]',
        out: '',
        ableFlag: true,
        bindings: { name: '$1' },
      },
      {
        type: 'extract',
        comment: 'archive',
        in: '\\[Archive:([^\\]]+)\\]',
        out: '',
        ableFlag: true,
        bindings: { title: '$1' },
      },
    ]

    const result = collectExtractRegexMatches(content, regex)

    expect(result.map((match) => match.matchText)).toEqual(['[Invention:Two]', '[Archive:One]'])
    expect(result[0].bindings).toEqual({ name: 'Two' })
    expect(result[1].bindings).toEqual({ title: 'One' })
  })
})
