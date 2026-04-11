import { buildInternalApiUrl } from '@/lib/internal-api-origin'
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
  if (!adminSecret) {
    return
  }

  const triggerUrl = buildInternalApiUrl('/api/internal/chat-job-runner/trigger').toString()

  logDebug?.('[Chat API] Triggering job runner', {
    chatId,
    requestId,
    triggerUrl,
    vercelEnv: process.env.VERCEL_ENV,
  })

  after(async () => {
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
        console.error('[Chat API] Job runner trigger responded with non-OK status', {
          chatId,
          requestId,
          jobId,
          triggerUrl,
          status: response.status,
          body: text,
        })
      }
    } catch (error) {
      console.error('[Chat API] Failed to trigger job runner', {
        chatId,
        requestId,
        jobId,
        triggerUrl,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
