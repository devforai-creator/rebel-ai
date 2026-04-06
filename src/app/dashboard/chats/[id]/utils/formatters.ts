import type { MessageChangePayload } from './types'

/**
 * Format token count for display
 */
export const formatTokenValue = (value: number | null | undefined): string =>
  typeof value === 'number' ? value.toLocaleString() : '—'

/**
 * Format USD value for display with appropriate precision
 */
export const formatUsd = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }

  if (value === 0) {
    return '$0.0000'
  }

  const absolute = Math.abs(value)
  if (absolute < 0.01) {
    return `$${value.toFixed(4)}`
  }

  if (absolute < 1) {
    return `$${value.toFixed(3)}`
  }

  return `$${value.toFixed(2)}`
}

/**
 * Check if role is assistant
 */
export const isAssistantRole = (role: string | null | undefined): boolean => role === 'assistant'

/**
 * Determine if token stats should be refreshed based on realtime payload
 */
export const shouldRefreshTokenStats = (payload: MessageChangePayload): boolean => {
  const newMessage = payload.new ?? null
  const oldMessage = payload.old ?? null

  if (!isAssistantRole(newMessage?.role) && !isAssistantRole(oldMessage?.role)) {
    return false
  }

  if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
    return true
  }

  if (payload.eventType === 'UPDATE') {
    const promptChanged = newMessage?.prompt_tokens !== oldMessage?.prompt_tokens
    const completionChanged = newMessage?.completion_tokens !== oldMessage?.completion_tokens
    const roleChanged = newMessage?.role !== oldMessage?.role

    return promptChanged || completionChanged || roleChanged
  }

  return false
}

/**
 * Format service tier label for display
 */
export const formatServiceTierLabel = (tier?: string | null): string => {
  if (!tier || tier === 'standard') {
    return 'Standard'
  }

  return tier.charAt(0).toUpperCase() + tier.slice(1)
}
