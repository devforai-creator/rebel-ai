import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from '@/lib/chat/delivery-mode'
import { resolveInternalApiOrigin } from '@/lib/internal-api-origin'
import { pollAnthropicBatchJobForUser } from '@/app/api/internal/chat-job-runner/service'

export const runtime = 'nodejs'
export const revalidate = 0

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await context.params

    if (!jobId) {
      return NextResponse.json({ error: 'Job id is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: job, error } = await supabase
      .from('chat_generation_jobs')
      .select(
        'id, chat_id, status, error, delivery_mode, lifecycle_stage, failure_stage, created_at, updated_at',
      )
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.delivery_mode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH && job.status === 'processing') {
      await pollAnthropicBatchJobForUser({
        jobId,
        userId: user.id,
        origin: resolveInternalApiOrigin(),
      })
    }

    const { data: refreshedJob } = await supabase
      .from('chat_generation_jobs')
      .select(
        'id, chat_id, status, error, delivery_mode, lifecycle_stage, failure_stage, created_at, updated_at',
      )
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single()

    const responseJob = refreshedJob ?? job

    return NextResponse.json({
      id: responseJob.id,
      chatId: responseJob.chat_id,
      status: responseJob.status,
      error: responseJob.error,
      deliveryMode: responseJob.delivery_mode,
      lifecycleStage: responseJob.lifecycle_stage,
      failureStage: responseJob.failure_stage,
      createdAt: responseJob.created_at,
      updatedAt: responseJob.updated_at,
    })
  } catch (error) {
    console.error('[Chat Jobs API] Failed to load job status', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
