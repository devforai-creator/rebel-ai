import { afterEach, expect, it, vi } from 'vitest'
import { localQueueEnabledFor, localWorkerOwner } from './local-worker'

afterEach(() => vi.unstubAllEnvs())
it('defaults to cloud and cannot opt into local from Vercel', () => {
  vi.stubEnv('CHAT_RUNNER_TARGET', '')
  expect(localWorkerOwner()).toBeNull()
  vi.stubEnv('CHAT_RUNNER_TARGET', 'local')
  vi.stubEnv('VERCEL', '1')
  expect(localWorkerOwner).toThrow('LOCAL_WORKER_NOT_ALLOWED_ON_VERCEL')
})
it('requires explicit owner and only enables that owner', () => {
  vi.stubEnv('CHAT_RUNNER_TARGET', 'local')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('LOCAL_LLM_OWNER_ID', '')
  expect(localWorkerOwner).toThrow('LOCAL_WORKER_OWNER_REQUIRED')
  const id = '12345678-1234-1234-1234-123456789abc'
  vi.stubEnv('LOCAL_LLM_OWNER_ID', id)
  vi.stubEnv('LOCAL_LLM_QUEUE_ENABLED', 'true')
  expect(localWorkerOwner()).toBe(id)
  expect(localQueueEnabledFor(id)).toBe(true)
  expect(localQueueEnabledFor('other')).toBe(false)
})
