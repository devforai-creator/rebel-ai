export const ACTIVE_QUEUE_JOB_STATUSES = ['pending', 'processing'] as const

export const MAX_ACTIVE_CHAT_JOBS_PER_USER = 3
export const MAX_ACTIVE_IMPORT_JOBS_PER_USER = 1

export const ACTIVE_CHAT_JOB_CONFLICT_MESSAGE =
  'This chat already has a pending or in-progress response.'

export const ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE =
  'You already have an RBX import in progress. Wait for it to finish before starting another import.'

export function buildActiveChatJobLimitMessage(
  limit: number = MAX_ACTIVE_CHAT_JOBS_PER_USER,
): string {
  return `You already have ${limit} active chat responses. Wait for one to finish before sending another message.`
}

type SupabaseLikeError = {
  code?: string | null
  message?: string | null
} | null

export function isUniqueViolation(error: SupabaseLikeError): boolean {
  return error?.code === '23505'
}

export function isChatJobUserLimitViolation(error: SupabaseLikeError): boolean {
  return error?.code === 'P0001' || error?.message?.includes('active chat generation jobs') === true
}
