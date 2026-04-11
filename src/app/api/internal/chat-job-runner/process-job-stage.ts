import { createAdminClient } from '@/lib/supabase/admin'
import { parseChatJobPayload, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import {
  CHAT_JOB_LIFECYCLE_STAGE_COMPLETED,
  CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD,
  CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT,
} from '@/lib/chat/job-lifecycle'
import type { Database } from '@/types/database.types'
import { ChatJobExecutionError } from './runner-errors'

const CHAT_JOB_STATUS_UPDATE_MAX_ATTEMPTS = 3

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']

export type ProcessChatJobExecutionResult = {
  status: 'success' | 'processing'
}

export type ProcessChatJobStageResult = {
  jobId: string
  status: 'success' | 'processing' | 'error'
  error?: string
}

type ExecuteChatJobFn = (args: {
  supabase: AdminSupabaseClient
  jobId: string
  payload: ChatGenerationJobPayload
  origin: string
}) => Promise<ProcessChatJobExecutionResult>

class ChatJobStatusUpdateError extends Error {
  targetStatus: 'success' | 'error'

  constructor(targetStatus: 'success' | 'error', attempts: number, message: string) {
    super(
      `Failed to persist chat job ${targetStatus} status after ${attempts} attempts: ${message}`,
    )
    this.name = 'ChatJobStatusUpdateError'
    this.targetStatus = targetStatus
  }
}

async function persistTerminalJobStatus({
  supabase,
  jobId,
  update,
  targetStatus,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  update: ChatGenerationJobUpdate
  targetStatus: 'success' | 'error'
}): Promise<void> {
  let lastError: { message: string } | null = null

  for (let attempt = 1; attempt <= CHAT_JOB_STATUS_UPDATE_MAX_ATTEMPTS; attempt += 1) {
    const { error } = await supabase
      .from('chat_generation_jobs')
      .update(update as never)
      .eq('id', jobId)

    if (!error) {
      return
    }

    lastError = error
    console.warn('[Chat Job Runner] Failed to persist job status', {
      jobId,
      status: targetStatus,
      attempt,
      error: error.message,
    })
  }

  throw new ChatJobStatusUpdateError(
    targetStatus,
    CHAT_JOB_STATUS_UPDATE_MAX_ATTEMPTS,
    lastError?.message ?? 'Unknown database error',
  )
}

export async function processChatJobStage({
  supabase,
  jobId,
  rawPayload,
  origin,
  executeChatJobFn,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  rawPayload: unknown
  origin: string
  executeChatJobFn: ExecuteChatJobFn
}): Promise<ProcessChatJobStageResult> {
  const payload = parseChatJobPayload(rawPayload)

  if (!payload) {
    const invalidPayloadMessage = 'Invalid job payload'
    const invalidPayloadUpdate: ChatGenerationJobUpdate = {
      status: 'error',
      error: invalidPayloadMessage,
      lifecycle_stage: CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD,
      failure_stage: CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD,
    }

    try {
      await persistTerminalJobStatus({
        supabase,
        jobId,
        update: invalidPayloadUpdate,
        targetStatus: 'error',
      })
    } catch (statusError) {
      console.error('[Chat Job Runner] Failed to persist invalid job payload status', {
        jobId,
        error: statusError,
      })
      return {
        jobId,
        status: 'error',
        error: statusError instanceof Error ? statusError.message : invalidPayloadMessage,
      }
    }

    return { jobId, status: 'error', error: invalidPayloadMessage }
  }

  try {
    const execution = await executeChatJobFn({ supabase, jobId, payload, origin })

    if (execution.status === 'processing') {
      return { jobId, status: 'processing' }
    }

    const successUpdate: ChatGenerationJobUpdate = {
      status: 'success',
      error: null,
      lifecycle_stage: CHAT_JOB_LIFECYCLE_STAGE_COMPLETED,
      failure_stage: null,
    }
    await persistTerminalJobStatus({
      supabase,
      jobId,
      update: successUpdate,
      targetStatus: 'success',
    })

    return { jobId, status: 'success' }
  } catch (error) {
    if (error instanceof ChatJobStatusUpdateError && error.targetStatus === 'success') {
      console.error('[Chat Job Runner] Job completed but final status update failed', {
        jobId,
        error,
      })
      return { jobId, status: 'error', error: error.message }
    }

    const message = error instanceof Error ? error.message : 'Unknown job failure'
    const failureStage =
      error instanceof ChatJobExecutionError
        ? error.lifecycleStage
        : CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT
    const errorUpdate: ChatGenerationJobUpdate = {
      status: 'error',
      error: message,
      lifecycle_stage: failureStage,
      failure_stage: failureStage,
    }

    try {
      await persistTerminalJobStatus({
        supabase,
        jobId,
        update: errorUpdate,
        targetStatus: 'error',
      })
    } catch (statusError) {
      console.error('[Chat Job Runner] Failed to persist job error status', {
        jobId,
        error: statusError,
        originalError: error,
      })
      return {
        jobId,
        status: 'error',
        error:
          statusError instanceof Error
            ? `${statusError.message}. Original job error: ${message}`
            : message,
      }
    }

    console.error('[Chat Job Runner] Job failed', { jobId, error })
    return { jobId, status: 'error', error: message }
  }
}
