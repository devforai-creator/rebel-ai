import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import {
  recordChatRunnerTriggerFailure,
  recordChatRunnerTriggerSuccess,
} from '@/lib/chat/runner-trigger-monitor'
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

  if (!adminSecret) {
    const error = new Error('CHAT_ADMIN_SECRET is not configured')
    void recordChatRunnerTriggerFailure(error, {
      ...baseMetadata,
      stage: 'schedule',
    })
    console.error('[Chat API] CHAT_ADMIN_SECRET missing; cannot trigger job runner', baseMetadata)
    return
  }

  after(async () => {
    let triggerUrl: string

    try {
      triggerUrl = buildInternalApiUrl('/api/internal/chat-job-runner/trigger').toString()
    } catch (error) {
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

      await recordChatRunnerTriggerSuccess({
        ...baseMetadata,
        triggerUrl,
        status: response.status,
      })
    } catch (error) {
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
