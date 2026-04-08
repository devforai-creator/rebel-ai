export const MESSAGE_STATUS_COMPLETED = 'completed' as const
export const MESSAGE_STATUS_GENERATING = 'generating' as const
export const MESSAGE_STATUS_SUPERSEDED = 'superseded' as const

export type ChatMessageStatus =
  | typeof MESSAGE_STATUS_COMPLETED
  | typeof MESSAGE_STATUS_GENERATING
  | typeof MESSAGE_STATUS_SUPERSEDED

export const HIDDEN_MESSAGE_STATUSES = [
  MESSAGE_STATUS_SUPERSEDED,
  MESSAGE_STATUS_GENERATING,
] as const

// Supabase `.not('column', 'in', '(a,b)')` expects the filter as a PostgREST tuple string.
export const HIDDEN_MESSAGE_STATUSES_FILTER = `(${HIDDEN_MESSAGE_STATUSES.join(',')})`

export function isVisibleMessageStatus(status: string | null | undefined): boolean {
  return (
    status !== MESSAGE_STATUS_SUPERSEDED &&
    status !== MESSAGE_STATUS_GENERATING &&
    status !== null &&
    typeof status !== 'undefined'
  )
}
