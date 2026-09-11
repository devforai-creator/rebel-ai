import { createAdminClient } from '@/lib/supabase/admin'

export function localWorkerOwner(): string | null {
  const target = process.env.CHAT_RUNNER_TARGET || 'cloud'
  if (!['cloud', 'local'].includes(target)) throw new Error('INVALID_RUNNER_TARGET')
  if (target !== 'local') return null
  if (process.env.VERCEL) throw new Error('LOCAL_WORKER_NOT_ALLOWED_ON_VERCEL')
  const owner = process.env.LOCAL_LLM_OWNER_ID ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) {
    throw new Error('LOCAL_WORKER_OWNER_REQUIRED')
  }
  return owner
}

export function localQueueEnabledFor(userId: string): boolean {
  return process.env.LOCAL_LLM_QUEUE_ENABLED === 'true' && process.env.LOCAL_LLM_OWNER_ID === userId
}

export async function localWorkerOnline(userId: string): Promise<boolean> {
  if (!localQueueEnabledFor(userId)) return false
  const { data, error } = await createAdminClient()
    .from('local_chat_worker_status')
    .select('seen_at')
    .eq('user_id', userId)
    .maybeSingle()
  const age = Date.now() - Date.parse(data?.seen_at ?? '')
  return !error && Number.isFinite(age) && age >= -5000 && age < 45000
}
