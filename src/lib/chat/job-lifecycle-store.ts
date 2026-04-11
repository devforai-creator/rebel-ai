import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'
import type { ChatJobLifecycleStage } from './job-lifecycle'

type ChatJobLifecycleSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from'>
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']

export async function persistChatJobLifecycleStage({
  supabase,
  jobId,
  stage,
  additionalUpdate,
}: {
  supabase: ChatJobLifecycleSupabaseClient
  jobId: string
  stage: ChatJobLifecycleStage
  additionalUpdate?: ChatGenerationJobUpdate
}): Promise<void> {
  const update: ChatGenerationJobUpdate = {
    lifecycle_stage: stage,
    ...(additionalUpdate ?? {}),
  }

  const { error } = await supabase
    .from('chat_generation_jobs')
    .update(update as never)
    .eq('id', jobId)

  if (error) {
    console.warn('[Chat Job Lifecycle] Failed to persist job stage', {
      jobId,
      stage,
      error: error.message,
    })
  }
}
