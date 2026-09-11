import { requireBearerToken } from '@/lib/http/api-contract'
import { localWorkerOwner } from '@/lib/chat/local-worker'
import { localBaseURL } from '@/lib/llm/local'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const auth = requireBearerToken(req, process.env.CHAT_ADMIN_SECRET)
  if (!auth.success) return auth.response
  try {
    const owner = localWorkerOwner()
    if (!owner) return Response.json({ error: 'Worker disabled' }, { status: 404 })
    localBaseURL()
    const { error } = await createAdminClient()
      .from('local_chat_worker_status')
      .upsert({ user_id: owner, seen_at: new Date().toISOString() })
    return Response.json({ ready: !error }, { status: error ? 503 : 200 })
  } catch {
    return Response.json({ ready: false }, { status: 503 })
  }
}
