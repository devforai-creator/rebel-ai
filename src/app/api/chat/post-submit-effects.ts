import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { dispatchNonBlockingSupportEffect, SUPPORT_TIER_FEATURES } from '@/lib/support-tier'

export function dispatchPostSubmitChatEffects({
  chatId,
  jobId,
  userId,
  insertedUserMessageId,
}: {
  chatId: string
  jobId: string
  userId: string
  insertedUserMessageId: string | null
}): void {
  if (!insertedUserMessageId) {
    return
  }

  dispatchNonBlockingSupportEffect({
    feature: SUPPORT_TIER_FEATURES.MESSAGE_TRANSLATION_TRIGGER,
    execute: () => triggerMessageTranslation(insertedUserMessageId, userId),
    context: {
      chatId,
      jobId,
      messageId: insertedUserMessageId,
      userId,
    },
    logPrefix: '[Chat API]',
  })
}
