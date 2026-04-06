/**
 * Asset URI Normalization Tests
 *
 * Tests for normalizeAssetKey function in asset-uri.ts
 */

import { describe, it, expect } from 'vitest'
import { normalizeAssetKey } from './asset-uri'

describe('normalizeAssetKey', () => {
  // =========================================================================
  // Basic functionality
  // =========================================================================

  describe('basic normalization', () => {
    it('returns null for empty/falsy inputs', () => {
      expect(normalizeAssetKey('')).toBeNull()
      expect(normalizeAssetKey(null)).toBeNull()
      expect(normalizeAssetKey(undefined)).toBeNull()
      expect(normalizeAssetKey('   ')).toBeNull()
    })

    it('trims whitespace', () => {
      expect(normalizeAssetKey('  test.png  ')).toBe('test.png')
    })

    it('converts to lowercase', () => {
      expect(normalizeAssetKey('MyImage.PNG')).toBe('myimage.png')
      expect(normalizeAssetKey('UPPERCASE')).toBe('uppercase')
    })
  })

  // =========================================================================
  // Separator normalization
  // =========================================================================

  describe('separator normalization', () => {
    it('normalizes spaces to underscores', () => {
      expect(normalizeAssetKey('blushing shyly')).toBe('blushing_shyly')
      expect(normalizeAssetKey('multiple  spaces')).toBe('multiple_spaces')
    })

    it('normalizes hyphens to underscores', () => {
      expect(normalizeAssetKey('blushing-shyly')).toBe('blushing_shyly')
      expect(normalizeAssetKey('multi--hyphen')).toBe('multi_hyphen')
    })

    it('normalizes mixed separators', () => {
      expect(normalizeAssetKey('blushing_shyly')).toBe('blushing_shyly')
      expect(normalizeAssetKey('space hyphen_underscore')).toBe('space_hyphen_underscore')
    })

    it('collapses consecutive separators', () => {
      expect(normalizeAssetKey('a___b')).toBe('a_b')
      expect(normalizeAssetKey('a   b')).toBe('a_b')
      expect(normalizeAssetKey('a---b')).toBe('a_b')
      expect(normalizeAssetKey('a-_-b')).toBe('a_b')
    })
  })

  // =========================================================================
  // Protocol prefix stripping
  // =========================================================================

  describe('protocol prefix stripping', () => {
    it('strips embeded:// prefix (typo version)', () => {
      expect(normalizeAssetKey('embeded://assets/image.png')).toBe('assets/image.png')
    })

    it('strips embedded:// prefix (correct spelling)', () => {
      expect(normalizeAssetKey('embedded://assets/image.png')).toBe('assets/image.png')
    })

    it('strips __asset: prefix', () => {
      expect(normalizeAssetKey('__asset:my_image')).toBe('my_image')
      expect(normalizeAssetKey('__asset:assets/file.png')).toBe('assets/file.png')
    })

    it('strips asset:// prefix', () => {
      expect(normalizeAssetKey('asset://images/test.png')).toBe('images/test.png')
    })

    it('strips ccdefault: prefix', () => {
      expect(normalizeAssetKey('ccdefault:avatar')).toBe('avatar')
    })

    it('handles case-insensitive prefixes', () => {
      expect(normalizeAssetKey('EMBEDED://test')).toBe('test')
      expect(normalizeAssetKey('__ASSET:test')).toBe('test')
    })
  })

  // =========================================================================
  // Path normalization
  // =========================================================================

  describe('path normalization', () => {
    it('normalizes backslashes to forward slashes', () => {
      expect(normalizeAssetKey('assets\\image\\file.png')).toBe('assets/image/file.png')
    })

    it('removes leading ./ prefix', () => {
      expect(normalizeAssetKey('./assets/image.png')).toBe('assets/image.png')
    })

    it('removes leading / prefix', () => {
      expect(normalizeAssetKey('/assets/image.png')).toBe('assets/image.png')
    })

    it('collapses multiple slashes', () => {
      expect(normalizeAssetKey('assets//image///file.png')).toBe('assets/image/file.png')
    })
  })

  // =========================================================================
  // Query string and hash removal
  // =========================================================================

  describe('query/hash removal', () => {
    it('removes query strings', () => {
      expect(normalizeAssetKey('image.png?v=123')).toBe('image.png')
      expect(normalizeAssetKey('file.jpg?width=100&height=200')).toBe('file.jpg')
    })

    it('removes hash fragments', () => {
      expect(normalizeAssetKey('image.png#section')).toBe('image.png')
    })

    it('removes both query and hash', () => {
      expect(normalizeAssetKey('image.png?v=1#anchor')).toBe('image.png')
    })
  })

  // =========================================================================
  // Quote handling
  // =========================================================================

  describe('quote stripping', () => {
    it('strips surrounding double quotes', () => {
      expect(normalizeAssetKey('"image.png"')).toBe('image.png')
    })

    it('strips surrounding single quotes', () => {
      expect(normalizeAssetKey("'image.png'")).toBe('image.png')
    })

    it('handles mismatched quotes by stripping both ends', () => {
      // The regex strips any leading/trailing quote character
      expect(normalizeAssetKey('"image.png\'')).toBe('image.png')
    })
  })

  // =========================================================================
  // Real-world CharX examples
  // =========================================================================

  describe('real-world CharX asset references', () => {
    it('normalizes RisuAI emotion asset paths', () => {
      expect(normalizeAssetKey('embeded://assets/other/image/2.webp')).toBe(
        'assets/other/image/2.webp',
      )
    })

    it('normalizes character emotion names', () => {
      expect(normalizeAssetKey('Angelika_sad_1')).toBe('angelika_sad_1')
      expect(normalizeAssetKey('miro_smirking')).toBe('miro_smirking')
    })

    it('allows matching of space vs underscore variants', () => {
      // "blushing shyly" and "blushing_shyly" should normalize to the same key
      const spaceVariant = normalizeAssetKey('blushing shyly')
      const underscoreVariant = normalizeAssetKey('blushing_shyly')
      expect(spaceVariant).toBe(underscoreVariant)
    })

    it('normalizes complex CharX paths', () => {
      expect(normalizeAssetKey('embeded://assets/other/image/seolji_excited.png')).toBe(
        'assets/other/image/seolji_excited.png',
      )
    })

    it('handles numeric filename assets', () => {
      expect(normalizeAssetKey('embeded://1.png')).toBe('1.png')
      expect(normalizeAssetKey('assets/2.webp')).toBe('assets/2.webp')
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('returns null for whitespace-only after normalization', () => {
      // After stripping quotes, if only whitespace remains
      expect(normalizeAssetKey('" "')).toBeNull()
    })

    it('handles very long paths', () => {
      const longPath = 'assets/' + 'sub/'.repeat(20) + 'file.png'
      const result = normalizeAssetKey(longPath)
      expect(result).toContain('assets/')
      expect(result).toContain('file.png')
    })

    it('preserves file extensions', () => {
      expect(normalizeAssetKey('image.PNG')).toBe('image.png')
      expect(normalizeAssetKey('file.WEBP')).toBe('file.webp')
      expect(normalizeAssetKey('photo.JPG')).toBe('photo.jpg')
    })

    it('handles paths with dots', () => {
      expect(normalizeAssetKey('my.file.name.png')).toBe('my.file.name.png')
    })

    it('handles unicode characters', () => {
      expect(normalizeAssetKey('캐릭터_이미지.png')).toBe('캐릭터_이미지.png')
    })

    it('handles numbers in names', () => {
      expect(normalizeAssetKey('character_1_emotion_2')).toBe('character_1_emotion_2')
    })
  })

  // =========================================================================
  // Combined transformations
  // =========================================================================

  describe('combined transformations', () => {
    it('applies all normalizations together', () => {
      const input = '  "EMBEDED://./Assets\\Other\\Image/My Image-File.PNG?v=123"  '
      const result = normalizeAssetKey(input)

      // Should: trim, strip quotes, strip prefix, normalize slashes,
      // remove ./, lowercase, normalize separators, remove query
      expect(result).toBe('assets/other/image/my_image_file.png')
    })

    it('handles __asset: with complex paths', () => {
      expect(normalizeAssetKey('__asset:Assets/Other/emotion-happy.webp')).toBe(
        'assets/other/emotion_happy.webp',
      )
    })
  })
})
