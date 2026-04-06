import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pollJobStatus, JobPollerDeps, JobPollerConfig } from './job-poller'

describe('pollJobStatus', () => {
  const SHORT_CONFIG: JobPollerConfig = {
    timeoutMs: 5000,
    initialDelayMs: 100,
    maxDelayMs: 500,
    backoffMultiplier: 2,
  }

  let mockDeps: JobPollerDeps
  let sleepCalls: number[]
  let currentTime: number

  beforeEach(() => {
    vi.useFakeTimers()
    currentTime = 0
    sleepCalls = []

    mockDeps = {
      fetchJobStatus: vi.fn(),
      onSuccess: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
      now: () => currentTime,
      sleep: vi.fn().mockImplementation(async (ms: number) => {
        sleepCalls.push(ms)
        currentTime += ms
      }),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('success case', () => {
    it('returns success when job completes', async () => {
      vi.mocked(mockDeps.fetchJobStatus).mockResolvedValue({ status: 'success' })

      const result = await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      expect(result).toEqual({ outcome: 'success' })
      expect(mockDeps.onSuccess).toHaveBeenCalledOnce()
      expect(mockDeps.onError).not.toHaveBeenCalled()
    })

    it('polls until success after pending status', async () => {
      vi.mocked(mockDeps.fetchJobStatus)
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'processing' })
        .mockResolvedValueOnce({ status: 'success' })

      const result = await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      expect(result).toEqual({ outcome: 'success' })
      expect(mockDeps.fetchJobStatus).toHaveBeenCalledTimes(3)
    })
  })

  describe('error case', () => {
    it('returns error when job fails', async () => {
      vi.mocked(mockDeps.fetchJobStatus).mockResolvedValue({
        status: 'error',
        error: 'LLM API error',
      })

      const result = await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      expect(result).toEqual({
        outcome: 'error',
        error: expect.objectContaining({ message: 'LLM API error' }),
      })
      expect(mockDeps.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'LLM API error' }),
      )
      expect(mockDeps.onSuccess).not.toHaveBeenCalled()
    })

    it('uses default error message when none provided', async () => {
      vi.mocked(mockDeps.fetchJobStatus).mockResolvedValue({
        status: 'error',
        error: null,
      })

      const result = await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      expect(result).toEqual({
        outcome: 'error',
        error: expect.objectContaining({ message: 'Failed to generate response.' }),
      })
    })
  })

  describe('timeout', () => {
    it('returns timeout error after timeout period', async () => {
      // Always return pending to trigger timeout
      vi.mocked(mockDeps.fetchJobStatus).mockResolvedValue({ status: 'pending' })

      const result = await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      expect(result).toEqual({
        outcome: 'timeout',
        error: expect.objectContaining({
          message: expect.stringContaining('timed out'),
        }),
      })
      expect(mockDeps.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('timed out') }),
      )
    })

    it('times out at correct threshold', async () => {
      vi.mocked(mockDeps.fetchJobStatus).mockResolvedValue({ status: 'pending' })

      await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      // Total sleep time should be close to timeout
      // (may slightly exceed due to last sleep before timeout check)
      const totalSleepTime = sleepCalls.reduce((a, b) => a + b, 0)
      expect(totalSleepTime).toBeGreaterThanOrEqual(
        SHORT_CONFIG.timeoutMs - SHORT_CONFIG.maxDelayMs,
      )
      expect(totalSleepTime).toBeLessThanOrEqual(SHORT_CONFIG.timeoutMs + SHORT_CONFIG.maxDelayMs)
    })
  })

  describe('backoff', () => {
    it('increases delay with each poll up to max', async () => {
      vi.mocked(mockDeps.fetchJobStatus)
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'success' })

      await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      // Initial: 100, then 200, then 400, then 500 (capped)
      expect(sleepCalls[0]).toBe(100)
      expect(sleepCalls[1]).toBe(200)
      expect(sleepCalls[2]).toBe(400)
    })

    it('caps delay at maxDelayMs', async () => {
      vi.mocked(mockDeps.fetchJobStatus)
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'success' })

      await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      // After several iterations, delay should be capped at 500
      const cappedCalls = sleepCalls.filter((ms) => ms === SHORT_CONFIG.maxDelayMs)
      expect(cappedCalls.length).toBeGreaterThan(0)
    })
  })

  describe('network resilience', () => {
    it('continues polling when fetchJobStatus returns null', async () => {
      vi.mocked(mockDeps.fetchJobStatus)
        .mockResolvedValueOnce(null) // Network error
        .mockResolvedValueOnce(null) // Another network error
        .mockResolvedValueOnce({ status: 'success' })

      const result = await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      expect(result).toEqual({ outcome: 'success' })
      expect(mockDeps.fetchJobStatus).toHaveBeenCalledTimes(3)
    })

    it('continues polling when fetchJobStatus throws', async () => {
      vi.mocked(mockDeps.fetchJobStatus)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ status: 'success' })

      const result = await pollJobStatus('job-123', mockDeps, SHORT_CONFIG)

      expect(result).toEqual({ outcome: 'success' })
      expect(mockDeps.fetchJobStatus).toHaveBeenCalledTimes(2)
    })
  })

  describe('slow progress notification', () => {
    const SLOW_CONFIG: JobPollerConfig = {
      timeoutMs: 10000,
      initialDelayMs: 100,
      maxDelayMs: 500,
      backoffMultiplier: 2,
      slowProgressThresholdMs: 2000,
    }

    it('calls onSlowProgress when threshold is reached', async () => {
      const onSlowProgress = vi.fn()
      const depsWithSlowProgress = { ...mockDeps, onSlowProgress }

      vi.mocked(depsWithSlowProgress.fetchJobStatus)
        .mockResolvedValueOnce({ status: 'pending' }) // 100ms
        .mockResolvedValueOnce({ status: 'pending' }) // 300ms
        .mockResolvedValueOnce({ status: 'pending' }) // 700ms
        .mockResolvedValueOnce({ status: 'pending' }) // 1500ms
        .mockResolvedValueOnce({ status: 'pending' }) // 2000ms - threshold reached
        .mockResolvedValueOnce({ status: 'success' })

      await pollJobStatus('job-123', depsWithSlowProgress, SLOW_CONFIG)

      expect(onSlowProgress).toHaveBeenCalledTimes(1)
      expect(onSlowProgress).toHaveBeenCalledWith(expect.any(Number))
    })

    it('only calls onSlowProgress once', async () => {
      const onSlowProgress = vi.fn()
      const depsWithSlowProgress = { ...mockDeps, onSlowProgress }

      // Keep returning pending to reach timeout
      vi.mocked(depsWithSlowProgress.fetchJobStatus).mockResolvedValue({ status: 'pending' })

      await pollJobStatus('job-123', depsWithSlowProgress, SLOW_CONFIG)

      // Should only be called once even though we poll many times after threshold
      expect(onSlowProgress).toHaveBeenCalledTimes(1)
    })

    it('does not call onSlowProgress if job completes before threshold', async () => {
      const onSlowProgress = vi.fn()
      const depsWithSlowProgress = { ...mockDeps, onSlowProgress }

      vi.mocked(depsWithSlowProgress.fetchJobStatus)
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'success' })

      await pollJobStatus('job-123', depsWithSlowProgress, SLOW_CONFIG)

      expect(onSlowProgress).not.toHaveBeenCalled()
    })

    it('works without onSlowProgress callback', async () => {
      // Should not throw when onSlowProgress is not provided
      vi.mocked(mockDeps.fetchJobStatus).mockResolvedValue({ status: 'pending' })

      const result = await pollJobStatus('job-123', mockDeps, SLOW_CONFIG)

      expect(result.outcome).toBe('timeout')
    })
  })
})
