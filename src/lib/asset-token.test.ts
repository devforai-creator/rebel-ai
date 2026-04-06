import { describe, expect, it } from 'vitest'

import {
  buildCanonicalAssetImageToken,
  extractAssetTokens,
  normalizeLegacyAssetImageTokens,
  unwrapAssetToken,
} from './asset-token'

describe('buildCanonicalAssetImageToken', () => {
  it('uses the trimmed asset key as the default alt text', () => {
    expect(buildCanonicalAssetImageToken('  hero_happy.png  ')).toBe(
      '![hero_happy.png](asset:hero_happy.png)',
    )
  })

  it('sanitizes alt text by removing brackets and line breaks', () => {
    expect(buildCanonicalAssetImageToken('hero_happy.png', ' [Hero]\nMood\r')).toBe(
      '![Hero Mood](asset:hero_happy.png)',
    )
  })
})

describe('normalizeLegacyAssetImageTokens', () => {
  it('returns falsy text unchanged', () => {
    expect(normalizeLegacyAssetImageTokens('')).toBe('')
  })

  it('normalizes every supported legacy asset token format', () => {
    const input = [
      '<mmg="hero_happy.png">',
      '<img="hero_sad.png">',
      '[ 🖼 | hero_wave.png ]',
      '{{image::hero_laugh.png}}',
      '{{img::hero_cry.png}}',
    ].join(' ')

    expect(normalizeLegacyAssetImageTokens(input)).toBe(
      [
        '![hero_happy.png](asset:hero_happy.png)',
        '![hero_sad.png](asset:hero_sad.png)',
        '![hero_wave.png](asset:hero_wave.png)',
        '![hero_laugh.png](asset:hero_laugh.png)',
        '![hero_cry.png](asset:hero_cry.png)',
      ].join(' '),
    )
  })
})

describe('unwrapAssetToken', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(unwrapAssetToken('   ')).toBeNull()
  })

  it('unwraps markdown asset tokens with surrounding whitespace', () => {
    expect(unwrapAssetToken(' ![Hero](asset:  hero_happy.png  ) ')).toBe('hero_happy.png')
  })

  it('unwraps image template tokens', () => {
    expect(unwrapAssetToken('{{image::hero_happy.png}}')).toBe('hero_happy.png')
  })

  it('unwraps legacy img template tokens', () => {
    expect(unwrapAssetToken('{{img::hero_happy.png}}')).toBe('hero_happy.png')
  })

  it('unwraps emoji image tokens', () => {
    expect(unwrapAssetToken('[ 🖼 | hero_happy.png ]')).toBe('hero_happy.png')
  })

  it('unwraps html equals image tokens', () => {
    expect(unwrapAssetToken('<img="hero_happy.png">')).toBe('hero_happy.png')
  })

  it('unwraps html src image tokens with double quotes', () => {
    expect(unwrapAssetToken('<img src="hero_happy.png" />')).toBe('hero_happy.png')
  })

  it('unwraps html src image tokens with single quotes', () => {
    expect(unwrapAssetToken("<img src='hero_happy.png'>")).toBe('hero_happy.png')
  })

  it('unwraps html src image tokens with unquoted values', () => {
    expect(unwrapAssetToken('<img src=hero_happy.png>')).toBe('hero_happy.png')
  })

  it('falls back to stripping surrounding quotes from raw values', () => {
    expect(unwrapAssetToken('"hero_happy.png"')).toBe('hero_happy.png')
    expect(unwrapAssetToken("'hero_happy.png'")).toBe('hero_happy.png')
  })

  it('returns null when the wrapped token unwraps to an empty string', () => {
    expect(unwrapAssetToken('![Hero](asset:)')).toBeNull()
    expect(unwrapAssetToken('{{image::   }}')).toBeNull()
    expect(unwrapAssetToken('{{img::   }}')).toBeNull()
    expect(unwrapAssetToken('[ 🖼 |   ]')).toBeNull()
    expect(unwrapAssetToken('<img="   ">')).toBeNull()
    expect(unwrapAssetToken('<img src="   ">')).toBeNull()
    expect(unwrapAssetToken('""')).toBeNull()
  })
})

describe('extractAssetTokens', () => {
  it('extracts markdown and legacy asset token formats', () => {
    const input = [
      '![Hero](asset:hero_happy.png)',
      '[ 🖼 | hero_wave.png ]',
      '{{image::hero_laugh.png}}',
      '{{img::hero_cry.png}}',
      '<img="hero_sad.png">',
      '<img src="hero_angry.png">',
      "<img src='hero_surprised.png'>",
      '<img src=hero_calm.png>',
    ].join('\n')

    expect(extractAssetTokens(input)).toEqual([
      'hero_happy.png',
      'hero_wave.png',
      'hero_laugh.png',
      'hero_cry.png',
      'hero_sad.png',
      'hero_angry.png',
      'hero_surprised.png',
      'hero_calm.png',
    ])
  })

  it('deduplicates repeated tokens and ignores empty captures', () => {
    const input = [
      '![Hero](asset: hero_happy.png )',
      '![Hero Again](asset:hero_happy.png)',
      '{{image::   }}',
      '[ 🖼 | hero_happy.png ]',
    ].join('\n')

    expect(extractAssetTokens(input)).toEqual(['hero_happy.png'])
  })

  it('ignores matched legacy formats whose payload trims to an empty token', () => {
    const input = [
      '![Hero](asset:)',
      '[ 🖼 |   ]',
      '{{image::   }}',
      '{{img::   }}',
      '<img="   ">',
      '<img src="   ">',
    ].join('\n')

    expect(extractAssetTokens(input)).toEqual([])
  })
})
