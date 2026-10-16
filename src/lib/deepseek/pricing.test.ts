import { expect, it } from 'vitest'
import { getDeepSeekPricingPeriod, summarizeDeepSeekPricingPeriods } from './pricing'

it.each([
  ['2026-10-16T00:59:59Z', 'off_peak'],
  ['2026-10-16T01:00:00Z', 'peak'],
  ['2026-10-16T03:59:59Z', 'peak'],
  ['2026-10-16T04:00:00Z', 'off_peak'],
  ['2026-10-16T05:59:59Z', 'off_peak'],
  ['2026-10-16T06:00:00Z', 'peak'],
  ['2026-10-16T09:59:59Z', 'peak'],
  ['2026-10-16T10:00:00Z', 'off_peak'],
  ['2026-10-16T10:00:00+09:00', 'peak'],
  ['2026-10-17T01:00:00Z', 'off_peak'],
  ['2026-10-18T06:00:00Z', 'off_peak'],
  ['2026-10-01T01:00:00Z', 'off_peak'],
  ['2026-10-07T09:00:00Z', 'off_peak'],
  ['2026-10-08T01:00:00Z', 'peak'],
  ['2026-02-23T01:00:00Z', 'off_peak'],
  ['2026-10-10T01:00:00Z', 'off_peak'],
  ['2027-10-15T01:00:00Z', 'unknown'],
  ['2027-10-15T12:00:00Z', 'off_peak'],
  ['invalid', 'unknown'],
  [null, 'unknown'],
] as const)('classifies %s without using the host time zone: %s', (timestamp, expected) => {
  expect(getDeepSeekPricingPeriod(timestamp)).toBe(expected)
})

it('keeps mixed call periods and incomplete information distinct', () => {
  expect(summarizeDeepSeekPricingPeriods(['peak', 'off_peak'])).toBe('mixed')
  expect(summarizeDeepSeekPricingPeriods(['off_peak', 'off_peak'])).toBe('off_peak')
  expect(summarizeDeepSeekPricingPeriods(['peak', 'unknown'])).toBe('unknown')
})
