import { afterEach, expect, it, vi } from 'vitest'
const upsert = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ upsert }) }) }))
import { POST } from './route'
afterEach(() => {
  vi.unstubAllEnvs()
  upsert.mockReset()
})
const request = (token: string) =>
  new Request('http://localhost/api/internal/local-worker', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token },
  })
it('rejects unauthenticated heartbeat without a DB mutation', async () => {
  vi.stubEnv('CHAT_ADMIN_SECRET', 'synthetic-secret')
  expect((await POST(request('wrong'))).status).toBe(401)
  expect(upsert).not.toHaveBeenCalled()
})
it('cannot impersonate a local worker from a cloud runtime', async () => {
  vi.stubEnv('CHAT_ADMIN_SECRET', 'synthetic-secret')
  vi.stubEnv('CHAT_RUNNER_TARGET', 'local')
  vi.stubEnv('VERCEL', '1')
  expect((await POST(request('synthetic-secret'))).status).toBe(503)
  expect(upsert).not.toHaveBeenCalled()
})
it('writes only the server-configured owner', async () => {
  vi.stubEnv('CHAT_ADMIN_SECRET', 'synthetic-secret')
  vi.stubEnv('CHAT_RUNNER_TARGET', 'local')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('LOCAL_LLM_ENABLED', 'true')
  vi.stubEnv('LOCAL_LLM_BASE_URL', 'http://127.0.0.1:8000/v1')
  vi.stubEnv('LOCAL_LLM_OWNER_ID', '12345678-1234-1234-1234-123456789abc')
  upsert.mockResolvedValue({ error: null })
  expect((await POST(request('synthetic-secret'))).status).toBe(200)
  expect(upsert).toHaveBeenCalledWith({
    user_id: '12345678-1234-1234-1234-123456789abc',
    seen_at: expect.any(String),
  })
})
