import { RECENT_CHARACTER_PREVIEW_MAX_LENGTH } from '@/lib/chat/recent-character-types'

const RELATIVE_TIME_UNITS = [
  { seconds: 365 * 24 * 60 * 60, label: 'year' },
  { seconds: 30 * 24 * 60 * 60, label: 'month' },
  { seconds: 7 * 24 * 60 * 60, label: 'week' },
  { seconds: 24 * 60 * 60, label: 'day' },
  { seconds: 60 * 60, label: 'hour' },
  { seconds: 60, label: 'minute' },
] as const

export function formatRecentCharacterPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= RECENT_CHARACTER_PREVIEW_MAX_LENGTH) {
    return normalized
  }

  return `${normalized.slice(0, RECENT_CHARACTER_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`
}

export function formatRecentCharacterRelativeTime(
  timestamp: string,
  referenceTimeMs: number,
): string {
  const timestampMs = Date.parse(timestamp)
  if (!Number.isFinite(timestampMs) || !Number.isFinite(referenceTimeMs)) {
    return 'Unknown time'
  }

  const differenceSeconds = Math.round((timestampMs - referenceTimeMs) / 1000)
  const absoluteSeconds = Math.abs(differenceSeconds)
  if (absoluteSeconds < 60) {
    return 'just now'
  }

  const unit =
    RELATIVE_TIME_UNITS.find((candidate) => absoluteSeconds >= candidate.seconds) ??
    RELATIVE_TIME_UNITS[RELATIVE_TIME_UNITS.length - 1]
  const value = Math.max(1, Math.round(absoluteSeconds / unit.seconds))
  const label = value === 1 ? unit.label : `${unit.label}s`

  return differenceSeconds < 0 ? `${value} ${label} ago` : `in ${value} ${label}`
}
