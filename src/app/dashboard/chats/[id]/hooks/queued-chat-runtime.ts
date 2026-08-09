import type { AssistantStreamBroadcastPayload } from '@/lib/chat/assistant-stream'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH, type ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import { CHAT_JOB_POLLER_LIMITS } from '@/lib/chat/runtime-limits'
import type { StreamingAssistantDraft } from '../utils'
import {
  DEFAULT_JOB_POLLER_CONFIG,
  type JobPollerConfig,
  resolveAdaptivePollDelay,
} from './job-poller'

export const BATCH_JOB_POLLER_CONFIG: JobPollerConfig = {
  timeoutMs: 25 * 60 * 60 * 1000,
  initialDelayMs: 3000,
  maxDelayMs: 60_000,
  backoffMultiplier: 1.4,
  slowProgressThresholdMs: 30_000,
}

export function createStreamingAssistantDraft(
  jobId: string,
  regenerateAssistantMessageId: string | null,
  deliveryMode: ChatDeliveryMode,
  createdAt = new Date().toISOString(),
): StreamingAssistantDraft {
  const isBatchMode = deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH

  return {
    id: `stream-${jobId}`,
    jobId,
    role: 'assistant',
    content: isBatchMode
      ? 'Claude Batch 처리 중입니다. 이 모드는 스트리밍 없이 완료 후 한 번에 표시됩니다.'
      : '',
    created_at: createdAt,
    streaming: true,
    replaceMessageId: regenerateAssistantMessageId,
    deliveryMode,
  }
}

export function updateStreamingDraftFromEvent(
  current: StreamingAssistantDraft | null,
  payload: Extract<AssistantStreamBroadcastPayload, { kind: 'snapshot' }>,
  createdAt = new Date().toISOString(),
): StreamingAssistantDraft {
  if (!current || current.jobId !== payload.jobId) {
    return {
      id: `stream-${payload.jobId}`,
      jobId: payload.jobId,
      role: 'assistant',
      content: payload.content,
      created_at: createdAt,
      streaming: true,
      replaceMessageId: payload.regenerateAssistantMessageId,
      deliveryMode: current?.deliveryMode,
    }
  }

  return {
    ...current,
    content: payload.content,
    replaceMessageId: payload.regenerateAssistantMessageId,
  }
}

export function getQueuedChatSlowProgressMessage(
  deliveryMode: ChatDeliveryMode,
  elapsedMs: number,
): string {
  const seconds = Math.round(elapsedMs / 1000)
  return deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
    ? `Claude Batch is still processing (${seconds}s). It will appear here when finished.`
    : `Response is taking longer than usual (${seconds}s). Still waiting...`
}

export function getQueuedChatPollerConfig(deliveryMode: ChatDeliveryMode): JobPollerConfig {
  return deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
    ? BATCH_JOB_POLLER_CONFIG
    : DEFAULT_JOB_POLLER_CONFIG
}

export function resolveQueuedChatPollSleepDelay({
  baseDelayMs,
  deliveryMode,
  isPageVisible,
  lastProgressAt,
  now,
}: {
  baseDelayMs: number
  deliveryMode: ChatDeliveryMode
  isPageVisible: boolean
  lastProgressAt: number | null
  now: number
}): number {
  if (deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH) {
    return baseDelayMs
  }

  return resolveAdaptivePollDelay({
    baseDelayMs,
    isPageVisible,
    lastProgressAt,
    now,
    hiddenTabMinDelayMs: CHAT_JOB_POLLER_LIMITS.hiddenTabMinDelayMs,
    recentStreamWindowMs: CHAT_JOB_POLLER_LIMITS.recentStreamWindowMs,
    recentStreamMinDelayMs: CHAT_JOB_POLLER_LIMITS.recentStreamMinDelayMs,
  })
}
