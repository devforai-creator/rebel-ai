import {
  CHAT_JOB_LIFECYCLE_STAGE_DISPATCHING_RUNNER_TRIGGER,
  CHAT_JOB_LIFECYCLE_STAGE_TRIGGER_DISPATCHED,
} from '@/lib/chat/job-lifecycle'
import { persistChatJobLifecycleStage } from '@/lib/chat/job-lifecycle-store'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import {
  recordChatRunnerTriggerFailure,
  recordChatRunnerTriggerSuccess,
} from '@/lib/chat/runner-trigger-monitor'
import { createAdminClient } from '@/lib/supabase/admin'
import { after } from 'next/server'

export function scheduleChatJobRunnerTrigger({
  chatId,
  jobId,
  requestId,
  logDebug,
}: {
  chatId: string
  jobId: string
  requestId: string
  logDebug?: (...args: unknown[]) => void
}): void {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const baseMetadata = { chatId, jobId, requestId }
  const adminSupabase = createAdminClientSafely()

  if (!adminSecret) {
    const error = new Error('CHAT_ADMIN_SECRET is not configured')
    void persistTriggerLifecycleFailure({
      supabase: adminSupabase,
      jobId,
    })
    void recordChatRunnerTriggerFailure(error, {
      ...baseMetadata,
      stage: 'schedule',
    })
    console.error('[Chat API] CHAT_ADMIN_SECRET missing; cannot trigger job runner', baseMetadata)
    return
  }

  after(async () => {
    await persistTriggerLifecycleDispatchStarted({
      supabase: adminSupabase,
      jobId,
    })

    let triggerUrl: string

    try {
      triggerUrl = buildInternalApiUrl('/api/internal/chat-job-runner/trigger').toString()
    } catch (error) {
      await persistTriggerLifecycleFailure({
        supabase: adminSupabase,
        jobId,
      })
      await recordChatRunnerTriggerFailure(error, {
        ...baseMetadata,
        stage: 'resolve-trigger-url',
      })
      console.error('[Chat API] Failed to resolve job runner trigger URL', {
        ...baseMetadata,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    logDebug?.('[Chat API] Triggering job runner', {
      chatId,
      requestId,
      triggerUrl,
      vercelEnv: process.env.VERCEL_ENV,
    })

    try {
      const response = await fetch(triggerUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${adminSecret}`,
          ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
            'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }),
        },
      })

      if (!response.ok) {
        const text = await response.text()
        const error = new Error(
          `Job runner trigger responded with status ${response.status}: ${text || 'Unknown error'}`,
        )
        await persistTriggerLifecycleFailure({
          supabase: adminSupabase,
          jobId,
        })
        await recordChatRunnerTriggerFailure(error, {
          ...baseMetadata,
          triggerUrl,
          status: response.status,
        })
        console.error('[Chat API] Job runner trigger responded with non-OK status', {
          ...baseMetadata,
          triggerUrl,
          status: response.status,
          body: text,
        })
        return
      }

      await persistTriggerLifecycleDispatchSucceeded({
        supabase: adminSupabase,
        jobId,
      })
      await recordChatRunnerTriggerSuccess({
        ...baseMetadata,
        triggerUrl,
        status: response.status,
      })
    } catch (error) {
      await persistTriggerLifecycleFailure({
        supabase: adminSupabase,
        jobId,
      })
      await recordChatRunnerTriggerFailure(error, {
        ...baseMetadata,
        triggerUrl,
        stage: 'fetch-trigger',
      })
      console.error('[Chat API] Failed to trigger job runner', {
        ...baseMetadata,
        triggerUrl,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

type ChatJobLifecycleSupabaseClient = ReturnType<typeof createAdminClient> | null

function createAdminClientSafely(): ChatJobLifecycleSupabaseClient {
  try {
    return createAdminClient()
  } catch (error) {
    console.warn('[Chat API] Failed to create admin client for trigger lifecycle persistence', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function persistTriggerLifecycleDispatchStarted({
  supabase,
  jobId,
}: {
  supabase: ChatJobLifecycleSupabaseClient
  jobId: string
}): Promise<void> {
  if (!supabase) {
    return
  }

  await persistChatJobLifecycleStage({
    supabase,
    jobId,
    stage: CHAT_JOB_LIFECYCLE_STAGE_DISPATCHING_RUNNER_TRIGGER,
    additionalUpdate: {
      failure_stage: null,
    },
  })
}

async function persistTriggerLifecycleDispatchSucceeded({
  supabase,
  jobId,
}: {
  supabase: ChatJobLifecycleSupabaseClient
  jobId: string
}): Promise<void> {
  if (!supabase) {
    return
  }

  await persistChatJobLifecycleStage({
    supabase,
    jobId,
    stage: CHAT_JOB_LIFECYCLE_STAGE_TRIGGER_DISPATCHED,
    additionalUpdate: {
      failure_stage: null,
    },
  })
}

async function persistTriggerLifecycleFailure({
  supabase,
  jobId,
}: {
  supabase: ChatJobLifecycleSupabaseClient
  jobId: string
}): Promise<void> {
  if (!supabase) {
    return
  }

  await persistChatJobLifecycleStage({
    supabase,
    jobId,
    stage: CHAT_JOB_LIFECYCLE_STAGE_DISPATCHING_RUNNER_TRIGGER,
    additionalUpdate: {
      failure_stage: CHAT_JOB_LIFECYCLE_STAGE_DISPATCHING_RUNNER_TRIGGER,
    },
  })
}
