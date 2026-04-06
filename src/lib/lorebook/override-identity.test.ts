import { describe, it, expect } from 'vitest'
import {
  computeLorebookEntryFingerprint,
  getLorebookOverrideKeyV2,
  getLorebookOverrideKeyLegacy,
  parseLegacyOverrideKey,
  type LorebookEntryIdentityInput,
} from './override-identity'

describe('override-identity', () => {
  // ============================================================================
  // parseLegacyOverrideKey Tests (previously uncovered)
  // ============================================================================

  describe('parseLegacyOverrideKey', () => {
    describe('v1 format (v1:entryKey:insertorder)', () => {
      it('parses valid v1 key', () => {
        const result = parseLegacyOverrideKey('v1:my-entry:5')

        expect(result).toEqual({
          entryKey: 'my-entry',
          insertorder: 5,
        })
      })

      it('parses v1 key with colons in entryKey', () => {
        // entryKey can contain colons - should use lastIndexOf
        const result = parseLegacyOverrideKey('v1:entry:with:colons:10')

        expect(result).toEqual({
          entryKey: 'entry:with:colons',
          insertorder: 10,
        })
      })

      it('parses v1 key with zero insertorder', () => {
        const result = parseLegacyOverrideKey('v1:test-entry:0')

        expect(result).toEqual({
          entryKey: 'test-entry',
          insertorder: 0,
        })
      })

      it('returns null for v1 key without insertorder', () => {
        const result = parseLegacyOverrideKey('v1:entry-only')

        expect(result).toBeNull()
      })

      it('returns null for v1 key with non-numeric insertorder', () => {
        const result = parseLegacyOverrideKey('v1:entry:abc')

        expect(result).toBeNull()
      })

      it('returns null for v1 key with empty entryKey', () => {
        const result = parseLegacyOverrideKey('v1::5')

        expect(result).toBeNull()
      })
    })

    describe('legacy format (entryKey:insertorder without v1 prefix)', () => {
      it('parses valid legacy key', () => {
        const result = parseLegacyOverrideKey('old-entry:3')

        expect(result).toEqual({
          entryKey: 'old-entry',
          insertorder: 3,
        })
      })

      it('parses legacy key with colons in entryKey', () => {
        const result = parseLegacyOverrideKey('entry:with:colons:7')

        expect(result).toEqual({
          entryKey: 'entry:with:colons',
          insertorder: 7,
        })
      })

      it('returns null for key without colon', () => {
        const result = parseLegacyOverrideKey('no-colon-here')

        expect(result).toBeNull()
      })

      it('returns null for key with colon at start', () => {
        // lastColon <= 0 check
        const result = parseLegacyOverrideKey(':5')

        expect(result).toBeNull()
      })

      it('returns null for key with non-numeric insertorder', () => {
        const result = parseLegacyOverrideKey('entry:notanumber')

        expect(result).toBeNull()
      })

      it('returns null for key with NaN insertorder', () => {
        const result = parseLegacyOverrideKey('entry:NaN')

        expect(result).toBeNull()
      })

      it('returns null for key with Infinity insertorder', () => {
        const result = parseLegacyOverrideKey('entry:Infinity')

        // Number('Infinity') === Infinity, but !Number.isFinite(Infinity)
        expect(result).toBeNull()
      })
    })
  })

  // ============================================================================
  // computeLorebookEntryFingerprint Tests
  // ============================================================================

  describe('computeLorebookEntryFingerprint', () => {
    const baseEntry: LorebookEntryIdentityInput = {
      key: 'test-key',
      content: 'Test content here',
    }

    it('returns consistent fingerprint for same input', () => {
      const fp1 = computeLorebookEntryFingerprint('module-1', baseEntry)
      const fp2 = computeLorebookEntryFingerprint('module-1', baseEntry)

      expect(fp1).toBe(fp2)
    })

    it('returns different fingerprint for different moduleId', () => {
      const fp1 = computeLorebookEntryFingerprint('module-1', baseEntry)
      const fp2 = computeLorebookEntryFingerprint('module-2', baseEntry)

      expect(fp1).not.toBe(fp2)
    })

    it('returns different fingerprint for different content', () => {
      const fp1 = computeLorebookEntryFingerprint('module-1', baseEntry)
      const fp2 = computeLorebookEntryFingerprint('module-1', {
        ...baseEntry,
        content: 'Different content',
      })

      expect(fp1).not.toBe(fp2)
    })

    it('returns different fingerprint for different key', () => {
      const fp1 = computeLorebookEntryFingerprint('module-1', baseEntry)
      const fp2 = computeLorebookEntryFingerprint('module-1', {
        ...baseEntry,
        key: 'different-key',
      })

      expect(fp1).not.toBe(fp2)
    })

    it('returns 16-character hex string', () => {
      const fp = computeLorebookEntryFingerprint('module-1', baseEntry)

      expect(fp).toMatch(/^[0-9a-f]{16}$/)
    })

    it('handles all optional fields', () => {
      const fullEntry: LorebookEntryIdentityInput = {
        key: 'full-key',
        content: 'Full content',
        secondkey: 'secondary',
        comment: 'A comment',
        mode: 'normal',
        insertorder: 5,
        alwaysActive: true,
        selective: false,
        folder: 'my-folder',
        useRegex: true,
      }

      const fp = computeLorebookEntryFingerprint('module-1', fullEntry)

      expect(fp).toMatch(/^[0-9a-f]{16}$/)
    })

    it('treats null and undefined optional fields the same', () => {
      const entryWithNull: LorebookEntryIdentityInput = {
        key: 'test',
        content: 'test',
        secondkey: null,
        comment: null,
      }

      const entryWithoutFields: LorebookEntryIdentityInput = {
        key: 'test',
        content: 'test',
      }

      const fp1 = computeLorebookEntryFingerprint('module-1', entryWithNull)
      const fp2 = computeLorebookEntryFingerprint('module-1', entryWithoutFields)

      expect(fp1).toBe(fp2)
    })

    it('differentiates based on boolean fields', () => {
      const entryActive: LorebookEntryIdentityInput = {
        key: 'test',
        content: 'test',
        alwaysActive: true,
      }

      const entryInactive: LorebookEntryIdentityInput = {
        key: 'test',
        content: 'test',
        alwaysActive: false,
      }

      const fp1 = computeLorebookEntryFingerprint('module-1', entryActive)
      const fp2 = computeLorebookEntryFingerprint('module-1', entryInactive)

      expect(fp1).not.toBe(fp2)
    })
  })

  // ============================================================================
  // getLorebookOverrideKeyV2 Tests
  // ============================================================================

  describe('getLorebookOverrideKeyV2', () => {
    it('returns v2 format key', () => {
      const key = getLorebookOverrideKeyV2('module-123', 'abc123def456')

      expect(key).toBe('v2:module-123:abc123def456')
    })

    it('handles special characters in moduleId', () => {
      const key = getLorebookOverrideKeyV2('module:with:colons', 'fingerprint')

      expect(key).toBe('v2:module:with:colons:fingerprint')
    })
  })

  // ============================================================================
  // getLorebookOverrideKeyLegacy Tests
  // ============================================================================

  describe('getLorebookOverrideKeyLegacy', () => {
    it('returns v1 format key', () => {
      const key = getLorebookOverrideKeyLegacy('my-entry', 5)

      expect(key).toBe('v1:my-entry:5')
    })

    it('handles zero insertorder', () => {
      const key = getLorebookOverrideKeyLegacy('entry', 0)

      expect(key).toBe('v1:entry:0')
    })

    it('handles special characters in entryKey', () => {
      const key = getLorebookOverrideKeyLegacy('entry:with:colons', 10)

      expect(key).toBe('v1:entry:with:colons:10')
    })
  })

  // ============================================================================
  // Round-trip Tests (key generation → parsing)
  // ============================================================================

  describe('round-trip: getLorebookOverrideKeyLegacy → parseLegacyOverrideKey', () => {
    it('can round-trip a v1 key', () => {
      const originalKey = 'test-entry'
      const originalOrder = 42

      const generated = getLorebookOverrideKeyLegacy(originalKey, originalOrder)
      const parsed = parseLegacyOverrideKey(generated)

      expect(parsed).toEqual({
        entryKey: originalKey,
        insertorder: originalOrder,
      })
    })

    it('can round-trip a v1 key with colons in entryKey', () => {
      const originalKey = 'entry:with:many:colons'
      const originalOrder = 7

      const generated = getLorebookOverrideKeyLegacy(originalKey, originalOrder)
      const parsed = parseLegacyOverrideKey(generated)

      expect(parsed).toEqual({
        entryKey: originalKey,
        insertorder: originalOrder,
      })
    })
  })
})
