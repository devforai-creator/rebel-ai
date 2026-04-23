import { describe, expect, it, vi } from 'vitest'
import {
  dispatchNonBlockingSupportEffect,
  SUPPORT_TIER_FEATURES,
  SUPPORT_TIER_HEADER,
  SUPPORT_TIERS,
  withSupportTierHeaders,
} from './support-tier'

describe('withSupportTierHeaders', () => {
  it('sets the support-tier header while preserving existing headers', () => {
    const headers = withSupportTierHeaders(SUPPORT_TIERS.EXPERIMENTAL, {
      'content-type': 'application/json',
    })

    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get(SUPPORT_TIER_HEADER)).toBe('experimental')
  })
})

describe('dispatchNonBlockingSupportEffect', () => {
  it('swallows sync failures and forwards them to the optional error handler', async () => {
    const onError = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => {
      dispatchNonBlockingSupportEffect({
        feature: SUPPORT_TIER_FEATURES.MESSAGE_TRANSLATION_TRIGGER,
        execute: () => {
          throw new Error('boom')
        },
        onError,
      })
    }).not.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      SUPPORT_TIER_FEATURES.MESSAGE_TRANSLATION_TRIGGER,
    )
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

describe('support-tier feature registry', () => {
  it('classifies the currently agreed feature boundaries', () => {
    expect(SUPPORT_TIER_FEATURES.LOCAL_RBX_MAINTAINER_IMPORT.tier).toBe('fallback')
    expect(SUPPORT_TIER_FEATURES.MESSAGE_TRANSLATION_TRIGGER.tier).toBe('experimental')
    expect(SUPPORT_TIER_FEATURES.MESSAGE_REPROCESS.tier).toBe('experimental')
    expect(SUPPORT_TIER_FEATURES.SUMMARY_WINDOW_MEMORY.tier).toBe('fallback')
    expect(SUPPORT_TIER_FEATURES.LEGACY_ASSET_URL_COMPATIBILITY.tier).toBe('removal')
  })
})
