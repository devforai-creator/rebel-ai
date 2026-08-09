import type { AssistantStreamBroadcastPayload } from '@/lib/chat/assistant-stream'
import type { ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import { isVisibleMessageStatus, MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import type { Message } from '@/types/database.types'
import type { ActiveChatJob, DisplayMessage, StreamingAssistantDraft } from '../utils'
import { mapMessageToDisplay } from '../utils'
import { createStreamingAssistantDraft, updateStreamingDraftFromEvent } from './queued-chat-runtime'
import {
  reconcileAssistantMessage,
  type AssistantMessageSnapshot,
} from './reconcile-assistant-message'

type IdleSubmission = {
  phase: 'idle'
}

type MessageSubmission = {
  phase: 'submitting'
  kind: 'message'
  optimisticMessageId: string
  regenerateAssistantMessageId: null
}

type RegenerationSubmission = {
  phase: 'submitting'
  kind: 'regeneration'
  optimisticMessageId: null
  regenerateAssistantMessageId: string
}

export type QueuedChatSubmission = IdleSubmission | MessageSubmission | RegenerationSubmission

export type QueuedChatActiveJob = ActiveChatJob & {
  phase: 'waiting' | 'streaming' | 'message-received' | 'stream-error'
  source: 'initial' | 'submission'
}

export type QueuedChatLifecycleState = {
  messages: DisplayMessage[]
  submission: QueuedChatSubmission
  activeJob: QueuedChatActiveJob | null
  streamingDraft: StreamingAssistantDraft | null
  error: Error | null
}

export type QueuedChatLifecycleAction =
  | {
      type: 'MESSAGE_SUBMIT_STARTED'
      optimisticMessage: DisplayMessage
    }
  | {
      type: 'REGENERATION_SUBMIT_STARTED'
      regenerateAssistantMessageId: string
    }
  | {
      type: 'SUBMIT_ACCEPTED'
      jobId: string
      deliveryMode: ChatDeliveryMode
      userMessageId: string | null
      createdAt: string
    }
  | {
      type: 'SUBMIT_FAILED'
      error: Error
    }
  | {
      type: 'PERSISTED_USER_UPSERTED'
      message: Message
    }
  | {
      type: 'PERSISTED_ASSISTANT_UPSERTED'
      message: AssistantMessageSnapshot
    }
  | {
      type: 'MESSAGE_DELETED'
      messageId: string
    }
  | {
      type: 'STREAM_EVENT_RECEIVED'
      payload: AssistantStreamBroadcastPayload
      receivedAt: string
    }
  | {
      type: 'JOB_SUCCEEDED'
      jobId: string
    }
  | {
      type: 'JOB_FAILED'
      jobId: string
      error: Error
    }
  | {
      type: 'ERROR_SET'
      error: Error
    }
  | {
      type: 'MESSAGES_REPLACED'
      messages: DisplayMessage[]
    }

const IDLE_SUBMISSION: IdleSubmission = { phase: 'idle' }

export function createInitialQueuedChatLifecycleState({
  initialMessages,
  initialActiveJob,
  createdAt,
}: {
  initialMessages: Message[]
  initialActiveJob: ActiveChatJob | null
  createdAt: string
}): QueuedChatLifecycleState {
  return {
    messages: initialMessages.map(mapMessageToDisplay),
    submission: IDLE_SUBMISSION,
    activeJob: initialActiveJob
      ? {
          ...initialActiveJob,
          phase: 'waiting',
          source: 'initial',
        }
      : null,
    streamingDraft: initialActiveJob
      ? createStreamingAssistantDraft(
          initialActiveJob.id,
          initialActiveJob.regenerateAssistantMessageId,
          initialActiveJob.deliveryMode,
          createdAt,
        )
      : null,
    error: null,
  }
}

export function getQueuedChatRegenerationTarget(state: QueuedChatLifecycleState): string | null {
  if (state.activeJob) {
    return state.activeJob.regenerateAssistantMessageId
  }

  if (state.submission.phase === 'submitting') {
    return state.submission.regenerateAssistantMessageId
  }

  return null
}

export function isQueuedChatLifecycleLoading(state: QueuedChatLifecycleState): boolean {
  return state.submission.phase === 'submitting' || state.activeJob !== null
}

function upsertPersistedUserMessage(
  messages: DisplayMessage[],
  message: Message,
): DisplayMessage[] {
  const mappedMessage = mapMessageToDisplay(message)
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id)

  if (existingIndex === -1) {
    return [...messages, mappedMessage]
  }

  const nextMessages = [...messages]
  nextMessages[existingIndex] = mappedMessage
  return nextMessages
}

function confirmOptimisticMessage(
  messages: DisplayMessage[],
  optimisticMessageId: string,
  persistedMessageId: string,
): DisplayMessage[] {
  const optimisticIndex = messages.findIndex((message) => message.id === optimisticMessageId)
  if (optimisticIndex === -1) {
    return messages
  }

  const nextMessages = [...messages]
  const confirmedMessage = { ...nextMessages[optimisticIndex] }
  delete confirmedMessage.temp
  nextMessages[optimisticIndex] = {
    ...confirmedMessage,
    id: persistedMessageId,
  }
  return nextMessages
}

export function queuedChatLifecycleReducer(
  state: QueuedChatLifecycleState,
  action: QueuedChatLifecycleAction,
): QueuedChatLifecycleState {
  switch (action.type) {
    case 'MESSAGE_SUBMIT_STARTED':
      if (isQueuedChatLifecycleLoading(state)) {
        return state
      }

      return {
        ...state,
        messages: [...state.messages, action.optimisticMessage],
        submission: {
          phase: 'submitting',
          kind: 'message',
          optimisticMessageId: action.optimisticMessage.id,
          regenerateAssistantMessageId: null,
        },
        error: null,
      }

    case 'REGENERATION_SUBMIT_STARTED':
      if (isQueuedChatLifecycleLoading(state)) {
        return state
      }

      return {
        ...state,
        submission: {
          phase: 'submitting',
          kind: 'regeneration',
          optimisticMessageId: null,
          regenerateAssistantMessageId: action.regenerateAssistantMessageId,
        },
        error: null,
      }

    case 'SUBMIT_ACCEPTED': {
      if (state.submission.phase !== 'submitting') {
        return state
      }

      const regenerateAssistantMessageId = state.submission.regenerateAssistantMessageId
      const messages =
        state.submission.kind === 'message' && action.userMessageId
          ? confirmOptimisticMessage(
              state.messages,
              state.submission.optimisticMessageId,
              action.userMessageId,
            )
          : state.messages

      return {
        ...state,
        messages,
        submission: IDLE_SUBMISSION,
        activeJob: {
          id: action.jobId,
          deliveryMode: action.deliveryMode,
          regenerateAssistantMessageId,
          phase: 'waiting',
          source: 'submission',
        },
        streamingDraft: createStreamingAssistantDraft(
          action.jobId,
          regenerateAssistantMessageId,
          action.deliveryMode,
          action.createdAt,
        ),
        error: null,
      }
    }

    case 'SUBMIT_FAILED': {
      if (state.submission.phase !== 'submitting') {
        return {
          ...state,
          error: action.error,
        }
      }

      const optimisticMessageId = state.submission.optimisticMessageId
      return {
        ...state,
        messages: optimisticMessageId
          ? state.messages.filter(
              (message) => message.id !== optimisticMessageId || message.temp !== true,
            )
          : state.messages,
        submission: IDLE_SUBMISSION,
        error: action.error,
      }
    }

    case 'PERSISTED_USER_UPSERTED':
      return {
        ...state,
        messages: upsertPersistedUserMessage(state.messages, action.message),
      }

    case 'PERSISTED_ASSISTANT_UPSERTED': {
      const activeJob = state.activeJob
      const messageStatus = action.message.message_status ?? MESSAGE_STATUS_COMPLETED
      const messageWasAlreadyVisible = state.messages.some(
        (message) => message.id === action.message.id,
      )
      const { nextMessages } = reconcileAssistantMessage({
        prevMessages: state.messages,
        assistantMessage: action.message,
        pendingRegenerationTargetId: getQueuedChatRegenerationTarget(state),
      })
      const confirmsCurrentResponse =
        activeJob !== null && isVisibleMessageStatus(messageStatus) && !messageWasAlreadyVisible

      return {
        ...state,
        messages: nextMessages,
        activeJob: confirmsCurrentResponse
          ? {
              ...activeJob,
              phase: 'message-received',
            }
          : activeJob,
        streamingDraft: confirmsCurrentResponse ? null : state.streamingDraft,
      }
    }

    case 'MESSAGE_DELETED':
      return {
        ...state,
        messages: state.messages.filter((message) => message.id !== action.messageId),
      }

    case 'STREAM_EVENT_RECEIVED': {
      if (!state.activeJob || state.activeJob.id !== action.payload.jobId) {
        return state
      }

      if (action.payload.kind === 'error') {
        return {
          ...state,
          activeJob: {
            ...state.activeJob,
            phase: 'stream-error',
          },
          streamingDraft: null,
        }
      }

      if (
        state.activeJob.phase === 'message-received' ||
        state.activeJob.phase === 'stream-error'
      ) {
        return state
      }

      return {
        ...state,
        activeJob: {
          ...state.activeJob,
          phase: 'streaming',
        },
        streamingDraft: updateStreamingDraftFromEvent(
          state.streamingDraft,
          action.payload,
          action.receivedAt,
        ),
      }
    }

    case 'JOB_SUCCEEDED':
      if (state.activeJob?.id !== action.jobId) {
        return state
      }

      return {
        ...state,
        activeJob: null,
        streamingDraft: null,
        error: null,
      }

    case 'JOB_FAILED':
      if (state.activeJob?.id !== action.jobId) {
        return state
      }

      return {
        ...state,
        activeJob: null,
        streamingDraft: null,
        error: action.error,
      }

    case 'ERROR_SET':
      return {
        ...state,
        error: action.error,
      }

    case 'MESSAGES_REPLACED':
      return {
        ...state,
        messages: action.messages,
      }
  }
}
