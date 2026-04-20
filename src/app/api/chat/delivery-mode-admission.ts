import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
  isAnthropicBatchChatEnabled,
  isAnthropicBatchChatSupported,
  isChatDeliveryMode,
  type ChatDeliveryMode,
} from '@/lib/chat/delivery-mode'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { createErrorResponse } from './responses'

type ResolveChatDeliveryModeResult =
  | {
      status: 'success'
      deliveryMode: ChatDeliveryMode
    }
  | {
      status: 'error'
      response: Response
    }

export function resolveChatDeliveryModeAdmission({
  rawDeliveryMode,
  provider,
  modelName,
}: {
  rawDeliveryMode: unknown
  provider: ChatGenerationJobPayload['provider']
  modelName: string
}): ResolveChatDeliveryModeResult {
  const deliveryMode = isChatDeliveryMode(rawDeliveryMode)
    ? rawDeliveryMode
    : CHAT_DELIVERY_MODE_STREAMING

  if (deliveryMode !== CHAT_DELIVERY_MODE_ANTHROPIC_BATCH) {
    return {
      status: 'success',
      deliveryMode,
    }
  }

  if (!isAnthropicBatchChatEnabled()) {
    return {
      status: 'error',
      response: createErrorResponse('Claude Batch mode is disabled for this deployment', 400),
    }
  }

  if (!isAnthropicBatchChatSupported({ provider, modelName })) {
    return {
      status: 'error',
      response: createErrorResponse(
        'Claude Batch mode is only supported for Anthropic Opus 4.5/4.6',
        400,
      ),
    }
  }

  return {
    status: 'success',
    deliveryMode,
  }
}
