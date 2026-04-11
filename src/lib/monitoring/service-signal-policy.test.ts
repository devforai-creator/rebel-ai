import { describe, expect, it } from 'vitest'

import {
  deriveAggregateSignalStatus,
  getExperimentalSignalStatus,
  getServiceSignalStatus,
} from './service-signal-policy'

describe('service signal policy', () => {
  it('treats summary generation as warn before repeated failures become degraded', () => {
    expect(
      getServiceSignalStatus({
        label: 'summary-generation',
        consecutiveFailures: 1,
      }),
    ).toBe('warn')

    expect(
      getServiceSignalStatus({
        label: 'summary-generation',
        consecutiveFailures: 2,
      }),
    ).toBe('degraded')
  })

  it('treats supported core services as degraded on the first consecutive failure', () => {
    expect(
      getServiceSignalStatus({
        label: 'chat-job-runner-trigger',
        consecutiveFailures: 1,
      }),
    ).toBe('degraded')
  })

  it('treats experimental signals as warn instead of degraded', () => {
    expect(getExperimentalSignalStatus({ consecutiveFailures: 0 })).toBe('ok')
    expect(getExperimentalSignalStatus({ consecutiveFailures: 1 })).toBe('warn')
  })

  it('derives aggregate status from the strongest signal', () => {
    expect(deriveAggregateSignalStatus(['ok', 'warn'])).toBe('warn')
    expect(deriveAggregateSignalStatus(['ok', 'warn', 'degraded'])).toBe('degraded')
  })
})
